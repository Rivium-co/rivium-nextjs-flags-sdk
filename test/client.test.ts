import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { RiviumFlagsClient, ANONYMOUS_ID_KEY } from '../src/client';
import { MemoryStorage } from '../src/storage';
import { loadVectors, mockFetch, silentLogger, Call } from './helpers';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const results = {
  'new-checkout': { key: 'new-checkout', valueType: 'boolean', enabled: true, value: true, variant: null, reason: 'ON', version: 7 },
  theme: { key: 'theme', valueType: 'string', enabled: true, value: 'dark', variant: 'dark', reason: 'VARIANT', version: 3 },
  'old-banner': { key: 'old-banner', valueType: 'boolean', enabled: false, value: false, variant: null, reason: 'DISABLED', version: 12 },
  limit: { key: 'limit', valueType: 'number', enabled: true, value: 10, variant: 'ten', reason: 'VARIANT', version: 1 },
  cfg: { key: 'cfg', valueType: 'json', enabled: true, value: { a: [1, 2] }, variant: 'a', reason: 'VARIANT', version: 1 },
};

function ok(flags: Record<string, any> = results, etag = '"e2-abc"') {
  return { status: 200, body: { environment: 'production', evaluatedAt: '2026-10-01T12:00:00.000Z', flags }, headers: { etag } };
}

function make(opts: Partial<ConstructorParameters<typeof RiviumFlagsClient>[0]> = {}, responder: (c: Call) => any = () => ok()) {
  const m = mockFetch(responder);
  const storage = (opts.storage as MemoryStorage) || new MemoryStorage();
  const client = new RiviumFlagsClient({ apiKey: 'rv_test_pub', logger: silentLogger, storage, fetch: m.fetch, ...opts });
  return { client, calls: m.calls, storage };
}

test('constructor: apiKey required; refuses a server secret', () => {
  assert.throws(() => new RiviumFlagsClient({ apiKey: '' }), /apiKey/);
  assert.throws(() => new RiviumFlagsClient({ apiKey: 'rv_test_x', serverSecret: 'rv_srv_x' } as any), /server secret/);
  assert.throws(() => new RiviumFlagsClient({ apiKey: 'rv_srv_abc' }), /server secret/);
});

test('request: POST /public/v2/evaluate, public key only, context + environment + flagKeys', async () => {
  const { client, calls } = make({
    environment: 'production',
    baseUrl: 'https://flags.example/',
    userId: 'u_123',
    attributes: { plan: 'pro', beta: true, age: 31, tags: ['a', 'b'] },
    flagKeys: ['new-checkout', 'theme'],
  });
  await client.init();
  assert.equal(calls.length, 1);
  const c = calls[0];
  assert.equal(c.method, 'POST');
  assert.equal(c.url, 'https://flags.example/public/v2/evaluate');
  assert.equal(c.headers['x-api-key'], 'rv_test_pub');
  assert.equal(c.headers['x-rivium-sdk'], 'nextjs/0.2.0');
  assert.equal(c.headers['content-type'], 'application/json');
  assert.equal(c.headers['x-server-secret'], undefined);
  assert.equal(c.headers['if-none-match'], undefined);
  assert.deepEqual(c.body, {
    environment: 'production',
    context: {
      userId: 'u_123',
      anonymousId: client.getAnonymousId(),
      attributes: { plan: 'pro', beta: true, age: 31, tags: ['a', 'b'] },
    },
    flagKeys: ['new-checkout', 'theme'],
  });
  client.close();
});

test('request: no environment / userId / flagKeys when not set (Default layer, signed out)', async () => {
  const { client, calls } = make();
  await client.init();
  assert.deepEqual(calls[0].body, { context: { anonymousId: client.getAnonymousId(), attributes: {} } });
  assert.ok(!calls[0].url.includes('/server/'));
  client.close();
});

test('anonymous id: UUID v4, persisted under rivium_flags_anonymous_id, reused, kept by reset(), replaced by resetAnonymousId()', async () => {
  const storage = new MemoryStorage();
  const a = make({ storage }).client;
  const id = a.getAnonymousId();
  assert.match(id, UUID_V4);
  assert.equal(storage.getItem(ANONYMOUS_ID_KEY), id);
  assert.equal(ANONYMOUS_ID_KEY, 'rivium_flags_anonymous_id');

  const b = make({ storage });
  assert.equal(b.client.getAnonymousId(), id);
  await b.client.init();
  await b.client.identify('u1');
  await b.client.reset();
  assert.equal(b.client.getAnonymousId(), id);
  assert.equal(b.client.getUserId(), null);
  assert.equal(b.calls.at(-1)!.body.context.anonymousId, id);

  await b.client.resetAnonymousId();
  const next = b.client.getAnonymousId();
  assert.match(next, UUID_V4);
  assert.notEqual(next, id);
  assert.equal(storage.getItem(ANONYMOUS_ID_KEY), next);
  assert.equal(b.calls.at(-1)!.body.context.anonymousId, next);
  b.client.close();
});

test('anonymous id: in-memory fallback when storage throws', async () => {
  const throwing = {
    getItem() {
      throw new Error('SecurityError');
    },
    setItem() {
      throw new Error('QuotaExceeded');
    },
    removeItem() {
      throw new Error('SecurityError');
    },
  };
  const { client, calls } = make({ storage: throwing as any });
  const id = client.getAnonymousId();
  assert.match(id, UUID_V4);
  await client.init();
  assert.equal(calls[0].body.context.anonymousId, id);
  assert.equal(client.getString('theme', 'x'), 'dark');
  client.close();
});

test('typed getters and reasons', async () => {
  const { client } = make();
  assert.equal(client.isReady(), false);
  assert.deepEqual(client.getDetail('theme', 'light'), {
    key: 'theme', value: 'light', enabled: false, variant: null, reason: 'NOT_READY', version: null, valueType: null,
  });
  assert.equal(client.isEnabled('new-checkout', true), true);
  await client.init();
  assert.equal(client.isReady(), true);

  assert.equal(client.isEnabled('new-checkout'), true);
  assert.equal(client.isEnabled('old-banner', true), false);
  assert.equal(client.getBoolean('new-checkout', false), true);
  assert.equal(client.getString('theme', 'light'), 'dark');
  assert.equal(client.getNumber('limit', 0), 10);
  assert.deepEqual(client.getJson('cfg', {}), { a: [1, 2] });

  assert.deepEqual(client.getDetail('theme', 'light', 'string'), {
    key: 'theme', value: 'dark', enabled: true, variant: 'dark', reason: 'VARIANT', version: 3, valueType: 'string',
  });
  const mismatch = client.getDetail('theme', 0, 'number');
  assert.equal(mismatch.reason, 'TYPE_MISMATCH');
  assert.equal(mismatch.value, 0);
  assert.equal(mismatch.enabled, false);
  assert.equal(mismatch.variant, null);
  assert.equal(client.getJson('theme', { d: 1 }).d, 1, 'getJson is strict: json flags only');
  assert.equal(client.getNumber('theme', 5), 5);
  assert.equal(client.getBoolean('limit', true), true);

  const nf = client.getDetail('nope', 'fallback');
  assert.equal(nf.reason, 'FLAG_NOT_FOUND');
  assert.equal(nf.value, 'fallback');
  assert.equal(client.isEnabled('nope', true), true);
  assert.deepEqual(Object.keys(client.getAll()).sort(), ['cfg', 'limit', 'new-checkout', 'old-banner', 'theme']);
  client.close();
});

test('response parsing: every evaluation vector, served as /public/v2/evaluate results, reads back exactly', async () => {
  const vectors = loadVectors();
  let passed = 0;
  for (const suite of vectors.suites) {
    const types = new Map(suite.flags.map((f: any) => [f.key, f.valueType]));
    const versions = new Map(suite.flags.map((f: any) => [f.key, f.version]));
    for (const c of suite.cases) {
      const flag = {
        key: c.flagKey,
        valueType: types.get(c.flagKey),
        ...c.expected,
        version: versions.get(c.flagKey),
      };
      const { client } = make({}, () => ok({ [c.flagKey]: flag }));
      await client.init();
      const d = client.getDetail(c.flagKey, '__default__');
      assert.deepEqual(
        { enabled: d.enabled, value: d.value, variant: d.variant, reason: d.reason },
        c.expected,
        `${suite.name} / ${c.name}`,
      );
      assert.equal(client.isEnabled(c.flagKey, !c.expected.enabled), c.expected.enabled);
      // The typed getter of the flag's own type returns the served value when its JSON type fits.
      const t = types.get(c.flagKey) as string;
      const typed = client.getDetail(c.flagKey, '__default__', t as any);
      const fits =
        t === 'json' ||
        (t === 'boolean' && typeof c.expected.value === 'boolean') ||
        (t === 'string' && typeof c.expected.value === 'string') ||
        (t === 'number' && typeof c.expected.value === 'number');
      assert.deepEqual(typed.value, fits ? c.expected.value : '__default__', `${suite.name} / ${c.name} (typed)`);
      assert.equal(typed.reason, fits ? c.expected.reason : 'TYPE_MISMATCH');
      // Another type → TYPE_MISMATCH and the default.
      const other = t === 'string' ? 'number' : 'string';
      const wrong = client.getDetail(c.flagKey, '__default__', other as any);
      assert.equal(wrong.reason, 'TYPE_MISMATCH');
      assert.equal(wrong.value, '__default__');
      client.close();
      passed++;
    }
  }
  assert.equal(passed, 171);
});

test('ETag: If-None-Match only for the same context; 304 keeps the results', async () => {
  let n = 0;
  const { client, calls } = make({}, () => (n++ === 0 ? ok() : n === 2 ? { status: 304 } : ok(results, '"e2-new"')));
  await client.init();
  await client.refresh();
  assert.equal(calls[1].headers['if-none-match'], '"e2-abc"');
  assert.equal(client.getString('theme', 'x'), 'dark');
  await client.setAttributes({ plan: 'pro' });
  assert.equal(calls[2].headers['if-none-match'], undefined, 'context changed → no If-None-Match');
  client.close();
});

test('identify: debounced (one request for quick changes); a new user id drops the old results at once', async () => {
  const { client, calls } = make({ userId: 'alice' });
  await client.init();
  assert.equal(client.isReady(), true);
  const changes: number[] = [];
  client.on('change', (p) => changes.push(p.flagCount));

  const p1 = client.identify('bob', { plan: 'free' });
  assert.equal(client.isReady(), false, 'bob must never see alice’s results');
  assert.equal(client.getDetail('theme', 'x').reason, 'NOT_READY');
  const p2 = client.setAttributes({ plan: 'pro' });
  await Promise.all([p1, p2]);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].body.context.userId, 'bob');
  assert.deepEqual(calls[1].body.context.attributes, { plan: 'pro' });
  assert.equal(client.isReady(), true);
  assert.deepEqual(changes, [0, 5]);

  // Same user, new attributes: cache kept while fetching.
  const p3 = client.setAttributes({ plan: 'business' });
  assert.equal(client.isReady(), true);
  await p3;
  client.close();
});

test('cache: last results persisted and served at start before the network answers', async () => {
  const storage = new MemoryStorage();
  const first = make({ storage, userId: 'u1' });
  await first.client.init();
  first.client.close();

  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const second = make({ storage, userId: 'u1', initTimeoutMs: 20 }, async () => {
    await gate;
    return { status: 304 };
  });
  assert.equal(second.client.isReady(), true);
  assert.equal(second.client.getString('theme', 'x'), 'dark');
  let readySource = '';
  second.client.on('ready', (p) => (readySource = p.source));
  await second.client.init();
  assert.equal(readySource, 'cache');
  release();
  await sleep(5);
  assert.equal(second.calls[0].headers['if-none-match'], '"e2-abc"');
  second.client.close();

  // Another user on the same device never gets u1's cached results.
  const third = make({ storage, userId: 'u2' });
  assert.equal(third.client.isReady(), false);
  // Another project key never reads this project's cache.
  const fourth = make({ storage, userId: 'u1', apiKey: 'rv_test_other' });
  assert.equal(fourth.client.isReady(), false);
});

test('offline: network error keeps the cache and retries later', async () => {
  let n = 0;
  const { client } = make({}, () => (n++ === 0 ? ok() : Promise.reject(new Error('offline'))));
  const errors: any[] = [];
  client.on('error', (e) => errors.push(e));
  await client.init();
  await client.refresh();
  assert.equal(client.getString('theme', 'x'), 'dark');
  assert.match(errors[0].message, /offline/);
  assert.ok((client as any).retryTimer, 'retry scheduled');
  client.close();
  assert.equal((client as any).retryTimer, null);
});

test('401 stops automatic fetching until refresh(); cache still served; key never logged', async () => {
  const logs: string[] = [];
  const logger = { debug: (m: string) => logs.push(m), info: (m: string) => logs.push(m), warn: (m: string) => logs.push(m), error: (m: string) => logs.push(m) };
  let status = 200;
  const { client, calls } = make({ logger }, () => (status === 200 ? ok() : { status, body: { statusCode: status, message: 'Invalid API key' } }));
  await client.init();
  status = 401;
  await client.refresh();
  assert.equal((client as any).stopped, true);
  assert.equal((client as any).retryTimer, null);
  assert.equal(client.getString('theme', 'x'), 'dark');
  await (client as any).fetchNow(false); // polling / foreground / retry path
  assert.equal(calls.length, 2, 'no automatic request after 401');
  assert.ok(logs.every((l) => !l.includes('rv_test_pub')));
  status = 200;
  await client.refresh();
  assert.equal(calls.length, 3);
  assert.equal((client as any).stopped, false);
  client.close();
});

test('403 and 404 do not retry automatically', async () => {
  for (const status of [403, 404]) {
    const { client, calls } = make({ environment: 'nope' }, () => ({ status, body: { statusCode: status, code: 'environment_not_found' } }));
    const errors: any[] = [];
    client.on('error', (e) => errors.push(e));
    await client.init();
    assert.equal(errors[0].status, status);
    assert.equal(errors[0].code, 'environment_not_found');
    assert.equal((client as any).retryTimer, null);
    assert.equal(client.getDetail('theme', 'd').reason, 'NOT_READY');
    await (client as any).fetchNow(false);
    assert.equal(calls.length, 1);
    client.close();
  }
});

test('400: not resent for the same context', async () => {
  const { client, calls } = make({}, () => ({ status: 400, body: { statusCode: 400, code: 'invalid_request', message: 'at most 100 attributes' } }));
  await client.init();
  assert.equal((client as any).retryTimer, null);
  await (client as any).fetchNow(false);
  assert.equal(calls.length, 1);
  client.close();
});

test('429: waits Retry-After before retrying', async () => {
  const { client } = make({}, () => ({ status: 429, headers: { 'retry-after': '9' } }));
  const realSetTimeout = global.setTimeout;
  const delays: number[] = [];
  (global as any).setTimeout = (fn: any, ms: number) => {
    delays.push(ms);
    return realSetTimeout(() => {}, 0);
  };
  try {
    await (client as any).init();
  } finally {
    (global as any).setTimeout = realSetTimeout;
  }
  assert.ok(delays.some((d) => d >= 9000 && d <= 9000 * 1.2 + 1), `delays: ${delays}`);
  client.close();
});

test('a newer request supersedes an older one (last write wins)', async () => {
  let n = 0;
  const { client } = make({}, async () => {
    const mine = ++n;
    if (mine === 1) await sleep(60); // the first (older) answer arrives last
    return ok({ theme: { ...results.theme, value: mine === 1 ? 'old' : 'new' } });
  });
  const init = client.init();
  await sleep(5);
  await client.refresh();
  await init;
  await sleep(80);
  assert.equal(client.getString('theme', 'x'), 'new');
  client.close();
});

test('polling is off by default and at least 60 s when on', () => {
  assert.equal((make().client as any).refreshMs, 0);
  assert.equal((make({ refreshIntervalSeconds: 10 }).client as any).refreshMs, 60000);
  assert.equal((make({ refreshIntervalSeconds: 120 }).client as any).refreshMs, 120000);
});

test('foreground: refetch only when the last success is older than 15 min', async () => {
  const listeners: Record<string, () => void> = {};
  const doc = {
    visibilityState: 'visible',
    addEventListener: (e: string, f: () => void) => (listeners[e] = f),
    removeEventListener: (e: string) => delete listeners[e],
  };
  (globalThis as any).document = doc;
  try {
    const { client, calls } = make();
    await client.init();
    listeners.visibilitychange();
    await sleep(5);
    assert.equal(calls.length, 1, 'fresh results: no refetch');
    (client as any).lastSuccessAt = Date.now() - 16 * 60 * 1000;
    listeners.visibilitychange();
    await sleep(5);
    assert.equal(calls.length, 2);
    client.close();
    assert.equal(listeners.visibilitychange, undefined);
  } finally {
    delete (globalThis as any).document;
  }
});

test('identify with an unchanged context does not send another (billed) request', async () => {
  const { client, calls } = make({ userId: 'u1', attributes: { plan: 'pro' } });
  await client.init();
  await client.identify('u1', { plan: 'pro' });
  await client.setUserId('u1');
  await client.setAttributes({ plan: 'pro' });
  assert.equal(calls.length, 1);
  await client.setAttributes({ plan: 'free' });
  assert.equal(calls.length, 2);
  client.close();
});
