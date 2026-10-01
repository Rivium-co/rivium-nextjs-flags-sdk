import { KeyValueStorage } from './types';

/** Storage key of the anonymous id in the browser. */
export const ANONYMOUS_ID_KEY = 'rivium_flags_anonymous_id';
/** Storage key of the last evaluate answer. */
export const CACHE_KEY = 'rivium_flags_cache_v2';

export class MemoryStorage implements KeyValueStorage {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

/**
 * Wraps a storage so a throwing backend (private mode, quota, blocked cookies)
 * falls back to memory instead of breaking the SDK.
 */
export class SafeStorage implements KeyValueStorage {
  private readonly memory = new MemoryStorage();
  private failed = false;

  constructor(private readonly backend: KeyValueStorage | null) {
    if (!backend) this.failed = true;
  }

  getItem(key: string): string | null {
    if (!this.failed) {
      try {
        return this.backend!.getItem(key);
      } catch {
        this.failed = true;
      }
    }
    return this.memory.getItem(key);
  }

  setItem(key: string, value: string): void {
    this.memory.setItem(key, value);
    if (this.failed) return;
    try {
      this.backend!.setItem(key, value);
    } catch {
      this.failed = true;
    }
  }

  removeItem(key: string): void {
    this.memory.removeItem(key);
    if (this.failed) return;
    try {
      this.backend!.removeItem(key);
    } catch {
      this.failed = true;
    }
  }
}

/** `window.localStorage` when it exists and is reachable, else null. */
export function browserLocalStorage(): KeyValueStorage | null {
  try {
    const g = globalThis as any;
    return g.localStorage && typeof g.localStorage.getItem === 'function' ? g.localStorage : null;
  } catch {
    return null; // e.g. SecurityError when storage is blocked
  }
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isUuidV4(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4.test(value);
}

/** Random UUID v4, lowercase and hyphenated. */
export function uuidV4(): string {
  const c = (globalThis as any).crypto;
  if (c && typeof c.randomUUID === 'function') return String(c.randomUUID()).toLowerCase();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The persisted anonymous id, created on first use. */
export function loadOrCreateAnonymousId(storage: KeyValueStorage): string {
  const existing = storage.getItem(ANONYMOUS_ID_KEY);
  if (existing && existing.length > 0 && existing.length <= 256) return existing;
  const id = uuidV4();
  storage.setItem(ANONYMOUS_ID_KEY, id);
  return id;
}
