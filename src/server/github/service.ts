import { Octokit } from '@octokit/rest';
import type {
  CommitDetail,
  CommitStats,
  CommitSummary,
  OrchestrationHealthSummary,
  OverviewInsights,
  OverviewStats,
  PrCheck,
  PrChecks,
  PrDetail,
  PrStats,
  PrSummary,
  ReleaseCreatingRunSummary,
  ReleaseDetail,
  ReleaseStats,
  ReleaseSummary,
  RepoRef,
  StoredWorkflowFailureAnalysis,
  WorkflowConclusionKind,
  WorkflowLifecycleMap,
  WorkflowMapEntry,
  WorkflowRunDetail,
  WorkflowRunSummary,
  WorkflowStats,
} from '../../shared/types.js';
import {
  ageLookbackCutoffIso,
  computeTimingStats,
  DEFAULT_AGE_LOOKBACK_DAYS,
  DEFAULT_RELEASE_WORKFLOW_FILE,
  DEFAULT_RUN_LIMIT,
  hoursBetween,
  isWithinAgeLookback,
  matchReleaseCreatingRun,
  normalizeReleaseWorkflowFile,
  parsePrNumbersFromReleaseNotes,
  PER_WORKFLOW_RUN_SAMPLE,
  rollupCheckState,
  round,
  secondsBetween,
  type AgeLookbackDays,
  type RunLimit,
} from '../../shared/utils.js';
import { createCache, resolveCacheTtlMs, resolveMaxPages, type CacheStore } from '../cache/index.js';
import { loadOrchestrationFromArtifacts } from './orchestration.js';
import { fetchRecentRunsPerWorkflowGraphql } from './workflow-runs-graphql.js';
import {
  extractWorkflowTriggers,
  LIFECYCLE_LANE_META,
  LIFECYCLE_LANE_ORDER,
  lanesForTriggers,
} from './workflow-triggers.js';

const CI_RECENT_CONCLUSION_COUNT = 12;
const ORCHESTRATION_HEALTH_SAMPLE = 10;
const ORCHESTRATION_HEALTH_CONCURRENCY = 3;
/** Stage.State === 3 success, === 4 failure (Go enum). */
const ORCH_STAGE_SUCCESS = 3;
const ORCH_STAGE_FAILURE = 4;

function conclusionKind(conclusion: string | null): WorkflowConclusionKind {
  if (conclusion === 'success') return 'success';
  if (conclusion === 'failure' || conclusion === 'timed_out' || conclusion === 'startup_failure') {
    return 'failure';
  }
  if (conclusion === 'cancelled') return 'cancelled';
  return 'other';
}

function countConsecutiveFailures(runsNewestFirst: WorkflowRunSummary[]): number {
  let n = 0;
  for (const run of runsNewestFirst) {
    if (run.status != null && run.status !== 'completed') continue;
    const kind = conclusionKind(run.conclusion);
    if (kind === 'failure') {
      n += 1;
      continue;
    }
    if (kind === 'success') break;
    // cancelled / other do not break the streak or count
  }
  return n;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await fn(items[i]!);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, () =>
    worker(),
  );
  await Promise.all(workers);
  return results;
}

export interface GitHubServiceOptions {
  token?: string;
  owner: string;
  repo: string;
  /** Optional cache backend (defaults to in-memory). */
  cache?: CacheStore;
  /** Cache TTL in ms (defaults to CACHE_TTL_MS / 60s). */
  cacheTtlMs?: number;
  /** Max pages per list fetch (100 items/page). Defaults to GITHUB_MAX_PAGES / 20. */
  maxPages?: number;
  /** Actions workflow file that creates releases (default `release.yml`). */
  releaseWorkflowFile?: string;
}

export class GitHubService {
  private readonly octokit: Octokit;
  readonly ref: RepoRef;
  readonly releaseWorkflowFile: string;
  private readonly cache: CacheStore;
  private readonly cacheTtlMs: number;
  private readonly maxPages: number;
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(options: GitHubServiceOptions) {
    this.octokit = new Octokit({
      auth: options.token || process.env.GITHUB_TOKEN || undefined,
      userAgent: 'github-dash',
    });
    this.ref = { owner: options.owner, repo: options.repo };
    this.releaseWorkflowFile = normalizeReleaseWorkflowFile(
      options.releaseWorkflowFile ?? process.env.RELEASE_WORKFLOW ?? DEFAULT_RELEASE_WORKFLOW_FILE,
    );
    this.cacheTtlMs = options.cacheTtlMs ?? resolveCacheTtlMs();
    this.cache = options.cache ?? createCache({ defaultTtlMs: this.cacheTtlMs });
    this.maxPages = options.maxPages ?? resolveMaxPages();
  }

  private cacheKey(resource: string, scope: number | string, extra = ''): string {
    return `${this.ref.owner}/${this.ref.repo}:${resource}:${scope}${extra ? `:${extra}` : ''}`;
  }

  private notePageCap(resource: string, pages: number, itemCount: number): void {
    if (pages < this.maxPages) return;
    console.warn(
      `[github] ${this.ref.owner}/${this.ref.repo} ${resource}: hit page cap (${pages}×100, kept ${itemCount}). Set GITHUB_MAX_PAGES to raise.`,
    );
  }

  private cacheDebugEnabled(): boolean {
    const raw = process.env.CACHE_DEBUG;
    return raw === '1' || raw === 'true';
  }

  /** Read-through cache with in-flight dedupe (stampede protection). */
  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = await this.cache.get<T>(key);
    if (hit !== undefined) {
      if (this.cacheDebugEnabled()) console.log(`[cache] HIT  ${key}`);
      return hit;
    }

    const pending = this.inflight.get(key);
    if (pending) {
      if (this.cacheDebugEnabled()) console.log(`[cache] WAIT ${key}`);
      return pending as Promise<T>;
    }

    if (this.cacheDebugEnabled()) console.log(`[cache] MISS ${key}`);

    const promise = (async () => {
      try {
        const value = await load();
        await this.cache.set(key, value, this.cacheTtlMs);
        return value;
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, promise);
    return promise;
  }

  /** Prefetch default lookback lists so the first UI navigation is warm. */
  warmDefaults(days: AgeLookbackDays = DEFAULT_AGE_LOOKBACK_DAYS): void {
    void this.getOverview(days)
      .then(() => this.getOrchestrationHealth())
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[cache] warmDefaults failed: ${message}`);
      });
  }

  private failureAnalysisCacheKey(runId: number): string {
    return this.cacheKey('workflow-failure-analysis', runId);
  }

  /** Read a previously cached Claude failure analysis for this run (if any). */
  async getCachedFailureAnalysis(
    runId: number,
  ): Promise<StoredWorkflowFailureAnalysis | undefined> {
    return this.cache.get<StoredWorkflowFailureAnalysis>(this.failureAnalysisCacheKey(runId));
  }

  /**
   * Persist Claude failure analysis for a run.
   * Uses TTL 0 (no expiry) — completed-run analysis is stable within the process lifetime.
   */
  async setCachedFailureAnalysis(
    runId: number,
    stored: StoredWorkflowFailureAnalysis,
  ): Promise<void> {
    await this.cache.set(this.failureAnalysisCacheKey(runId), stored, 0);
    if (this.cacheDebugEnabled()) {
      console.log(`[cache] SET  ${this.failureAnalysisCacheKey(runId)}`);
    }
  }

  async clearCachedFailureAnalysis(runId: number): Promise<void> {
    await this.cache.delete(this.failureAnalysisCacheKey(runId));
    if (this.cacheDebugEnabled()) {
      console.log(`[cache] DEL  ${this.failureAnalysisCacheKey(runId)}`);
    }
  }

  async getOverview(days: AgeLookbackDays = DEFAULT_AGE_LOOKBACK_DAYS): Promise<OverviewStats> {
    return this.cached(this.cacheKey('overview', days, this.releaseWorkflowFile), async () => {
      const { data: repo } = await this.octokit.repos.get({
        owner: this.ref.owner,
        repo: this.ref.repo,
      });

      const [prs, commits, releases, workflows, prList, releaseList, orchestrationSummary] =
        await Promise.all([
          this.getPrStats(days),
          this.getCommitStats(days),
          this.getReleaseStats(days),
          this.getWorkflowStats(),
          this.listPullRequests(days),
          this.listReleases(days),
          this.getOrchestrationHealth(),
        ]);

      const insights = this.buildOverviewInsights({
        prs: prList,
        workflows,
        releases: releaseList,
        orchestrationSummary,
      });

      return {
        repo: {
          fullName: repo.full_name,
          description: repo.description,
          htmlUrl: repo.html_url,
          defaultBranch: repo.default_branch,
          stars: repo.stargazers_count,
          forks: repo.forks_count,
          openIssues: repo.open_issues_count,
          language: repo.language,
          pushedAt: repo.pushed_at,
        },
        prs,
        commits,
        releases,
        workflows,
        insights,
      };
    });
  }

  private buildOverviewInsights(input: {
    prs: PrSummary[];
    workflows: WorkflowStats;
    releases: ReleaseSummary[];
    orchestrationSummary: OrchestrationHealthSummary;
  }): OverviewInsights {
    const oldestOpenPrs = input.prs
      .filter((p) => p.state === 'open')
      .sort((a, b) => (b.ageHours ?? 0) - (a.ageHours ?? 0))
      .slice(0, 3)
      .map((p) => ({
        number: p.number,
        title: p.title,
        ageHours: p.ageHours,
        htmlUrl: p.htmlUrl,
      }));

    const withRuns = input.workflows.byWorkflow.filter((w) => w.total >= 3);
    const attentionWorkflows = [...withRuns]
      .sort((a, b) => {
        const flake = b.consecutiveFailures - a.consecutiveFailures;
        if (flake !== 0) return flake;
        return a.successRate - b.successRate;
      })
      .filter((w) => w.consecutiveFailures > 0 || w.successRate < 85)
      .slice(0, 5)
      .map((w) => ({
        workflowId: w.workflowId,
        name: w.name,
        successRate: w.successRate,
        consecutiveFailures: w.consecutiveFailures,
        avgDurationSeconds: w.avgDurationSeconds,
      }));

    const slowestWorkflows = [...withRuns]
      .filter((w) => w.avgDurationSeconds != null)
      .sort((a, b) => (b.avgDurationSeconds ?? 0) - (a.avgDurationSeconds ?? 0))
      .slice(0, 3)
      .map((w) => ({
        workflowId: w.workflowId,
        name: w.name,
        avgDurationSeconds: w.avgDurationSeconds,
      }));

    const latestPublished = input.releases
      .filter((r) => !r.draft && r.publishedAt)
      .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))[0];
    const releaseGapHours = latestPublished?.publishedAt
      ? hoursBetween(latestPublished.publishedAt, new Date().toISOString())
      : null;

    return {
      oldestOpenPrs,
      attentionWorkflows,
      slowestWorkflows,
      releaseGapHours,
      orchestrationSummary:
        input.orchestrationSummary.sampleSize > 0 ? input.orchestrationSummary : null,
    };
  }

  async listPullRequests(days: AgeLookbackDays = DEFAULT_AGE_LOOKBACK_DAYS): Promise<PrSummary[]> {
    return this.cached(this.cacheKey('prs', days), async () => {
      type PrItem = Awaited<ReturnType<typeof this.octokit.pulls.list>>['data'][number];
      const raw: PrItem[] = [];

      // Sort by created so we can stop once items fall outside the lookback window.
      let pages = 0;
      for await (const page of this.octokit.paginate.iterator(this.octokit.pulls.list, {
        owner: this.ref.owner,
        repo: this.ref.repo,
        state: 'all',
        sort: 'created',
        direction: 'desc',
        per_page: 100,
      })) {
        pages += 1;
        let reachedCutoff = false;
        for (const pr of page.data) {
          if (!isWithinAgeLookback(pr.created_at, days)) {
            reachedCutoff = true;
            break;
          }
          raw.push(pr);
        }
        if (reachedCutoff || pages >= this.maxPages) break;
      }
      this.notePageCap('prs', pages, raw.length);

      return raw.map((pr) => {
        const merged = Boolean(pr.merged_at);
        return {
          number: pr.number,
          title: pr.title,
          state: pr.state as 'open' | 'closed',
          draft: Boolean(pr.draft),
          merged,
          author: pr.user?.login ?? null,
          createdAt: pr.created_at,
          updatedAt: pr.updated_at,
          closedAt: pr.closed_at,
          mergedAt: pr.merged_at,
          ageHours: hoursBetween(
            pr.created_at,
            pr.merged_at ?? pr.closed_at ?? new Date().toISOString(),
          ),
          timeToCloseHours: hoursBetween(pr.created_at, pr.closed_at),
          timeToMergeHours: merged ? hoursBetween(pr.created_at, pr.merged_at) : null,
          // List endpoint omits diff stats; filled on detail fetch
          comments: 'comments' in pr && typeof pr.comments === 'number' ? pr.comments : 0,
          additions: 'additions' in pr && typeof pr.additions === 'number' ? pr.additions : 0,
          deletions: 'deletions' in pr && typeof pr.deletions === 'number' ? pr.deletions : 0,
          changedFiles:
            'changed_files' in pr && typeof pr.changed_files === 'number' ? pr.changed_files : 0,
          labels: (pr.labels ?? [])
            .map((l) => (typeof l === 'string' ? l : l.name ?? ''))
            .filter(Boolean),
          base: pr.base.ref,
          head: pr.head.ref,
          htmlUrl: pr.html_url,
        };
      });
    });
  }

  async getPrStats(days: AgeLookbackDays = DEFAULT_AGE_LOOKBACK_DAYS): Promise<PrStats> {
    const prs = await this.listPullRequests(days);
    const open = prs.filter((p) => p.state === 'open').length;
    const closed = prs.filter((p) => p.state === 'closed' && !p.merged).length;
    const merged = prs.filter((p) => p.merged).length;
    const draft = prs.filter((p) => p.draft).length;

    const authorMap = new Map<string, number>();
    for (const pr of prs) {
      if (!pr.author) continue;
      authorMap.set(pr.author, (authorMap.get(pr.author) ?? 0) + 1);
    }

    const withDiff = prs.filter((p) => p.additions > 0 || p.deletions > 0 || p.changedFiles > 0);

    return {
      total: prs.length,
      open,
      closed,
      merged,
      draft,
      ageTiming: computeTimingStats(prs.map((p) => p.ageHours)),
      closeTiming: computeTimingStats(prs.filter((p) => !p.merged).map((p) => p.timeToCloseHours)),
      mergeTiming: computeTimingStats(prs.filter((p) => p.merged).map((p) => p.timeToMergeHours)),
      avgAdditions: withDiff.length
        ? round(withDiff.reduce((s, p) => s + p.additions, 0) / withDiff.length)
        : 0,
      avgDeletions: withDiff.length
        ? round(withDiff.reduce((s, p) => s + p.deletions, 0) / withDiff.length)
        : 0,
      avgChangedFiles: withDiff.length
        ? round(withDiff.reduce((s, p) => s + p.changedFiles, 0) / withDiff.length)
        : 0,
      topAuthors: [...authorMap.entries()]
        .map(([login, count]) => ({ login, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
    };
  }

  /** Lightweight PR metadata for release-note association (batched, soft-fail). */
  async getPullRequestSummaries(
    numbers: number[],
  ): Promise<
    Array<{
      number: number;
      title: string | null;
      author: string | null;
      htmlUrl: string | null;
      mergedAt: string | null;
    }>
  > {
    const unique = [...new Set(numbers)].filter((n) => Number.isFinite(n) && n > 0).slice(0, 50);
    return Promise.all(
      unique.map(async (num) => {
        try {
          const { data: pr } = await this.octokit.pulls.get({
            owner: this.ref.owner,
            repo: this.ref.repo,
            pull_number: num,
          });
          return {
            number: pr.number,
            title: pr.title,
            htmlUrl: pr.html_url,
            mergedAt: pr.merged_at,
            author: pr.user?.login ?? null,
          };
        } catch {
          return {
            number: num,
            title: null,
            htmlUrl: null,
            mergedAt: null,
            author: null,
          };
        }
      }),
    );
  }

  /** Resolve a GitHub Release by tag name (e.g. workflow head_branch / orchestration.branch). */
  async findReleaseByTag(tagName: string): Promise<ReleaseDetail | null> {
    const tag = tagName.replace(/^refs\/tags\//, '').trim();
    if (!tag) return null;
    return this.cached(this.cacheKey('release-by-tag', tag, this.releaseWorkflowFile), async () => {
      try {
        const { data: rel } = await this.octokit.repos.getReleaseByTag({
          owner: this.ref.owner,
          repo: this.ref.repo,
          tag,
        });
        return await this.getRelease(rel.id);
      } catch (err) {
        const status =
          typeof err === 'object' && err && 'status' in err
            ? (err as { status: number }).status
            : undefined;
        if (status === 404) return null;
        throw err;
      }
    });
  }

  /** Changed file paths for a PR (capped) — used by failure analysis agent tools. */
  async listPullRequestFiles(
    number: number,
    limit = 40,
  ): Promise<Array<{ filename: string; status: string; additions: number; deletions: number }>> {
    return this.cached(this.cacheKey('pr-files', number, String(limit)), async () => {
      const files: Array<{
        filename: string;
        status: string;
        additions: number;
        deletions: number;
      }> = [];
      for await (const page of this.octokit.paginate.iterator(this.octokit.pulls.listFiles, {
        owner: this.ref.owner,
        repo: this.ref.repo,
        pull_number: number,
        per_page: 100,
      })) {
        for (const f of page.data) {
          files.push({
            filename: f.filename,
            status: f.status,
            additions: f.additions,
            deletions: f.deletions,
          });
          if (files.length >= limit) return files;
        }
      }
      return files;
    });
  }

  async getPullRequest(number: number): Promise<PrDetail> {
    return this.cached(this.cacheKey('pr', number), async () => {
      const { data: pr } = await this.octokit.pulls.get({
        owner: this.ref.owner,
        repo: this.ref.repo,
        pull_number: number,
      });

      const [{ data: commits }, { data: reviews }, timeline] = await Promise.all([
        this.octokit.pulls.listCommits({
          owner: this.ref.owner,
          repo: this.ref.repo,
          pull_number: number,
          per_page: 100,
        }),
        this.octokit.pulls.listReviews({
          owner: this.ref.owner,
          repo: this.ref.repo,
          pull_number: number,
          per_page: 100,
        }),
        this.fetchPrTimeline(number),
      ]);

      const merged = Boolean(pr.merged_at);
      const reviewers = [
        ...new Set(reviews.map((r) => r.user?.login).filter((x): x is string => Boolean(x))),
      ];

      return {
        number: pr.number,
        title: pr.title,
        state: pr.state as 'open' | 'closed',
        draft: Boolean(pr.draft),
        merged,
        author: pr.user?.login ?? null,
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
        closedAt: pr.closed_at,
        mergedAt: pr.merged_at,
        ageHours: hoursBetween(
          pr.created_at,
          pr.merged_at ?? pr.closed_at ?? new Date().toISOString(),
        ),
        timeToCloseHours: hoursBetween(pr.created_at, pr.closed_at),
        timeToMergeHours: merged ? hoursBetween(pr.created_at, pr.merged_at) : null,
        comments: pr.comments,
        additions: pr.additions,
        deletions: pr.deletions,
        changedFiles: pr.changed_files,
        labels: pr.labels.map((l) => l.name).filter(Boolean),
        base: pr.base.ref,
        head: pr.head.ref,
        htmlUrl: pr.html_url,
        body: pr.body,
        commits: commits.length,
        headSha: pr.head.sha,
        reviewers,
        requestedReviewers: (pr.requested_reviewers ?? [])
          .map((u) => ('login' in u ? u.login : null))
          .filter((x): x is string => Boolean(x)),
        timeline,
      };
    });
  }

  async getPullRequestChecks(number: number): Promise<PrChecks> {
    return this.cached(this.cacheKey('pr-checks', number), async () => {
      const { data: pr } = await this.octokit.pulls.get({
        owner: this.ref.owner,
        repo: this.ref.repo,
        pull_number: number,
      });

      const headSha = pr.head.sha;
      const checks: PrCheck[] = [];

      try {
        const { data } = await this.octokit.checks.listForRef({
          owner: this.ref.owner,
          repo: this.ref.repo,
          ref: headSha,
          per_page: 100,
        });

        for (const run of data.check_runs) {
          checks.push({
            id: run.id,
            name: run.name,
            status: run.status,
            conclusion: run.conclusion,
            startedAt: run.started_at ?? null,
            completedAt: run.completed_at ?? null,
            durationSeconds: secondsBetween(run.started_at, run.completed_at),
            htmlUrl: run.html_url ?? run.details_url ?? null,
            appName: run.app?.name ?? null,
          });
        }
      } catch {
        // Checks API can 403 without Actions/checks permission; fall through to statuses.
      }

      const checkNames = new Set(checks.map((c) => c.name.toLowerCase()));

      try {
        const { data: combined } = await this.octokit.repos.getCombinedStatusForRef({
          owner: this.ref.owner,
          repo: this.ref.repo,
          ref: headSha,
        });

        for (const status of combined.statuses) {
          const name = status.context || 'status';
          if (checkNames.has(name.toLowerCase())) continue;
          const state = status.state;
          const completed = state !== 'pending';
          checks.push({
            id: status.id,
            name,
            status: completed ? 'completed' : 'in_progress',
            conclusion: completed
              ? state === 'success'
                ? 'success'
                : state === 'failure'
                  ? 'failure'
                  : state === 'error'
                    ? 'failure'
                    : 'neutral'
              : null,
            startedAt: status.created_at ?? null,
            completedAt: completed ? (status.updated_at ?? null) : null,
            durationSeconds: completed
              ? secondsBetween(status.created_at, status.updated_at)
              : null,
            htmlUrl: status.target_url ?? null,
            appName: null,
          });
        }
      } catch {
        // Statuses may be unavailable; check runs alone are still useful.
      }

      checks.sort((a, b) => {
        const aPending = a.status !== 'completed' ? 0 : 1;
        const bPending = b.status !== 'completed' ? 0 : 1;
        if (aPending !== bPending) return aPending - bPending;
        return a.name.localeCompare(b.name);
      });

      return {
        headSha,
        shortSha: headSha.slice(0, 7),
        state: rollupCheckState(checks),
        totalCount: checks.length,
        checks,
      };
    });
  }

  private async fetchPrTimeline(number: number) {
    try {
      type TimelineEvent = {
        event?: string;
        created_at?: string;
        actor?: { login?: string } | null;
      };

      const events: TimelineEvent[] = [];
      for await (const page of this.octokit.paginate.iterator({
        method: 'GET',
        url: `/repos/${this.ref.owner}/${this.ref.repo}/issues/${number}/timeline`,
        headers: { accept: 'application/vnd.github+json' },
        per_page: 100,
      })) {
        events.push(...(page.data as TimelineEvent[]));
        if (events.length >= 100) break;
      }

      return events
        .filter((e) => Boolean(e.event))
        .slice(-40)
        .map((event) => ({
          event: event.event ?? 'unknown',
          createdAt: event.created_at ?? '',
          actor: event.actor?.login ?? null,
        }));
    } catch {
      return [];
    }
  }

  async listCommits(days: AgeLookbackDays = DEFAULT_AGE_LOOKBACK_DAYS): Promise<CommitSummary[]> {
    return this.cached(this.cacheKey('commits', days), async () => {
      type CommitItem = Awaited<ReturnType<typeof this.octokit.repos.listCommits>>['data'][number];
      const raw: CommitItem[] = [];
      const since = ageLookbackCutoffIso(days);

      // Always bound by age via GitHub `since` — never fetch full history.
      let pages = 0;
      for await (const page of this.octokit.paginate.iterator(this.octokit.repos.listCommits, {
        owner: this.ref.owner,
        repo: this.ref.repo,
        per_page: 100,
        since,
      })) {
        pages += 1;
        raw.push(...page.data);
        if (pages >= this.maxPages) break;
      }
      this.notePageCap('commits', pages, raw.length);

      return raw.map((c) => ({
        sha: c.sha,
        shortSha: c.sha.slice(0, 7),
        message: (c.commit.message ?? '').split('\n')[0] ?? '',
        authorName: c.commit.author?.name ?? null,
        authorLogin: c.author?.login ?? null,
        authorDate: c.commit.author?.date ?? null,
        committerDate: c.commit.committer?.date ?? null,
        htmlUrl: c.html_url,
        verified: Boolean(c.commit.verification?.verified),
      }));
    });
  }

  async getCommitStats(days: AgeLookbackDays = DEFAULT_AGE_LOOKBACK_DAYS): Promise<CommitStats> {
    const commits = await this.listCommits(days);
    const authorMap = new Map<string, number>();
    const dayMap = new Map<string, number>();

    for (const c of commits) {
      const key = c.authorLogin ?? c.authorName ?? 'unknown';
      authorMap.set(key, (authorMap.get(key) ?? 0) + 1);
      if (c.authorDate) {
        const day = c.authorDate.slice(0, 10);
        dayMap.set(day, (dayMap.get(day) ?? 0) + 1);
      }
    }

    return {
      total: commits.length,
      verified: commits.filter((c) => c.verified).length,
      topAuthors: [...authorMap.entries()]
        .map(([login, count]) => ({ login, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      commitsPerDay: [...dayMap.entries()]
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  async getCommit(sha: string): Promise<CommitDetail> {
    return this.cached(this.cacheKey('commit', sha), async () => {
      const { data: c } = await this.octokit.repos.getCommit({
        owner: this.ref.owner,
        repo: this.ref.repo,
        ref: sha,
      });

      const messageParts = (c.commit.message ?? '').split('\n');
      const message = messageParts[0] ?? '';
      const body = messageParts.slice(1).join('\n').trim();

      return {
        sha: c.sha,
        shortSha: c.sha.slice(0, 7),
        message,
        body,
        authorName: c.commit.author?.name ?? null,
        authorLogin: c.author?.login ?? null,
        authorDate: c.commit.author?.date ?? null,
        committerDate: c.commit.committer?.date ?? null,
        htmlUrl: c.html_url,
        verified: Boolean(c.commit.verification?.verified),
        parents: c.parents.map((p) => p.sha),
        stats: {
          additions: c.stats?.additions ?? 0,
          deletions: c.stats?.deletions ?? 0,
          total: c.stats?.total ?? 0,
        },
        files: (c.files ?? []).map((f) => ({
          filename: f.filename ?? '',
          status: f.status ?? 'modified',
          additions: f.additions ?? 0,
          deletions: f.deletions ?? 0,
          changes: f.changes ?? 0,
        })),
      };
    });
  }

  private toCreatingRunSummary(run: WorkflowRunSummary): ReleaseCreatingRunSummary {
    return {
      id: run.id,
      workflowId: run.workflowId,
      status: run.status,
      conclusion: run.conclusion,
      event: run.event,
      durationSeconds: run.durationSeconds,
      htmlUrl: run.htmlUrl,
      createdAt: run.createdAt,
      attempt: run.attempt,
    };
  }

  /**
   * Recent runs for the configured release-creating workflow (`release.yml` by default).
   * Returns [] when the workflow file is missing so release pages still load.
   */
  async listReleaseCreatingWorkflowRuns(): Promise<WorkflowRunSummary[]> {
    return this.cached(this.cacheKey('release-workflow-runs', this.releaseWorkflowFile), async () => {
      type RunItem = Awaited<
        ReturnType<typeof this.octokit.actions.listWorkflowRuns>
      >['data']['workflow_runs'][number];
      const raw: RunItem[] = [];

      try {
        let pages = 0;
        for await (const page of this.octokit.paginate.iterator(this.octokit.actions.listWorkflowRuns, {
          owner: this.ref.owner,
          repo: this.ref.repo,
          workflow_id: this.releaseWorkflowFile,
          per_page: 100,
        })) {
          pages += 1;
          raw.push(...page.data);
          if (pages >= this.maxPages) break;
        }
        this.notePageCap(`release-workflow:${this.releaseWorkflowFile}`, pages, raw.length);
      } catch (err) {
        const status =
          err && typeof err === 'object' && 'status' in err ? Number((err as { status: unknown }).status) : NaN;
        if (status === 404) {
          console.warn(
            `[github] release workflow "${this.releaseWorkflowFile}" not found in ${this.ref.owner}/${this.ref.repo}`,
          );
          return [];
        }
        throw err;
      }

      return raw.map((run) => this.mapWorkflowRun(run));
    });
  }

  private async resolveCreatingRun(
    tagName: string,
    publishedAt: string | null | undefined,
    targetCommitish?: string | null,
  ): Promise<ReleaseCreatingRunSummary | null> {
    const runs = await this.listReleaseCreatingWorkflowRuns();
    const match = matchReleaseCreatingRun(tagName, publishedAt, runs, targetCommitish);
    return match ? this.toCreatingRunSummary(match) : null;
  }

  async listReleases(days: AgeLookbackDays = DEFAULT_AGE_LOOKBACK_DAYS): Promise<ReleaseSummary[]> {
    return this.cached(this.cacheKey('releases', days, this.releaseWorkflowFile), async () => {
      type ReleaseItem = Awaited<ReturnType<typeof this.octokit.repos.listReleases>>['data'][number];
      const raw: ReleaseItem[] = [];

      let pages = 0;
      for await (const page of this.octokit.paginate.iterator(this.octokit.repos.listReleases, {
        owner: this.ref.owner,
        repo: this.ref.repo,
        per_page: 100,
      })) {
        pages += 1;
        let reachedCutoff = false;
        for (const rel of page.data) {
          if (!isWithinAgeLookback(rel.published_at ?? rel.created_at, days)) {
            reachedCutoff = true;
            break;
          }
          raw.push(rel);
        }
        if (reachedCutoff || pages >= this.maxPages) break;
      }
      this.notePageCap('releases', pages, raw.length);

      const creatingRuns = await this.listReleaseCreatingWorkflowRuns();

      // API returns newest first; compute cadence vs previous (older) release
      const chronological = [...raw].reverse();
      const withTiming = chronological.map((rel, idx) => {
        const associatedPrNumbers = parsePrNumbersFromReleaseNotes(rel.body);
        const previous = idx > 0 ? chronological[idx - 1] : null;
        const prevTime = previous?.published_at ?? previous?.created_at;
        const thisTime = rel.published_at ?? rel.created_at;
        const creatingRun = matchReleaseCreatingRun(
          rel.tag_name,
          rel.published_at,
          creatingRuns,
          rel.target_commitish,
        );
        return {
          id: rel.id,
          tagName: rel.tag_name,
          name: rel.name || rel.tag_name,
          draft: rel.draft,
          prerelease: rel.prerelease,
          author: rel.author?.login ?? null,
          createdAt: rel.created_at,
          publishedAt: rel.published_at,
          htmlUrl: rel.html_url,
          timeSincePreviousHours: hoursBetween(prevTime, thisTime),
          associatedPrNumbers,
          associatedPrCount: associatedPrNumbers.length,
          creatingRun: creatingRun ? this.toCreatingRunSummary(creatingRun) : null,
          targetCommitish: rel.target_commitish ?? null,
        };
      });

      return withTiming.reverse();
    });
  }

  async getReleaseStats(days: AgeLookbackDays = DEFAULT_AGE_LOOKBACK_DAYS): Promise<ReleaseStats> {
    const releases = await this.listReleases(days);
    const published = releases.filter((r) => !r.draft && r.publishedAt);
    const matched = releases.filter((r) => r.creatingRun != null);
    const creatingSuccess = matched.filter((r) => r.creatingRun?.conclusion === 'success').length;
    const creatingFailure = matched.filter((r) => r.creatingRun?.conclusion === 'failure').length;
    return {
      total: releases.length,
      drafts: releases.filter((r) => r.draft).length,
      prereleases: releases.filter((r) => r.prerelease).length,
      published: published.length,
      releaseCadence: computeTimingStats(releases.map((r) => r.timeSincePreviousHours)),
      avgPrsPerRelease: releases.length
        ? round(releases.reduce((s, r) => s + r.associatedPrCount, 0) / releases.length)
        : 0,
      associatedPrTotal: releases.reduce((s, r) => s + r.associatedPrCount, 0),
      creatingWorkflowFile: this.releaseWorkflowFile,
      creatingRunsMatched: matched.length,
      creatingRunsMissing: releases.length - matched.length,
      creatingRunSuccess: creatingSuccess,
      creatingRunFailure: creatingFailure,
      creatingRunSuccessRate: matched.length ? round((creatingSuccess / matched.length) * 100, 1) : 0,
      creatingRunDuration: computeTimingStats(
        matched.map((r) => (r.creatingRun?.durationSeconds != null ? r.creatingRun.durationSeconds / 3600 : null)),
      ),
    };
  }

  async getRelease(id: number): Promise<ReleaseDetail> {
    return this.cached(this.cacheKey('release', id, this.releaseWorkflowFile), async () => {
      const { data: rel } = await this.octokit.repos.getRelease({
        owner: this.ref.owner,
        repo: this.ref.repo,
        release_id: id,
      });

      const thisTime = rel.published_at ?? rel.created_at;
      let timeSincePreviousHours: number | null = null;
      let seen = false;
      outer: for await (const page of this.octokit.paginate.iterator(this.octokit.repos.listReleases, {
        owner: this.ref.owner,
        repo: this.ref.repo,
        per_page: 100,
      })) {
        for (const r of page.data) {
          if (seen) {
            timeSincePreviousHours = hoursBetween(r.published_at ?? r.created_at, thisTime);
            break outer;
          }
          if (r.id === id) seen = true;
        }
      }

      const associatedPrNumbers = parsePrNumbersFromReleaseNotes(rel.body);
      const [associatedPrs, creatingRun] = await Promise.all([
        Promise.all(
          associatedPrNumbers.slice(0, 50).map(async (num) => {
            try {
              const { data: pr } = await this.octokit.pulls.get({
                owner: this.ref.owner,
                repo: this.ref.repo,
                pull_number: num,
              });
              return {
                number: pr.number,
                title: pr.title,
                htmlUrl: pr.html_url,
                mergedAt: pr.merged_at,
                author: pr.user?.login ?? null,
              };
            } catch {
              return {
                number: num,
                title: null,
                htmlUrl: null,
                mergedAt: null,
                author: null,
              };
            }
          }),
        ),
        this.resolveCreatingRun(rel.tag_name, rel.published_at, rel.target_commitish),
      ]);

      return {
        id: rel.id,
        tagName: rel.tag_name,
        name: rel.name || rel.tag_name,
        draft: rel.draft,
        prerelease: rel.prerelease,
        author: rel.author?.login ?? null,
        createdAt: rel.created_at,
        publishedAt: rel.published_at,
        htmlUrl: rel.html_url,
        timeSincePreviousHours,
        associatedPrNumbers,
        associatedPrCount: associatedPrNumbers.length,
        creatingRun,
        targetCommitish: rel.target_commitish ?? null,
        body: rel.body ?? null,
        associatedPrs,
        assets: (rel.assets ?? []).map((a) => ({
          name: a.name,
          size: a.size,
          downloadCount: a.download_count,
          contentType: a.content_type,
        })),
      };
    });
  }

  private mapWorkflowRun(run: {
    id: number;
    name?: string | null;
    display_title?: string | null;
    workflow_id: number;
    status?: string | null;
    conclusion?: string | null;
    event: string;
    head_branch?: string | null;
    head_sha?: string | null;
    created_at: string;
    updated_at: string;
    run_started_at?: string | null;
    html_url: string;
    run_attempt?: number | null;
  }): WorkflowRunSummary {
    const started = run.run_started_at ?? run.created_at;
    const ended = run.status === 'completed' ? run.updated_at : null;
    return {
      id: run.id,
      name: run.name ?? run.display_title ?? 'Workflow',
      workflowId: run.workflow_id,
      workflowName: run.name ?? String(run.workflow_id),
      status: run.status ?? null,
      conclusion: run.conclusion ?? null,
      event: run.event,
      branch: run.head_branch ?? '',
      headSha: run.head_sha ?? '',
      createdAt: run.created_at,
      updatedAt: run.updated_at,
      runStartedAt: run.run_started_at ?? null,
      durationSeconds: secondsBetween(started, ended),
      htmlUrl: run.html_url,
      attempt: run.run_attempt ?? 1,
    };
  }

  /** All workflow definitions in the repo (not derived from recent runs). */
  async listWorkflows(): Promise<
    Array<{ id: number; name: string; state: string; path: string; nodeId: string }>
  > {
    return this.cached(this.cacheKey('workflow-defs', 'all'), async () => {
      type WorkflowItem = Awaited<
        ReturnType<typeof this.octokit.actions.listRepoWorkflows>
      >['data']['workflows'][number];
      const raw: WorkflowItem[] = [];

      let pages = 0;
      for await (const page of this.octokit.paginate.iterator(this.octokit.actions.listRepoWorkflows, {
        owner: this.ref.owner,
        repo: this.ref.repo,
        per_page: 100,
      })) {
        pages += 1;
        raw.push(...page.data);
        if (pages >= this.maxPages) break;
      }
      this.notePageCap('workflow-defs', pages, raw.length);

      return raw
        .filter((w) => w.state !== 'deleted')
        .map((w) => ({
          id: w.id,
          name: w.name,
          state: w.state,
          path: w.path,
          nodeId: w.node_id,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    });
  }

  /**
   * Up to `perWorkflow` most recent runs for every workflow definition.
   * Prefer a GraphQL `nodes(ids:)` batch; fall back to one REST list per workflow.
   */
  async listRecentRunsPerWorkflow(
    perWorkflow: number = PER_WORKFLOW_RUN_SAMPLE,
  ): Promise<{
    workflows: Array<{ id: number; name: string; state: string; path: string; nodeId: string }>;
    runsByWorkflowId: Map<number, WorkflowRunSummary[]>;
  }> {
    return this.cached(this.cacheKey('workflow-runs-per', `n:${perWorkflow}`), async () => {
      const workflows = await this.listWorkflows();
      try {
        const runsByWorkflowId = await fetchRecentRunsPerWorkflowGraphql(
          this.octokit,
          workflows,
          perWorkflow,
        );
        return { workflows, runsByWorkflowId };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[github] GraphQL per-workflow runs failed; falling back to REST: ${message}`);
        const runsByWorkflowId = new Map<number, WorkflowRunSummary[]>();
        // Bound concurrency so a large repo does not stampede the REST API.
        const concurrency = 6;
        let cursor = 0;
        const workers = Array.from({ length: Math.min(concurrency, workflows.length) }, async () => {
          while (cursor < workflows.length) {
            const index = cursor;
            cursor += 1;
            const wf = workflows[index]!;
            const { items } = await this.listRunsForWorkflow(wf.id, 50);
            runsByWorkflowId.set(wf.id, items.slice(0, perWorkflow));
          }
        });
        await Promise.all(workers);
        return { workflows, runsByWorkflowId };
      }
    });
  }

  async listWorkflowRuns(limit: RunLimit = DEFAULT_RUN_LIMIT): Promise<WorkflowRunSummary[]> {
    return this.cached(this.cacheKey('workflows', `limit:${limit}`), async () => {
      type RunItem = Awaited<
        ReturnType<typeof this.octokit.actions.listWorkflowRunsForRepo>
      >['data']['workflow_runs'][number];
      const raw: RunItem[] = [];

      let pages = 0;
      for await (const page of this.octokit.paginate.iterator(
        this.octokit.actions.listWorkflowRunsForRepo,
        {
          owner: this.ref.owner,
          repo: this.ref.repo,
          per_page: 100,
        },
      )) {
        pages += 1;
        for (const run of page.data) {
          raw.push(run);
          if (raw.length >= limit) break;
        }
        if (raw.length >= limit || pages >= this.maxPages) break;
      }
      this.notePageCap('workflows', pages, raw.length);

      return raw.slice(0, limit).map((run) => this.mapWorkflowRun(run));
    });
  }

  /** Runs for a single workflow definition, bounded by recent-run count. */
  async listRunsForWorkflow(
    workflowId: number,
    limit: RunLimit = DEFAULT_RUN_LIMIT,
  ): Promise<{
    workflowId: number;
    name: string;
    items: WorkflowRunSummary[];
  }> {
    return this.cached(this.cacheKey('workflow-runs', `limit:${limit}`, String(workflowId)), async () => {
      type RunItem = Awaited<
        ReturnType<typeof this.octokit.actions.listWorkflowRuns>
      >['data']['workflow_runs'][number];
      const raw: RunItem[] = [];

      let pages = 0;
      for await (const page of this.octokit.paginate.iterator(this.octokit.actions.listWorkflowRuns, {
        owner: this.ref.owner,
        repo: this.ref.repo,
        workflow_id: workflowId,
        per_page: 100,
      })) {
        pages += 1;
        for (const run of page.data) {
          raw.push(run);
          if (raw.length >= limit) break;
        }
        if (raw.length >= limit || pages >= this.maxPages) break;
      }
      this.notePageCap(`workflow:${workflowId}`, pages, raw.length);

      const items = raw.slice(0, limit).map((run) => this.mapWorkflowRun(run));
      let name = items[0]?.workflowName;

      if (!name) {
        try {
          const { data: workflow } = await this.octokit.actions.getWorkflow({
            owner: this.ref.owner,
            repo: this.ref.repo,
            workflow_id: workflowId,
          });
          name = workflow.name;
        } catch {
          name = `Workflow ${workflowId}`;
        }
      }

      return { workflowId, name, items };
    });
  }

  async getWorkflowStats(_limit: RunLimit = DEFAULT_RUN_LIMIT): Promise<WorkflowStats> {
    // Fair sample: last N runs per workflow via GraphQL batch (not a single repo-wide list).
    const { workflows, runsByWorkflowId } = await this.listRecentRunsPerWorkflow(PER_WORKFLOW_RUN_SAMPLE);
    const runs = [...runsByWorkflowId.values()].flat();

    const success = runs.filter((r) => r.conclusion === 'success').length;
    const failure = runs.filter((r) => r.conclusion === 'failure').length;
    const cancelled = runs.filter((r) => r.conclusion === 'cancelled').length;
    const other = runs.length - success - failure - cancelled;

    const byWorkflowMap = new Map<
      number,
      {
        name: string;
        total: number;
        success: number;
        failure: number;
        durations: number[];
        runsNewestFirst: WorkflowRunSummary[];
      }
    >();

    for (const workflow of workflows) {
      byWorkflowMap.set(workflow.id, {
        name: workflow.name,
        total: 0,
        success: 0,
        failure: 0,
        durations: [],
        runsNewestFirst: [],
      });
    }

    const dayMap = new Map<string, { success: number; failure: number; other: number }>();

    for (const run of runs) {
      const entry = byWorkflowMap.get(run.workflowId) ?? {
        name: run.workflowName,
        total: 0,
        success: 0,
        failure: 0,
        durations: [],
        runsNewestFirst: [],
      };
      if (!byWorkflowMap.has(run.workflowId)) {
        entry.name = run.workflowName;
      }
      entry.total += 1;
      if (run.conclusion === 'success') entry.success += 1;
      if (run.conclusion === 'failure') entry.failure += 1;
      if (run.durationSeconds != null) entry.durations.push(run.durationSeconds);
      entry.runsNewestFirst.push(run);
      byWorkflowMap.set(run.workflowId, entry);

      const day = (run.runStartedAt ?? run.createdAt).slice(0, 10);
      const dayEntry = dayMap.get(day) ?? { success: 0, failure: 0, other: 0 };
      if (run.conclusion === 'success') dayEntry.success += 1;
      else if (run.conclusion === 'failure') dayEntry.failure += 1;
      else dayEntry.other += 1;
      dayMap.set(day, dayEntry);
    }

    const durationHours = runs.map((r) => (r.durationSeconds != null ? r.durationSeconds / 3600 : null));

    return {
      totalRuns: runs.length,
      success,
      failure,
      cancelled,
      other,
      successRate: runs.length ? round((success / runs.length) * 100, 1) : 0,
      duration: computeTimingStats(durationHours),
      byWorkflow: [...byWorkflowMap.entries()]
        .map(([workflowId, v]) => {
          const sorted = [...v.runsNewestFirst].sort((a, b) =>
            (b.runStartedAt ?? b.createdAt).localeCompare(a.runStartedAt ?? a.createdAt),
          );
          const recentConclusions = sorted
            .slice(0, CI_RECENT_CONCLUSION_COUNT)
            .map((r) => conclusionKind(r.conclusion));
          const sparkSource = [...sorted].reverse();
          const durationSparkline = sparkSource
            .map((r) => r.durationSeconds)
            .filter((d): d is number => d != null && Number.isFinite(d))
            .slice(-CI_RECENT_CONCLUSION_COUNT);
          const successRate = v.total ? round((v.success / v.total) * 100, 1) : 0;
          const failureRate = v.total ? round((v.failure / v.total) * 100, 1) : 0;
          return {
            workflowId,
            name: v.name,
            total: v.total,
            success: v.success,
            failure: v.failure,
            successRate,
            failureRate,
            consecutiveFailures: countConsecutiveFailures(sorted),
            recentConclusions,
            durationSparkline,
            avgDurationSeconds:
              v.durations.length > 0
                ? round(v.durations.reduce((a, b) => a + b, 0) / v.durations.length)
                : null,
            maxDurationSeconds: v.durations.length > 0 ? Math.max(...v.durations) : null,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
      recentConclusions: [...dayMap.entries()]
        .map(([date, v]) => ({ date, ...v }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  /**
   * Map workflows into lifecycle lanes (PR → merge queue → push → release, …)
   * using workflow YAML `on:` triggers, falling back to recent run events.
   */
  async getWorkflowLifecycleMap(): Promise<WorkflowLifecycleMap> {
    return this.cached(this.cacheKey('workflow-map', 'v1'), async () => {
      const { workflows, runsByWorkflowId } = await this.listRecentRunsPerWorkflow(
        PER_WORKFLOW_RUN_SAMPLE,
      );

      const entries = await mapPool(workflows, 8, async (wf): Promise<WorkflowMapEntry> => {
        const observedEvents = [
          ...new Set((runsByWorkflowId.get(wf.id) ?? []).map((r) => r.event).filter(Boolean)),
        ].sort();

        let triggers: string[] = [];
        let pathFiltered = false;
        let source: WorkflowMapEntry['source'] = 'unknown';

        if (wf.path.startsWith('.github/workflows/') && /\.ya?ml$/i.test(wf.path)) {
          try {
            const { data } = await this.octokit.repos.getContent({
              owner: this.ref.owner,
              repo: this.ref.repo,
              path: wf.path,
            });
            if (!Array.isArray(data) && data.type === 'file' && 'content' in data && data.content) {
              const raw = Buffer.from(data.content, 'base64').toString('utf8');
              const parsed = extractWorkflowTriggers(raw);
              if (parsed.events.length > 0) {
                triggers = parsed.events;
                pathFiltered = parsed.hasPathFilters;
                source = 'yaml';
              }
            }
          } catch {
            // Fall through to observed events.
          }
        }

        if (source === 'unknown' && observedEvents.length > 0) {
          triggers = observedEvents;
          source = 'observed';
        }

        return {
          workflowId: wf.id,
          name: wf.name,
          path: wf.path,
          state: wf.state,
          triggers,
          lanes: lanesForTriggers(triggers, wf.name),
          pathFiltered,
          source,
        };
      });

      const sorted = [...entries].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      );

      const lanes = LIFECYCLE_LANE_ORDER.map((id) => {
        const meta = LIFECYCLE_LANE_META[id];
        return {
          id,
          label: meta.label,
          description: meta.description,
          primary: meta.primary,
          workflows: sorted.filter((w) => w.lanes.includes(id)),
        };
      }).filter((lane) => lane.workflows.length > 0);

      return {
        lanes,
        workflows: sorted,
        parsedFromYaml: sorted.filter((w) => w.source === 'yaml').length,
        observedOnly: sorted.filter((w) => w.source === 'observed').length,
        unknown: sorted.filter((w) => w.source === 'unknown').length,
      };
    });
  }

  /**
   * Aggregate release-train / orchestration stage health from recent creating-workflow runs.
   * Reuses release-workflow-runs + per-run caches; soft-fails when artifacts are missing.
   */
  async getOrchestrationHealth(): Promise<OrchestrationHealthSummary> {
    return this.cached(this.cacheKey('orchestration-health', this.releaseWorkflowFile), async () => {
      const runs = await this.listReleaseCreatingWorkflowRuns();
      const candidates = runs
        .filter((r) => r.status === 'completed' || r.conclusion != null)
        .slice(0, ORCHESTRATION_HEALTH_SAMPLE);

      const details = await mapPool(candidates, ORCHESTRATION_HEALTH_CONCURRENCY, async (run) => {
        try {
          return await this.getWorkflowRun(run.id, { includeOrchestration: true });
        } catch {
          return null;
        }
      });

      const stageAgg = new Map<
        string,
        { stageId: string; name: string; group: string; success: number; failure: number; samples: number }
      >();
      const suiteFailures = new Map<string, number>();
      const recentRuns: OrchestrationHealthSummary['recentRuns'] = [];
      let runsWithState = 0;

      for (const detail of details) {
        if (!detail?.orchestration) continue;
        runsWithState += 1;
        const stages = detail.orchestration.pipeline.stages;
        const failedStages: string[] = [];

        for (const stage of stages) {
          const id = stage.Stage.ID || stage.Stage.Name;
          const entry = stageAgg.get(id) ?? {
            stageId: id,
            name: stage.Stage.Name || id,
            group: stage.Stage.Group ?? '',
            success: 0,
            failure: 0,
            samples: 0,
          };
          if (stage.State === ORCH_STAGE_SUCCESS || stage.State === ORCH_STAGE_FAILURE) {
            entry.samples += 1;
            if (stage.State === ORCH_STAGE_SUCCESS) entry.success += 1;
            if (stage.State === ORCH_STAGE_FAILURE) {
              entry.failure += 1;
              failedStages.push(stage.Stage.Name || id);
            }
          }
          stageAgg.set(id, entry);

          const suites = stage.TestReport?.suites ?? [];
          for (const suite of suites) {
            if (suite.failed > 0) {
              suiteFailures.set(suite.label || suite.key, (suiteFailures.get(suite.label || suite.key) ?? 0) + suite.failed);
            }
          }
        }

        recentRuns.push({
          runId: detail.id,
          createdAt: detail.createdAt,
          htmlUrl: detail.htmlUrl,
          failedStages,
        });
      }

      const stageStats = [...stageAgg.values()]
        .filter((s) => s.samples > 0)
        .map((s) => ({
          stageId: s.stageId,
          name: s.name,
          group: s.group,
          successRate: s.samples ? round((s.success / s.samples) * 100, 1) : 0,
          failureRate: s.samples ? round((s.failure / s.samples) * 100, 1) : 0,
          samples: s.samples,
        }))
        .sort((a, b) => b.failureRate - a.failureRate || a.name.localeCompare(b.name));

      const topFailingSuites = [...suiteFailures.entries()]
        .map(([name, failures]) => ({ name, failures }))
        .sort((a, b) => b.failures - a.failures)
        .slice(0, 8);

      return {
        sampleSize: candidates.length,
        runsWithState,
        stageStats,
        topFailingSuites,
        recentRuns,
      };
    });
  }

  async getWorkflowRun(
    id: number,
    options?: { includeOrchestration?: boolean; owner?: string; repo?: string },
  ): Promise<WorkflowRunDetail> {
    const includeOrchestration = options?.includeOrchestration !== false;
    const owner = options?.owner?.trim() || this.ref.owner;
    const repo = options?.repo?.trim() || this.ref.repo;
    const orchKey = includeOrchestration ? 'orch' : 'no-orch';

    return this.cached(this.cacheKey('workflow-run', id, `${owner}/${repo}:${orchKey}`), async () => {
      const isPrimaryRepo = owner === this.ref.owner && repo === this.ref.repo;

      const { data: run } = await this.octokit.actions.getWorkflowRun({
        owner,
        repo,
        run_id: id,
      });
      const base = this.mapWorkflowRun(run);

      const jobsPromise = this.octokit.actions.listJobsForWorkflowRun({
        owner,
        repo,
        run_id: id,
        per_page: 100,
      });

      const orchestrationPromise =
        includeOrchestration && isPrimaryRepo
          ? loadOrchestrationFromArtifacts(this.octokit, owner, repo, id)
          : Promise.resolve({ orchestration: null, orchestrationArtifact: null });

      const [{ data: jobsData }, orchestrationResult] = await Promise.all([
        jobsPromise,
        orchestrationPromise,
      ]);

      return {
        ...base,
        jobs: jobsData.jobs.map((job) => {
          const htmlUrl = job.html_url ?? '';
          return {
            id: job.id,
            name: job.name,
            status: job.status,
            conclusion: job.conclusion ?? null,
            createdAt: job.created_at ?? null,
            startedAt: job.started_at ?? null,
            completedAt: job.completed_at ?? null,
            durationSeconds: secondsBetween(job.started_at, job.completed_at),
            queueSeconds: secondsBetween(job.created_at, job.started_at),
            htmlUrl,
            steps: (job.steps ?? []).map((step) => ({
              name: step.name,
              status: step.status,
              conclusion: step.conclusion ?? null,
              number: step.number,
              durationSeconds: secondsBetween(step.started_at, step.completed_at),
              htmlUrl: htmlUrl ? `${htmlUrl}#step:${step.number}:1` : '',
            })),
          };
        }),
        orchestration: orchestrationResult.orchestration,
        orchestrationArtifact: orchestrationResult.orchestrationArtifact,
      };
    });
  }
}
