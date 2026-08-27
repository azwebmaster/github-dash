import type {
  CommitDetail,
  CommitStats,
  CommitSummary,
  OrchestrationHealthSummary,
  OverviewStats,
  PrChecks,
  PrDetail,
  PrStats,
  PrSummary,
  ReleaseDetail,
  ReleaseStats,
  ReleaseSummary,
  WorkflowFailureAnalysis,
  WorkflowLifecycleMap,
  WorkflowRunDetail,
  WorkflowRunSummary,
  WorkflowStats,
} from '../../shared/types';
import { DEFAULT_AGE_LOOKBACK_DAYS, DEFAULT_RUN_LIMIT, type AgeLookbackDays, type RunLimit } from '../../shared/utils';

/** Browser-side TTL so route remounts don't wait on the network for warm data. */
const CLIENT_CACHE_TTL_MS = 60_000;

interface CacheEntry {
  expiresAt: number;
  value: unknown;
}

const clientCache = new Map<string, CacheEntry>();
const clientInflight = new Map<string, Promise<unknown>>();

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const cacheable = method === 'GET';
  const now = Date.now();
  if (cacheable) {
    const cached = clientCache.get(path);
    if (cached && cached.expiresAt > now) {
      return cached.value as T;
    }

    const pending = clientInflight.get(path);
    if (pending) return pending as Promise<T>;
  }

  const promise = (async () => {
    const res = await fetch(path, init);
    if (!res.ok) {
      let message = res.statusText;
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) message = body.error;
      } catch {
        // ignore
      }
      throw new Error(message || `Request failed (${res.status})`);
    }
    const value = (await res.json()) as T;
    if (cacheable) {
      clientCache.set(path, { value, expiresAt: Date.now() + CLIENT_CACHE_TTL_MS });
    }
    return value;
  })().finally(() => {
    if (cacheable) clientInflight.delete(path);
  });

  if (cacheable) clientInflight.set(path, promise);
  return promise;
}

function daysQuery(days: AgeLookbackDays): string {
  const params = new URLSearchParams();
  params.set('days', String(days));
  return params.toString();
}

function limitQuery(limit: RunLimit): string {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  return params.toString();
}

export const api = {
  meta: () =>
    request<{
      owner: string;
      repo: string;
      releaseWorkflowFile: string;
      claudeAnalysisAvailable: boolean;
    }>('/api/meta'),
  overview: (days: AgeLookbackDays = DEFAULT_AGE_LOOKBACK_DAYS) =>
    request<OverviewStats>(`/api/overview?${daysQuery(days)}`),
  prs: (days: AgeLookbackDays = DEFAULT_AGE_LOOKBACK_DAYS) =>
    request<{ items: PrSummary[]; stats: PrStats }>(`/api/prs?${daysQuery(days)}`),
  pr: (n: number) => request<PrDetail>(`/api/prs/${n}`),
  prChecks: (n: number) => request<PrChecks>(`/api/prs/${n}/checks`),
  commits: (days: AgeLookbackDays = DEFAULT_AGE_LOOKBACK_DAYS) =>
    request<{ items: CommitSummary[]; stats: CommitStats }>(`/api/commits?${daysQuery(days)}`),
  commit: (sha: string) => request<CommitDetail>(`/api/commits/${sha}`),
  releases: (days: AgeLookbackDays = DEFAULT_AGE_LOOKBACK_DAYS) =>
    request<{ items: ReleaseSummary[]; stats: ReleaseStats }>(`/api/releases?${daysQuery(days)}`),
  release: (id: number) => request<ReleaseDetail>(`/api/releases/${id}`),
  workflows: (limit: RunLimit = DEFAULT_RUN_LIMIT) =>
    request<{ items: WorkflowRunSummary[]; stats: WorkflowStats }>(
      `/api/workflows?${limitQuery(limit)}`,
    ),
  workflowMap: () => request<WorkflowLifecycleMap>('/api/workflows/map'),
  workflowRuns: (workflowId: number, limit: RunLimit = DEFAULT_RUN_LIMIT) =>
    request<{ workflowId: number; name: string; items: WorkflowRunSummary[] }>(
      `/api/workflows/by/${workflowId}?${limitQuery(limit)}`,
    ),
  workflow: (
    id: number,
    opts?: { includeOrchestration?: boolean; owner?: string; repo?: string },
  ) => {
    const params = new URLSearchParams();
    if (opts?.includeOrchestration === false) params.set('orchestration', '0');
    if (opts?.owner) params.set('owner', opts.owner);
    if (opts?.repo) params.set('repo', opts.repo);
    const qs = params.toString();
    return request<WorkflowRunDetail>(`/api/workflows/${id}${qs ? `?${qs}` : ''}`);
  },
  analyzeWorkflow: (id: number) =>
    request<WorkflowFailureAnalysis>(`/api/workflows/${id}/analyze`, { method: 'POST' }),
  orchestrationHealth: () => request<OrchestrationHealthSummary>('/api/orchestration/health'),
};
