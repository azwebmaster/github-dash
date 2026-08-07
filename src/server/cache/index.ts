import { MemoryCache } from './memory.js';
import type { CacheStore, CacheStoreOptions } from './types.js';

export type { CacheStore, CacheStoreOptions } from './types.js';
export { MemoryCache } from './memory.js';

/** Default TTL for GitHub responses (ms). Override with CACHE_TTL_MS. */
export const DEFAULT_CACHE_TTL_MS = 300_000;

export function resolveCacheTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.CACHE_TTL_MS;
  if (raw == null || raw === '') return DEFAULT_CACHE_TTL_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_CACHE_TTL_MS;
}

/** Factory — today returns MemoryCache; later can branch on CACHE_BACKEND. */
export function createCache(options: CacheStoreOptions = {}): CacheStore {
  return new MemoryCache({
    defaultTtlMs: options.defaultTtlMs ?? resolveCacheTtlMs(),
  });
}

/** Max GitHub list pages per resource (100 items/page). Prevents hangs on huge windows. */
export const DEFAULT_MAX_PAGES = 20;

export function resolveMaxPages(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.GITHUB_MAX_PAGES;
  if (raw == null || raw === '') return DEFAULT_MAX_PAGES;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_MAX_PAGES;
}
