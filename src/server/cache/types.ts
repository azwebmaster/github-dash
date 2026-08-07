/**
 * Cache backend contract. Swap `MemoryCache` for Redis / remote later
 * without changing call sites.
 */
export interface CacheStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

export interface CacheStoreOptions {
  /** Default TTL when `set` omits ttlMs. */
  defaultTtlMs?: number;
}
