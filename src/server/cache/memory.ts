import type { CacheStore, CacheStoreOptions } from './types.js';

interface Entry {
  value: unknown;
  expiresAt: number | null;
}

/** Process-local TTL cache. Suitable until Redis / remote cache is wired. */
export class MemoryCache implements CacheStore {
  private readonly store = new Map<string, Entry>();
  private readonly defaultTtlMs: number;

  constructor(options: CacheStoreOptions = {}) {
    this.defaultTtlMs = options.defaultTtlMs ?? 300_000;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt != null && Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlMs = this.defaultTtlMs): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: ttlMs > 0 ? Date.now() + ttlMs : null,
    });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}
