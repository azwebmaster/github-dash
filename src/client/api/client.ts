import type {
  CommitDetail,
  CommitStats,
  CommitSummary,
  OverviewStats,
  PrDetail,
  PrStats,
  PrSummary,
  ReleaseDetail,
  ReleaseStats,
  ReleaseSummary,
  WorkflowRunDetail,
  WorkflowRunSummary,
  WorkflowStats,
} from '../../shared/types';

async function request<T>(path: string): Promise<T> {
  const res = await fetch(path);
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
  return res.json() as Promise<T>;
}

export const api = {
  meta: () => request<{ owner: string; repo: string }>('/api/meta'),
  overview: () => request<OverviewStats>('/api/overview'),
  prs: () => request<{ items: PrSummary[]; stats: PrStats }>('/api/prs'),
  pr: (n: number) => request<PrDetail>(`/api/prs/${n}`),
  commits: () => request<{ items: CommitSummary[]; stats: CommitStats }>('/api/commits'),
  commit: (sha: string) => request<CommitDetail>(`/api/commits/${sha}`),
  releases: () => request<{ items: ReleaseSummary[]; stats: ReleaseStats }>('/api/releases'),
  release: (id: number) => request<ReleaseDetail>(`/api/releases/${id}`),
  workflows: () => request<{ items: WorkflowRunSummary[]; stats: WorkflowStats }>('/api/workflows'),
  workflowRuns: (workflowId: number) =>
    request<{ workflowId: number; name: string; items: WorkflowRunSummary[] }>(
      `/api/workflows/by/${workflowId}`,
    ),
  workflow: (id: number) => request<WorkflowRunDetail>(`/api/workflows/${id}`),
};
