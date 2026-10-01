import { backoffDelayMs, parseRetryAfter } from './backoff';
import { sha256Hex } from './hash';
import {
  ANONYMOUS_ID_KEY,
  CACHE_KEY,
  SafeStorage,
  browserLocalStorage,
  loadOrCreateAnonymousId,
  uuidV4,
} from './storage';
import {
  AttributeValue,
  EvaluatedFlag,
  EvaluateResponse,
  FlagDetail,
  JsonValue,
  KeyValueStorage,
  Logger,
  RiviumFlagsClientConfig,
  RiviumFlagsClientEvent,
  RiviumFlagsClientEventPayload,
  RiviumFlagsClientListener,
  ValueType,
} from './types';
import { SDK_CLIENT_PLATFORM, SDK_VERSION } from './version';

const DEFAULT_BASE_URL = 'https://flags.rivium.co';
const DEBOUNCE_MS = 250;
const FOREGROUND_STALE_MS = 15 * 60 * 1000;
const MIN_REFRESH_SECONDS = 60;
const DEFAULT_INIT_TIMEOUT_MS = 5000;

interface CacheRecord {
  v: 1;
  /** Fingerprint of the project key, so two projects on one origin never share results. */
  project: string;
  /** Identity of the request the results answer (environment + context + flagKeys). */
  request: string;
  userId: string | null;
  environment: string | null;
  etag: string | null;
  flags: Record<string, EvaluatedFlag>;
  savedAt: number;
}

function defaultLogger(debug: boolean): Logger {
  const p = '[Rivium Flags]';
  return {
    debug: (m) => {
      if (debug) console.debug(`${p} ${m}`);
    },
    info: (m) => console.info(`${p} ${m}`),
    warn: (m) => console.warn(`${p} ${m}`),
    error: (m) => console.error(`${p} ${m}`),
  };
}

/**
 * Rivium Flags client for the browser (Next.js client components, any web page).
 *
 * Uses the **public** project key only. Flags are evaluated by Rivium Flags
 * (`POST /public/v2/evaluate`); the client keeps the results for the current
 * user and never downloads targeting rules. Results are cached in
 * `localStorage` and served at start, before the network answers.
 *
 * @example
 * ```ts
 * const flags = new RiviumFlagsClient({ apiKey: process.env.NEXT_PUBLIC_RIVIUM_API_KEY! });
 * await flags.init();
 * await flags.identify('user-123', { plan: 'pro' });
 * flags.getString('theme', 'light');
 * ```
 */
export class RiviumFlagsClient {
  private readonly apiKey: string;
  private readonly environment: string | null;
  private readonly baseUrl: string;
  private readonly flagKeys: string[] | null;
  private readonly refreshMs: number;
  private readonly initTimeoutMs: number;
  private readonly storage: KeyValueStorage;
  private readonly log: Logger;
  private readonly fetchImpl: typeof fetch;
  private readonly project: string;

  private userId: string | null;
  private attributes: Record<string, AttributeValue>;
  private anonymousId: string;

  private results: Record<string, EvaluatedFlag> | null = null;
  private resultsIdentity: string | null = null;
  private etag: string | null = null;
  private lastSuccessAt = 0;

  private seq = 0;
  private inFlight = 0;
  private abort: AbortController | null = null;
  private failures = 0;
  private stopped = false;
  private closed = true;
  private readyEmitted = false;
  private refusedIdentity: string | null = null;

  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceWaiters: Array<() => void> = [];
  private initPromise: Promise<void> | null = null;
  private visibilityHandler: (() => void) | null = null;

  private listeners: { [E in RiviumFlagsClientEvent]: Set<RiviumFlagsClientListener<E>> } = {
    ready: new Set(),
    change: new Set(),
    error: new Set(),
  };

  constructor(config: RiviumFlagsClientConfig) {
    if (!config || !config.apiKey) throw new Error('Rivium Flags: apiKey is required');
    if ((config as any).serverSecret || config.apiKey.startsWith('rv_srv_')) {
      throw new Error(
        'Rivium Flags: RiviumFlagsClient takes the public key only. Never pass the server secret to client code; ' +
          'use RiviumFlags from "@rivium/flags-nextjs/server" on the server.',
      );
    }
    this.apiKey = config.apiKey;
    this.environment = config.environment || null;
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.flagKeys = config.flagKeys && config.flagKeys.length ? [...config.flagKeys] : null;
    const every = config.refreshIntervalSeconds ?? 0;
    this.refreshMs = every > 0 ? Math.max(every, MIN_REFRESH_SECONDS) * 1000 : 0;
    this.initTimeoutMs = config.initTimeoutMs ?? DEFAULT_INIT_TIMEOUT_MS;
    this.storage = new SafeStorage(config.storage ?? browserLocalStorage());
    this.log = config.logger || defaultLogger(!!config.debug);
    const f = config.fetch || (globalThis as any).fetch;
    this.fetchImpl = typeof f === 'function' ? f.bind(globalThis) : (undefined as any);
    this.project = sha256Hex(`rivium-flags:${this.apiKey}`).slice(0, 16);

    this.userId = normalizeId(config.userId);
    this.attributes = { ...(config.attributes || {}) };
    this.anonymousId = loadOrCreateAnonymousId(this.storage);
    this.loadCache();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Serve cached results (if any) and fetch fresh ones. Resolves after the
   * first answer or after `initTimeoutMs`; never rejects. Call it in the
   * browser (e.g. in `useEffect`) — it does nothing useful during SSR.
   */
  init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.closed = false;
    this.stopped = false;
    if (this.results) this.emitReady('cache');
    this.attachForeground();
    if (this.refreshMs > 0) {
      this.pollTimer = setInterval(() => {
        if (this.isVisible() && !this.stopped && this.inFlight === 0) void this.fetchNow(false);
      }, this.refreshMs);
    }
    this.initPromise = new Promise<void>((resolve) => {
      const t = setTimeout(resolve, this.initTimeoutMs);
      this.fetchNow(true).then(
        () => {
          clearTimeout(t);
          resolve();
        },
        () => resolve(),
      );
    });
    return this.initPromise;
  }

  /** True when results (cached or fetched) for the current user are available. */
  isReady(): boolean {
    return this.results !== null;
  }

  /** Fetch now. Also resumes automatic fetching after a 401 / 403 / 404. */
  async refresh(): Promise<void> {
    if (this.closed) return;
    this.stopped = false;
    this.failures = 0;
    this.refusedIdentity = null;
    this.cancelDebounce();
    await this.fetchNow(true);
    this.flushWaiters();
  }

  /** Stop timers and listeners. The cache and anonymous id stay on the device. */
  close(): void {
    this.closed = true;
    this.initPromise = null;
    this.abort?.abort();
    this.abort = null;
    this.clearRetry();
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.cancelDebounce();
    this.flushWaiters();
    this.detachForeground();
  }

  /** Subscribe to `ready`, `change` or `error`. Returns an unsubscribe function. */
  on<E extends RiviumFlagsClientEvent>(event: E, listener: RiviumFlagsClientListener<E>): () => void {
    (this.listeners[event] as Set<RiviumFlagsClientListener<E>>).add(listener);
    return () => {
      (this.listeners[event] as Set<RiviumFlagsClientListener<E>>).delete(listener);
    };
  }

  // ── User ───────────────────────────────────────────────────────────────────

  /**
   * Set the signed-in user (null = signed out) and, when given, replace the
   * attributes. Fetches new results (debounced 250 ms). When the user id
   * changes, the previous user's results are dropped at once.
   */
  identify(userId: string | null, attributes?: Record<string, AttributeValue>): Promise<void> {
    const before = this.identity();
    this.applyUser(normalizeId(userId));
    if (attributes) this.attributes = { ...attributes };
    return this.scheduleFetchIfChanged(before);
  }

  /** Change the user id only (attributes kept). */
  setUserId(userId: string | null): Promise<void> {
    const before = this.identity();
    this.applyUser(normalizeId(userId));
    return this.scheduleFetchIfChanged(before);
  }

  /** Replace the targeting attributes. */
  setAttributes(attributes: Record<string, AttributeValue>): Promise<void> {
    const before = this.identity();
    this.attributes = { ...(attributes || {}) };
    return this.scheduleFetchIfChanged(before);
  }

  /** Sign out: clear user id, attributes and cached results. The anonymous id is kept. */
  reset(): Promise<void> {
    this.attributes = {};
    this.applyUser(null, true);
    return this.scheduleFetch();
  }

  /** Generate a new anonymous id (e.g. when the user asks to be forgotten) and fetch again. */
  resetAnonymousId(): Promise<void> {
    this.anonymousId = uuidV4();
    this.storage.setItem(ANONYMOUS_ID_KEY, this.anonymousId);
    return this.scheduleFetch();
  }

  getUserId(): string | null {
    return this.userId;
  }

  getAttributes(): Record<string, AttributeValue> {
    return { ...this.attributes };
  }

  getAnonymousId(): string {
    return this.anonymousId;
  }

  // ── Getters ────────────────────────────────────────────────────────────────

  /** `true` only when the flag is served on (`ON` / `VARIANT`); `defaultValue` when not found / not ready. */
  isEnabled(key: string, defaultValue = false): boolean {
    const r = this.results?.[key];
    return r ? !!r.enabled : defaultValue;
  }

  getBoolean(key: string, defaultValue: boolean): boolean {
    return this.getDetail(key, defaultValue, 'boolean').value;
  }

  getString(key: string, defaultValue: string): string {
    return this.getDetail(key, defaultValue, 'string').value;
  }

  getNumber(key: string, defaultValue: number): number {
    return this.getDetail(key, defaultValue, 'number').value;
  }

  getJson<T = JsonValue>(key: string, defaultValue: T): T {
    return this.getDetail(key, defaultValue, 'json').value;
  }

  /**
   * The full result. Pass `valueType` to get `TYPE_MISMATCH` (and your
   * default) when the flag has another type.
   */
  getDetail<T = unknown>(key: string, defaultValue: T, valueType?: ValueType): FlagDetail<T> {
    if (!this.results) return missing(key, defaultValue, 'NOT_READY');
    const r = this.results[key];
    if (!r || typeof r !== 'object') return missing(key, defaultValue, 'FLAG_NOT_FOUND');
    const detail: FlagDetail<T> = {
      key,
      value: r.value as T,
      enabled: !!r.enabled,
      variant: r.variant ?? null,
      reason: r.reason,
      version: typeof r.version === 'number' ? r.version : null,
      valueType: r.valueType ?? null,
    };
    if (valueType && (detail.valueType !== valueType || !valueMatches(valueType, detail.value))) {
      return { ...detail, value: defaultValue, enabled: false, variant: null, reason: 'TYPE_MISMATCH' };
    }
    return detail;
  }

  /** Every result for the current user, by key (empty until ready). */
  getAll(): Record<string, EvaluatedFlag> {
    const out: Record<string, EvaluatedFlag> = {};
    for (const [k, v] of Object.entries(this.results || {})) out[k] = { ...v };
    return out;
  }

  // ── Internals: state ───────────────────────────────────────────────────────

  private applyUser(userId: string | null, force = false): void {
    if (userId === this.userId && !force) return;
    this.userId = userId;
    // Never show one user's results to another.
    this.results = null;
    this.resultsIdentity = null;
    this.etag = null;
    this.storage.removeItem(CACHE_KEY);
    this.abort?.abort();
    this.seq++;
    this.emit('change', { flagCount: 0 });
  }

  private identity(): string {
    const attrs: Record<string, AttributeValue> = {};
    for (const k of Object.keys(this.attributes).sort()) {
      if (this.attributes[k] !== undefined) attrs[k] = this.attributes[k];
    }
    return JSON.stringify([this.environment, this.userId, this.anonymousId, attrs, this.flagKeys]);
  }

  private requestBody(): Record<string, unknown> {
    const context: Record<string, unknown> = { anonymousId: this.anonymousId, attributes: this.attributes };
    if (this.userId) context.userId = this.userId;
    const body: Record<string, unknown> = { context };
    if (this.environment) body.environment = this.environment;
    if (this.flagKeys) body.flagKeys = this.flagKeys;
    return body;
  }

  private loadCache(): void {
    try {
      const raw = this.storage.getItem(CACHE_KEY);
      if (!raw) return;
      const c = JSON.parse(raw) as CacheRecord;
      if (!c || c.v !== 1 || c.project !== this.project || !c.flags || typeof c.flags !== 'object') return;
      if ((c.userId ?? null) !== this.userId || (c.environment ?? null) !== this.environment) return;
      this.results = c.flags;
      this.resultsIdentity = c.request;
      this.etag = c.etag;
      this.lastSuccessAt = typeof c.savedAt === 'number' ? c.savedAt : 0;
    } catch {
      // A broken cache is ignored.
    }
  }

  private saveCache(): void {
    if (!this.results) return;
    const record: CacheRecord = {
      v: 1,
      project: this.project,
      request: this.resultsIdentity || '',
      userId: this.userId,
      environment: this.environment,
      etag: this.etag,
      flags: this.results,
      savedAt: this.lastSuccessAt,
    };
    try {
      this.storage.setItem(CACHE_KEY, JSON.stringify(record));
    } catch {
      // Quota: the in-memory results still work.
    }
  }

  // ── Internals: fetching ────────────────────────────────────────────────────

  /** Same context as before and results already for it: nothing to fetch (no billed request). */
  private scheduleFetchIfChanged(before: string): Promise<void> {
    const now = this.identity();
    if (now === before && this.results && this.resultsIdentity === now && !this.debounceTimer) return Promise.resolve();
    return this.scheduleFetch();
  }

  private scheduleFetch(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.debounceWaiters.push(resolve);
      if (this.closed) {
        // Not started (or closed): the next init() / refresh() fetches with the new context.
        this.flushWaiters();
        return;
      }
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        const waiters = this.debounceWaiters;
        this.debounceWaiters = [];
        this.fetchNow(true).then(() => waiters.forEach((w) => w()));
      }, DEBOUNCE_MS);
    });
  }

  private cancelDebounce(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
  }

  private flushWaiters(): void {
    const waiters = this.debounceWaiters;
    this.debounceWaiters = [];
    waiters.forEach((w) => w());
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  /**
   * One evaluate request. A newer request supersedes (aborts) an older one;
   * a superseded answer is ignored.
   * @param explicit init / identify / refresh (vs. polling, foreground, retry)
   */
  private async fetchNow(explicit: boolean): Promise<void> {
    if (this.closed) return;
    if (!this.fetchImpl) {
      this.log.error('no fetch available in this environment');
      return;
    }
    const identity = this.identity();
    if (!explicit && (this.stopped || identity === this.refusedIdentity)) return;
    this.clearRetry();

    const seq = ++this.seq;
    this.abort?.abort();
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    this.abort = controller;

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-api-key': this.apiKey,
      'x-rivium-sdk': `${SDK_CLIENT_PLATFORM}/${SDK_VERSION}`,
    };
    if (this.etag && this.results && this.resultsIdentity === identity) headers['If-None-Match'] = this.etag;

    this.inFlight++;
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/public/v2/evaluate`, {
        method: 'POST',
        headers,
        body: JSON.stringify(this.requestBody()),
        signal: controller?.signal,
      });
    } catch (err) {
      if (seq === this.seq) this.retryLater(undefined, `network error: ${errorMessage(err)}`);
      return;
    } finally {
      this.inFlight--;
    }
    if (seq !== this.seq || this.closed) return; // superseded

    if (res.status === 304) {
      if (this.results && this.resultsIdentity === identity) {
        this.failures = 0;
        this.lastSuccessAt = Date.now();
        this.saveCache();
        this.log.debug('results unchanged (304)');
      }
      return;
    }

    if (res.status === 200) {
      let body: EvaluateResponse;
      try {
        body = (await res.json()) as EvaluateResponse;
      } catch (err) {
        this.retryLater(undefined, `invalid response body: ${errorMessage(err)}`);
        return;
      }
      if (seq !== this.seq || this.closed) return;
      if (!body || !body.flags || typeof body.flags !== 'object' || Array.isArray(body.flags)) {
        this.retryLater(undefined, 'invalid response body: no flags');
        return;
      }
      this.results = body.flags;
      this.resultsIdentity = identity;
      this.etag = res.headers.get('etag');
      this.failures = 0;
      this.lastSuccessAt = Date.now();
      this.saveCache();
      const flagCount = Object.keys(body.flags).length;
      this.log.debug(`received ${flagCount} flag results`);
      this.emitReady('network');
      this.emit('change', { flagCount });
      return;
    }

    const { code, message } = await readError(res);
    const detail = `HTTP ${res.status}${code ? ` ${code}` : ''}${message ? `: ${message}` : ''}`;
    if (res.status === 429) {
      this.retryLater(res.status, `rate limited (${detail})`, parseRetryAfter(res.headers.get('retry-after')), code);
      return;
    }
    if (res.status >= 500) {
      this.retryLater(res.status, detail, null, code);
      return;
    }
    if (res.status === 400 || res.status === 413) {
      // Do not resend the same body; a new context will be tried.
      if (this.refusedIdentity !== identity) this.log.error(`request refused (${detail}); check the context and attributes`);
      this.refusedIdentity = identity;
      this.emit('error', { status: res.status, code, message: detail });
      return;
    }
    const hint =
      res.status === 401
        ? 'check the API key and that Flags is enabled for the project'
        : res.status === 403
          ? 'this key may not call this route'
          : res.status === 404
            ? code === 'environment_not_found'
              ? `environment "${this.environment}" does not exist or is inactive`
              : `not found at ${this.baseUrl}`
            : 'request refused';
    this.log.error(`could not fetch flags (${detail}); ${hint}. Serving cached results / defaults until refresh().`);
    this.stopped = true;
    this.emit('error', { status: res.status, code, message: detail });
  }

  private retryLater(status: number | undefined, message: string, retryAfter: number | null = null, code?: string): void {
    this.failures += 1;
    const delay = backoffDelayMs(this.failures, retryAfter);
    this.log.warn(`could not fetch flags (${message}); serving cached results, retrying in ${Math.round(delay / 1000)} s`);
    this.emit('error', { status, code, message });
    if (this.closed || this.stopped) return;
    this.clearRetry();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.fetchNow(false);
    }, delay);
  }

  // ── Internals: foreground ──────────────────────────────────────────────────

  private isVisible(): boolean {
    const d = (globalThis as any).document;
    return !d || d.visibilityState !== 'hidden';
  }

  private attachForeground(): void {
    const d = (globalThis as any).document;
    if (!d || typeof d.addEventListener !== 'function' || this.visibilityHandler) return;
    this.visibilityHandler = () => {
      if (d.visibilityState !== 'visible' || this.stopped) return;
      if (Date.now() - this.lastSuccessAt > FOREGROUND_STALE_MS) void this.fetchNow(false);
    };
    d.addEventListener('visibilitychange', this.visibilityHandler);
  }

  private detachForeground(): void {
    const d = (globalThis as any).document;
    if (d && this.visibilityHandler) d.removeEventListener('visibilitychange', this.visibilityHandler);
    this.visibilityHandler = null;
  }

  private emitReady(source: 'cache' | 'network'): void {
    if (this.readyEmitted) return;
    this.readyEmitted = true;
    this.emit('ready', { source });
  }

  private emit<E extends RiviumFlagsClientEvent>(event: E, payload: RiviumFlagsClientEventPayload[E]): void {
    for (const l of this.listeners[event] as Set<RiviumFlagsClientListener<E>>) {
      try {
        l(payload);
      } catch (err) {
        this.log.error(`listener for "${event}" threw: ${errorMessage(err)}`);
      }
    }
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function normalizeId(id: string | null | undefined): string | null {
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function missing<T>(key: string, defaultValue: T, reason: 'NOT_READY' | 'FLAG_NOT_FOUND'): FlagDetail<T> {
  return { key, value: defaultValue, enabled: false, variant: null, reason, version: null, valueType: null };
}

function valueMatches(type: ValueType, v: unknown): boolean {
  switch (type) {
    case 'boolean':
      return typeof v === 'boolean';
    case 'string':
      return typeof v === 'string';
    case 'number':
      return typeof v === 'number' && Number.isFinite(v);
    default:
      return v !== undefined;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function readError(res: Response): Promise<{ code?: string; message?: string }> {
  try {
    const body = (await res.json()) as any;
    const message = Array.isArray(body?.message) ? body.message.join('; ') : body?.message;
    return {
      code: typeof body?.code === 'string' ? body.code : undefined,
      message: typeof message === 'string' ? message : undefined,
    };
  } catch {
    return {};
  }
}
