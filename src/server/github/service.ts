import { Octokit } from '@octokit/rest';
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
  RepoRef,
  WorkflowRunDetail,
  WorkflowRunSummary,
  WorkflowStats,
} from '../../shared/types.js';
import {
  computeTimingStats,
  hoursBetween,
  parsePrNumbersFromReleaseNotes,
  round,
  secondsBetween,
} from '../../shared/utils.js';

export interface GitHubServiceOptions {
  token?: string;
  owner: string;
  repo: string;
}

export class GitHubService {
  private readonly octokit: Octokit;
  readonly ref: RepoRef;

  private prCache: PrSummary[] | null = null;
  private commitCache: CommitSummary[] | null = null;
  private releaseCache: ReleaseSummary[] | null = null;
  private workflowCache: WorkflowRunSummary[] | null = null;

  constructor(options: GitHubServiceOptions) {
    this.octokit = new Octokit({
      auth: options.token || process.env.GITHUB_TOKEN || undefined,
      userAgent: 'github-dash',
    });
    this.ref = { owner: options.owner, repo: options.repo };
  }

  async getOverview(): Promise<OverviewStats> {
    const { data: repo } = await this.octokit.repos.get({
      owner: this.ref.owner,
      repo: this.ref.repo,
    });

    const [prs, commits, releases, workflows] = await Promise.all([
      this.getPrStats(),
      this.getCommitStats(),
      this.getReleaseStats(),
      this.getWorkflowStats(),
    ]);

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
    };
  }

  async listPullRequests(force = false): Promise<PrSummary[]> {
    if (this.prCache && !force) return this.prCache;

    const items: Awaited<ReturnType<typeof this.octokit.pulls.list>>['data'] = [];
    for await (const page of this.octokit.paginate.iterator(this.octokit.pulls.list, {
      owner: this.ref.owner,
      repo: this.ref.repo,
      state: 'all',
      sort: 'updated',
      direction: 'desc',
      per_page: 100,
    })) {
      items.push(...page.data);
      if (items.length >= 200) break;
    }

    const capped = items.slice(0, 200);

    this.prCache = capped.map((pr) => {
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
        timeToMergeHours: hoursBetween(pr.created_at, pr.merged_at),
        timeToCloseHours: hoursBetween(pr.created_at, pr.closed_at),
        // List endpoint omits diff stats; filled on detail fetch
        comments: 'comments' in pr && typeof pr.comments === 'number' ? pr.comments : 0,
        additions: 'additions' in pr && typeof pr.additions === 'number' ? pr.additions : 0,
        deletions: 'deletions' in pr && typeof pr.deletions === 'number' ? pr.deletions : 0,
        changedFiles:
          'changed_files' in pr && typeof pr.changed_files === 'number' ? pr.changed_files : 0,
        labels: (pr.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name ?? '')).filter(Boolean),
        base: pr.base.ref,
        head: pr.head.ref,
        htmlUrl: pr.html_url,
      };
    });

    return this.prCache;
  }

  async getPrStats(): Promise<PrStats> {
    const prs = await this.listPullRequests();
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
      mergeTiming: computeTimingStats(prs.map((p) => p.timeToMergeHours)),
      closeTiming: computeTimingStats(prs.filter((p) => !p.merged).map((p) => p.timeToCloseHours)),
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

  async getPullRequest(number: number): Promise<PrDetail> {
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
      timeToMergeHours: hoursBetween(pr.created_at, pr.merged_at),
      timeToCloseHours: hoursBetween(pr.created_at, pr.closed_at),
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
      reviewers,
      requestedReviewers: (pr.requested_reviewers ?? [])
        .map((u) => ('login' in u ? u.login : null))
        .filter((x): x is string => Boolean(x)),
      timeline,
    };
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

  async listCommits(force = false): Promise<CommitSummary[]> {
    if (this.commitCache && !force) return this.commitCache;

    const items: Awaited<ReturnType<typeof this.octokit.repos.listCommits>>['data'] = [];
    for await (const page of this.octokit.paginate.iterator(this.octokit.repos.listCommits, {
      owner: this.ref.owner,
      repo: this.ref.repo,
      per_page: 100,
    })) {
      items.push(...page.data);
      if (items.length >= 200) break;
    }

    this.commitCache = items.slice(0, 200).map((c) => ({
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

    return this.commitCache;
  }

  async getCommitStats(): Promise<CommitStats> {
    const commits = await this.listCommits();
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
  }

  async listReleases(force = false): Promise<ReleaseSummary[]> {
    if (this.releaseCache && !force) return this.releaseCache;

    const items: Awaited<ReturnType<typeof this.octokit.repos.listReleases>>['data'] = [];
    for await (const page of this.octokit.paginate.iterator(this.octokit.repos.listReleases, {
      owner: this.ref.owner,
      repo: this.ref.repo,
      per_page: 100,
    })) {
      items.push(...page.data);
      if (items.length >= 100) break;
    }

    // API returns newest first; compute cadence vs previous (older) release
    const chronological = [...items.slice(0, 100)].reverse();
    const withTiming = chronological.map((rel, idx) => {
      const associatedPrNumbers = parsePrNumbersFromReleaseNotes(rel.body);
      const previous = idx > 0 ? chronological[idx - 1] : null;
      const prevTime = previous?.published_at ?? previous?.created_at;
      const thisTime = rel.published_at ?? rel.created_at;
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
      };
    });

    this.releaseCache = withTiming.reverse();
    return this.releaseCache;
  }

  async getReleaseStats(): Promise<ReleaseStats> {
    const releases = await this.listReleases();
    const published = releases.filter((r) => !r.draft && r.publishedAt);
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
    };
  }

  async getRelease(id: number): Promise<ReleaseDetail> {
    const releases = await this.listReleases();
    const summary = releases.find((r) => r.id === id);
    if (!summary) {
      throw Object.assign(new Error(`Release ${id} not found`), { status: 404 });
    }

    const { data: rel } = await this.octokit.repos.getRelease({
      owner: this.ref.owner,
      repo: this.ref.repo,
      release_id: id,
    });

    const associatedPrNumbers = parsePrNumbersFromReleaseNotes(rel.body);
    const associatedPrs = await Promise.all(
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
    );

    return {
      ...summary,
      associatedPrNumbers,
      associatedPrCount: associatedPrNumbers.length,
      body: rel.body ?? null,
      associatedPrs,
      assets: (rel.assets ?? []).map((a) => ({
        name: a.name,
        size: a.size,
        downloadCount: a.download_count,
        contentType: a.content_type,
      })),
    };
  }

  async listWorkflowRuns(force = false): Promise<WorkflowRunSummary[]> {
    if (this.workflowCache && !force) return this.workflowCache;

    const { data } = await this.octokit.actions.listWorkflowRunsForRepo({
      owner: this.ref.owner,
      repo: this.ref.repo,
      per_page: 100,
    });

    this.workflowCache = data.workflow_runs.map((run) => {
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
        createdAt: run.created_at,
        updatedAt: run.updated_at,
        runStartedAt: run.run_started_at ?? null,
        durationSeconds: secondsBetween(started, ended),
        htmlUrl: run.html_url,
        attempt: run.run_attempt ?? 1,
      } satisfies WorkflowRunSummary;
    });

    return this.workflowCache;
  }

  async getWorkflowStats(): Promise<WorkflowStats> {
    const runs = await this.listWorkflowRuns();
    const success = runs.filter((r) => r.conclusion === 'success').length;
    const failure = runs.filter((r) => r.conclusion === 'failure').length;
    const cancelled = runs.filter((r) => r.conclusion === 'cancelled').length;
    const other = runs.length - success - failure - cancelled;

    const byWorkflowMap = new Map<
      number,
      { name: string; total: number; success: number; failure: number; durations: number[] }
    >();

    const dayMap = new Map<string, { success: number; failure: number; other: number }>();

    for (const run of runs) {
      const entry = byWorkflowMap.get(run.workflowId) ?? {
        name: run.workflowName,
        total: 0,
        success: 0,
        failure: 0,
        durations: [],
      };
      entry.name = run.workflowName;
      entry.total += 1;
      if (run.conclusion === 'success') entry.success += 1;
      if (run.conclusion === 'failure') entry.failure += 1;
      if (run.durationSeconds != null) entry.durations.push(run.durationSeconds);
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
        .map(([workflowId, v]) => ({
          workflowId,
          name: v.name,
          total: v.total,
          success: v.success,
          failure: v.failure,
          avgDurationSeconds:
            v.durations.length > 0
              ? round(v.durations.reduce((a, b) => a + b, 0) / v.durations.length)
              : null,
          maxDurationSeconds: v.durations.length > 0 ? Math.max(...v.durations) : null,
        }))
        .sort((a, b) => b.total - a.total),
      recentConclusions: [...dayMap.entries()]
        .map(([date, v]) => ({ date, ...v }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  async getWorkflowRun(id: number): Promise<WorkflowRunDetail> {
    const runs = await this.listWorkflowRuns();
    let base: WorkflowRunSummary | undefined = runs.find((r) => r.id === id);

    if (!base) {
      const { data: run } = await this.octokit.actions.getWorkflowRun({
        owner: this.ref.owner,
        repo: this.ref.repo,
        run_id: id,
      });
      const started = run.run_started_at ?? run.created_at;
      const ended = run.status === 'completed' ? run.updated_at : null;
      base = {
        id: run.id,
        name: run.name ?? 'Workflow',
        workflowId: run.workflow_id,
        workflowName: run.name ?? String(run.workflow_id),
        status: run.status ?? null,
        conclusion: run.conclusion ?? null,
        event: run.event,
        branch: run.head_branch ?? '',
        createdAt: run.created_at,
        updatedAt: run.updated_at,
        runStartedAt: run.run_started_at ?? null,
        durationSeconds: secondsBetween(started, ended),
        htmlUrl: run.html_url,
        attempt: run.run_attempt ?? 1,
      };
    }

    const { data: jobsData } = await this.octokit.actions.listJobsForWorkflowRun({
      owner: this.ref.owner,
      repo: this.ref.repo,
      run_id: id,
      per_page: 100,
    });

    return {
      ...base,
      jobs: jobsData.jobs.map((job) => ({
        id: job.id,
        name: job.name,
        status: job.status,
        conclusion: job.conclusion ?? null,
        startedAt: job.started_at ?? null,
        completedAt: job.completed_at ?? null,
        durationSeconds: secondsBetween(job.started_at, job.completed_at),
        steps: (job.steps ?? []).map((step) => ({
          name: step.name,
          status: step.status,
          conclusion: step.conclusion ?? null,
          number: step.number,
          durationSeconds: secondsBetween(step.started_at, step.completed_at),
        })),
      })),
    };
  }
}
