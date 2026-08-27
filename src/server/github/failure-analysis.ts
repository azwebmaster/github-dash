import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type {
  OrchestrationStageRun,
  OrchestrationTestReport,
  WorkflowFailureAnalysis,
  WorkflowFailureAnalysisEvent,
  WorkflowFailureConfidence,
  WorkflowFailureJob,
  WorkflowFailureNotesSource,
  WorkflowFailureStage,
  WorkflowFailureTargetAnalysis,
  WorkflowFailureTestReport,
  WorkflowRunDetail,
} from '../../shared/types.js';
import {
  parseGithubActionsRunUrl,
  parseGithubRepoRef,
  parsePrNumbersFromReleaseNotes,
  resolveWorkflowRunTag,
} from '../../shared/utils.js';
import type { GitHubService } from './service.js';
import { truncateWorkflowJobLog } from './service.js';

/**
 * Normalize analysis payloads (including older cached entries that only had `likelyCause`).
 */
export function normalizeFailureAnalysis(
  analysis: WorkflowFailureAnalysis,
): WorkflowFailureAnalysis {
  const likelyCauses =
    analysis.likelyCauses?.length > 0
      ? analysis.likelyCauses
      : analysis.likelyCause
        ? [analysis.likelyCause]
        : [
            {
              prNumber: null,
              prTitle: null,
              author: null,
              confidence: 'low' as const,
              reasoning: 'No likely cause recorded.',
            },
          ];

  const failedJobs = (analysis.failedJobs ?? []).map(normalizeFailureJob);
  const failedStages = (analysis.failedStages ?? []).map(normalizeFailureStage);
  const byFailure =
    analysis.byFailure?.length > 0
      ? analysis.byFailure.map(normalizeTargetAnalysis)
      : synthesizeByFailureFromOverall(failedJobs, failedStages, likelyCauses);

  return {
    ...analysis,
    failedJobs,
    failedStages,
    likelyCauses,
    likelyCause: likelyCauses[0]!,
    byFailure,
  };
}

function normalizeFailureJob(
  job: Partial<WorkflowFailureJob> & { name: string },
): WorkflowFailureJob {
  return {
    id: typeof job.id === 'number' && Number.isFinite(job.id) ? job.id : 0,
    name: job.name,
    conclusion: job.conclusion ?? null,
    failedSteps: Array.isArray(job.failedSteps) ? job.failedSteps : [],
    htmlUrl: typeof job.htmlUrl === 'string' ? job.htmlUrl : '',
    logExcerpt: typeof job.logExcerpt === 'string' ? job.logExcerpt : null,
    logsFetched: Boolean(job.logsFetched),
  };
}

function normalizeFailureStage(
  stage: Partial<WorkflowFailureStage> & { id: string; name: string },
): WorkflowFailureStage {
  return {
    id: stage.id,
    name: stage.name,
    error: stage.error ?? '',
    env: stage.env ?? '',
    statusText: stage.statusText ?? '',
    testSummary: Boolean(stage.testSummary),
    testReport: stage.testReport ?? null,
    group: stage.group ?? '',
    runId:
      typeof stage.runId === 'number' && Number.isFinite(stage.runId) && stage.runId > 0
        ? stage.runId
        : null,
    runUrl: stage.runUrl ?? '',
    repo: stage.repo ?? null,
    linkedFailedJobs: Array.isArray(stage.linkedFailedJobs)
      ? stage.linkedFailedJobs.map(normalizeFailureJob)
      : [],
  };
}

function normalizeTargetAnalysis(
  entry: Partial<WorkflowFailureTargetAnalysis> & {
    kind: 'job' | 'stage';
    targetId: string;
    targetName: string;
  },
): WorkflowFailureTargetAnalysis {
  const causes =
    entry.likelyCauses && entry.likelyCauses.length > 0
      ? entry.likelyCauses
      : [
          {
            prNumber: null,
            prTitle: null,
            author: null,
            confidence: 'low' as const,
            reasoning: 'No likely cause recorded for this failure.',
          },
        ];
  return {
    kind: entry.kind,
    targetId: entry.targetId,
    targetName: entry.targetName,
    summary: entry.summary?.trim() || `Analysis for ${entry.targetName}`,
    likelyCauses: causes,
  };
}

/** Backfill per-job/stage groupings for older cache entries that only had overall causes. */
function synthesizeByFailureFromOverall(
  failedJobs: WorkflowFailureJob[],
  failedStages: WorkflowFailureStage[],
  likelyCauses: WorkflowFailureAnalysis['likelyCauses'],
): WorkflowFailureTargetAnalysis[] {
  const cause = likelyCauses[0]!;
  const entries: WorkflowFailureTargetAnalysis[] = [];
  for (const job of failedJobs) {
    entries.push({
      kind: 'job',
      targetId: String(job.id || job.name),
      targetName: job.name,
      summary: `Legacy cache: overall analysis applied to job ${job.name}.`,
      likelyCauses: [cause],
    });
  }
  for (const stage of failedStages) {
    entries.push({
      kind: 'stage',
      targetId: stage.id || stage.name,
      targetName: stage.name,
      summary: `Legacy cache: overall analysis applied to stage ${stage.name}.`,
      likelyCauses: [cause],
    });
  }
  return entries;
}

export type AnalysisProgressHandler = (event: WorkflowFailureAnalysisEvent) => void;

export interface AnalyzeWorkflowFailureOptions {
  /** When true, ignore any cached analysis and re-run Claude. */
  refresh?: boolean;
  onProgress?: AnalysisProgressHandler;
}

function analysisModel(): string {
  return process.env.CLAUDE_MODEL?.trim() || 'sonnet';
}

/** Claude Code / Agent SDK user config directory (`CLAUDE_CONFIG_DIR` or `~/.claude`). */
export function claudeConfigDir(): string {
  const override = process.env.CLAUDE_CONFIG_DIR?.trim();
  return override || join(homedir(), '.claude');
}

export interface ClaudeUserSettings {
  apiKeyHelper?: unknown;
  env?: unknown;
}

/** Read `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`) when present. */
export function readClaudeUserSettings(): ClaudeUserSettings | null {
  const settingsPath = join(claudeConfigDir(), 'settings.json');
  if (!existsSync(settingsPath)) return null;
  try {
    const raw = readFileSync(settingsPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as ClaudeUserSettings;
  } catch {
    return null;
  }
}

function settingsEnvString(settings: ClaudeUserSettings | null, key: string): string | undefined {
  if (!settings?.env || typeof settings.env !== 'object' || Array.isArray(settings.env)) {
    return undefined;
  }
  const value = (settings.env as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

const ORCH_STAGE_FAILURE = 4;

const analysisCauseSchema = z.object({
  prNumber: z
    .number()
    .nullable()
    .describe('PR number from release notes related to this cause, or null'),
  author: z
    .string()
    .nullable()
    .describe('GitHub login of the PR author for this cause, or null'),
  confidence: z.enum(['high', 'medium', 'low']),
  reasoning: z
    .string()
    .describe('Why this PR/author is implicated, citing release notes, logs, and failure signals'),
});

const targetAnalysisSchema = z.object({
  kind: z.enum(['job', 'stage']).describe('Whether this entry analyzes a failed job or stage'),
  targetId: z
    .string()
    .describe('Job id as a decimal string, or orchestration stage id'),
  targetName: z.string().describe('Human-readable job or stage name'),
  summary: z.string().describe('1-2 sentence summary of what failed for this job/stage'),
  likelyCauses: z
    .array(analysisCauseSchema)
    .min(1)
    .max(5)
    .describe('Ranked likely causes for THIS job/stage only (most likely first)'),
});

const analysisOutputSchema = z.object({
  summary: z.string().describe('1-3 sentence overall summary across all failed jobs/stages'),
  likelyCauses: z
    .array(analysisCauseSchema)
    .min(1)
    .max(5)
    .describe(
      'Ranked overall likely causes for the whole run (most likely first). Each entry is a separate suspect.',
    ),
  byFailure: z
    .array(targetAnalysisSchema)
    .min(1)
    .describe(
      'Exactly one analysis object for EVERY failed job and EVERY failed stage in the context',
    ),
});

export type AnalysisOutput = z.infer<typeof analysisOutputSchema>;

export interface FailureAnalysisContext {
  run: {
    id: number;
    name: string;
    workflowName: string;
    conclusion: string | null;
    status: string | null;
    event: string;
    branch: string;
    headSha: string;
    htmlUrl: string;
    owner: string;
    repo: string;
  };
  tagName: string | null;
  releaseNotesSource: WorkflowFailureNotesSource;
  release: {
    id: number;
    tagName: string;
    name: string;
    htmlUrl: string;
    body: string | null;
  } | null;
  releaseNotes: string | null;
  authorMentions: Record<string, string>;
  associatedPrs: Array<{
    number: number;
    title: string | null;
    author: string | null;
    htmlUrl: string | null;
    mergedAt: string | null;
  }>;
  failedJobs: WorkflowFailureJob[];
  failedStages: WorkflowFailureStage[];
}

/**
 * Fingerprint of inputs that affect Claude's answer.
 * Cache hits require an exact match so orchestration/test updates invalidate stale results.
 */
export function failureAnalysisFingerprint(ctx: FailureAnalysisContext): string {
  const payload = {
    model: analysisModel(),
    run: {
      id: ctx.run.id,
      conclusion: ctx.run.conclusion,
      status: ctx.run.status,
      headSha: ctx.run.headSha,
      branch: ctx.run.branch,
    },
    tagName: ctx.tagName,
    releaseNotesSource: ctx.releaseNotesSource,
    releaseNotes: ctx.releaseNotes,
    authorMentions: ctx.authorMentions,
    associatedPrs: ctx.associatedPrs.map((pr) => ({
      number: pr.number,
      title: pr.title,
      author: pr.author,
      mergedAt: pr.mergedAt,
    })),
    failedJobs: ctx.failedJobs.map((job) => ({
      id: job.id,
      name: job.name,
      conclusion: job.conclusion,
      failedSteps: job.failedSteps,
    })),
    failedStages: ctx.failedStages.map((stage) => ({
      id: stage.id,
      name: stage.name,
      error: stage.error,
      env: stage.env,
      runId: stage.runId,
      repo: stage.repo,
      testReport: stage.testReport,
      linkedJobs: stage.linkedFailedJobs.map((job) => ({
        id: job.id,
        name: job.name,
        conclusion: job.conclusion,
        failedSteps: job.failedSteps,
      })),
    })),
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 24);
}

function isFailureConclusion(conclusion: string | null | undefined): boolean {
  return (
    conclusion === 'failure' ||
    conclusion === 'timed_out' ||
    conclusion === 'startup_failure' ||
    conclusion === 'action_required'
  );
}

export function extractFailedJobs(run: WorkflowRunDetail): WorkflowFailureJob[] {
  return run.jobs
    .filter((job) => isFailureConclusion(job.conclusion))
    .map((job) => ({
      id: job.id,
      name: job.name,
      conclusion: job.conclusion,
      failedSteps: job.steps
        .filter((step) => isFailureConclusion(step.conclusion))
        .map((step) => step.name),
      htmlUrl: job.htmlUrl,
      logExcerpt: null,
      logsFetched: false,
    }));
}

const MAX_FAILED_TESTS_PER_SUITE = 40;
/** Soft cap on how many job logs we prefetch into context. */
const MAX_PREFETCH_JOB_LOGS = 12;
/** Shorter excerpt stored on the cached analysis payload. */
const STORED_LOG_EXCERPT_CHARS = 2_500;

/** Compact a stage TestReport for the analysis prompt / MCP context. */
export function compactTestReport(
  report: OrchestrationTestReport | null | undefined,
): WorkflowFailureTestReport | null {
  if (!report) return null;
  return {
    environment: report.environment ?? '',
    overall: report.overall ?? '',
    testJobResult: report.testJobResult ?? '',
    mergeResult: report.mergeResult ?? '',
    hostPaasResult: report.hostPaasResult ?? '',
    infraFailure: Boolean(report.infraFailure),
    hostPaas: {
      present: Boolean(report.hostPaas?.present),
      status: report.hostPaas?.status ?? '',
    },
    suites: (report.suites ?? []).map((suite) => ({
      key: suite.key,
      label: suite.label,
      status: suite.status,
      total: suite.total,
      passed: suite.passed,
      failed: suite.failed,
      skipped: suite.skipped,
      failedShards: suite.failedShards ?? [],
      failedTests: (suite.failedTests ?? []).slice(0, MAX_FAILED_TESTS_PER_SUITE),
      failedTestsOverflow:
        (suite.failedTestsOverflow ?? 0) +
        Math.max(0, (suite.failedTests?.length ?? 0) - MAX_FAILED_TESTS_PER_SUITE),
    })),
  };
}

function testReportLooksFailed(report: OrchestrationTestReport | null | undefined): boolean {
  if (!report) return false;
  if (report.infraFailure) return true;
  const overall = (report.overall ?? '').toLowerCase();
  if (overall && overall !== 'passed' && overall !== 'success' && overall !== 'ok') {
    return true;
  }
  return (report.suites ?? []).some(
    (suite) =>
      suite.failed > 0 ||
      (suite.failedTests?.length ?? 0) > 0 ||
      suite.status === 'failed' ||
      suite.status === 'failure',
  );
}

function toFailureStage(stage: OrchestrationStageRun): WorkflowFailureStage {
  const fromUrl = parseGithubActionsRunUrl(stage.RunURL);
  const fromRepo = parseGithubRepoRef(stage.Stage.Repo);
  const repo =
    fromUrl != null
      ? `${fromUrl.owner}/${fromUrl.repo}`
      : fromRepo != null
        ? `${fromRepo.owner}/${fromRepo.repo}`
        : null;
  const runId =
    typeof stage.RunID === 'number' && stage.RunID > 0
      ? stage.RunID
      : fromUrl?.runId ?? null;

  return {
    id: stage.Stage.ID || stage.Stage.Name,
    name: stage.Stage.Name || stage.Stage.ID,
    error: stage.Error || stage.StatusText || '',
    env: stage.Env || '',
    statusText: stage.StatusText || '',
    testSummary: Boolean(stage.Stage.TestSummary),
    testReport: compactTestReport(stage.TestReport),
    group: stage.Stage.Group ?? '',
    runId,
    runUrl: stage.RunURL || '',
    repo,
    linkedFailedJobs: [],
  };
}

/**
 * Stages that failed (State=4) plus any stage whose TestReport indicates test/infra failure.
 * Test report details are always attached when present so the agent can correlate failing tests.
 */
export function extractFailedStages(run: WorkflowRunDetail): WorkflowFailureStage[] {
  const stages = run.orchestration?.pipeline.stages ?? [];
  const selected: WorkflowFailureStage[] = [];
  const seen = new Set<string>();

  for (const stage of stages) {
    const failed = stage.State === ORCH_STAGE_FAILURE || testReportLooksFailed(stage.TestReport);
    if (!failed) continue;
    const mapped = toFailureStage(stage);
    const key = mapped.id || mapped.name;
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(mapped);
  }

  return selected;
}

async function attachJobLogs(
  github: GitHubService,
  jobs: WorkflowFailureJob[],
  owner: string,
  repo: string,
  budget: { remaining: number },
): Promise<WorkflowFailureJob[]> {
  const out: WorkflowFailureJob[] = [];
  for (const job of jobs) {
    if (budget.remaining <= 0 || job.id <= 0) {
      out.push(job);
      continue;
    }
    budget.remaining -= 1;
    const logExcerpt = await github.downloadJobLogText(job.id, { owner, repo });
    out.push({
      ...job,
      logExcerpt,
      logsFetched: true,
    });
  }
  return out;
}

function resolveStageRepo(
  stage: WorkflowFailureStage,
  fallbackOwner: string,
  fallbackRepo: string,
): { owner: string; repo: string } {
  const parsed = parseGithubRepoRef(stage.repo) ?? parseGithubActionsRunUrl(stage.runUrl);
  if (parsed) return { owner: parsed.owner, repo: parsed.repo };
  return { owner: fallbackOwner, repo: fallbackRepo };
}

/**
 * For failed stages with a linked Actions run, load that run's failed jobs and their logs.
 */
async function enrichStagesWithLinkedJobs(
  github: GitHubService,
  stages: WorkflowFailureStage[],
  fallbackOwner: string,
  fallbackRepo: string,
  budget: { remaining: number },
  onProgress?: AnalysisProgressHandler,
): Promise<WorkflowFailureStage[]> {
  const enriched: WorkflowFailureStage[] = [];
  for (const stage of stages) {
    if (!stage.runId) {
      enriched.push(stage);
      continue;
    }
    const { owner, repo } = resolveStageRepo(stage, fallbackOwner, fallbackRepo);
    onProgress?.({
      type: 'status',
      message: `Loading jobs for stage ${stage.name} (run ${stage.runId})…`,
    });
    try {
      const linkedRun = await github.getWorkflowRun(stage.runId, {
        includeOrchestration: false,
        owner,
        repo,
      });
      const linkedFailed = extractFailedJobs(linkedRun);
      onProgress?.({
        type: 'log',
        role: 'system',
        text: `Stage ${stage.name}: found ${linkedFailed.length} failed job${linkedFailed.length === 1 ? '' : 's'} on ${owner}/${repo} run ${stage.runId}`,
      });
      const withLogs = await attachJobLogs(github, linkedFailed, owner, repo, budget);
      enriched.push({ ...stage, linkedFailedJobs: withLogs, repo: `${owner}/${repo}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onProgress?.({
        type: 'log',
        role: 'system',
        text: `Stage ${stage.name}: could not load linked run ${stage.runId}: ${message}`,
      });
      enriched.push(stage);
    }
  }
  return enriched;
}

export async function buildFailureAnalysisContext(
  github: GitHubService,
  run: WorkflowRunDetail,
  options?: { onProgress?: AnalysisProgressHandler; includeJobLogs?: boolean },
): Promise<FailureAnalysisContext> {
  const onProgress = options?.onProgress;
  const includeJobLogs = options?.includeJobLogs !== false;
  const tagName = resolveWorkflowRunTag({
    branch: run.branch,
    orchestrationBranch: run.orchestration?.branch,
    releaseNotesUrl: run.orchestration?.release_notes_url,
  });

  const orchNotes = run.orchestration?.release_notes?.trim() || null;
  let releaseNotesSource: WorkflowFailureNotesSource = orchNotes ? 'orchestration' : 'none';
  let release: FailureAnalysisContext['release'] = null;
  let releaseNotes = orchNotes;

  if (tagName) {
    const byTag = await github.findReleaseByTag(tagName);
    if (byTag) {
      release = {
        id: byTag.id,
        tagName: byTag.tagName,
        name: byTag.name,
        htmlUrl: byTag.htmlUrl,
        body: byTag.body,
      };
      if (!releaseNotes && byTag.body?.trim()) {
        releaseNotes = byTag.body;
        releaseNotesSource = 'github_release';
      } else if (orchNotes) {
        releaseNotesSource = 'orchestration';
      } else if (byTag.body?.trim()) {
        releaseNotes = byTag.body;
        releaseNotesSource = 'github_release';
      }
    }
  }

  const prNumbers = parsePrNumbersFromReleaseNotes(releaseNotes);
  const associatedPrs = prNumbers.length
    ? await github.getPullRequestSummaries(prNumbers)
    : [];

  // Prefer author_mentions from orchestration when PR author is missing.
  const authorMentions = run.orchestration?.author_mentions ?? {};
  const enrichedPrs = associatedPrs.map((pr) => {
    const mention = authorMentions[String(pr.number)] ?? authorMentions[`#${pr.number}`];
    return {
      ...pr,
      author: pr.author ?? (mention ? mention.replace(/^@/, '') : null),
    };
  });

  const owner = github.ref.owner;
  const repo = github.ref.repo;

  let failedJobs = extractFailedJobs(run);
  let failedStages = extractFailedStages(run);

  if (includeJobLogs) {
    const budget = { remaining: MAX_PREFETCH_JOB_LOGS };
    onProgress?.({
      type: 'status',
      message: `Fetching GitHub job logs for ${failedJobs.length} failed job${failedJobs.length === 1 ? '' : 's'}…`,
    });
    failedJobs = await attachJobLogs(github, failedJobs, owner, repo, budget);
    const logsOk = failedJobs.filter((j) => j.logExcerpt).length;
    onProgress?.({
      type: 'log',
      role: 'system',
      text: `Parent run logs: ${logsOk}/${failedJobs.length} failed job${failedJobs.length === 1 ? '' : 's'} fetched`,
    });
    failedStages = await enrichStagesWithLinkedJobs(
      github,
      failedStages,
      owner,
      repo,
      budget,
      onProgress,
    );
  } else {
    // Still resolve stage run metadata / linked job names without downloading logs.
    failedStages = await enrichStagesWithLinkedJobs(
      github,
      failedStages,
      owner,
      repo,
      { remaining: 0 },
      onProgress,
    );
  }

  return {
    run: {
      id: run.id,
      name: run.name,
      workflowName: run.workflowName,
      conclusion: run.conclusion,
      status: run.status,
      event: run.event,
      branch: run.branch,
      headSha: run.headSha,
      htmlUrl: run.htmlUrl,
      owner,
      repo,
    },
    tagName,
    releaseNotesSource,
    release,
    releaseNotes,
    authorMentions,
    associatedPrs: enrichedPrs,
    failedJobs,
    failedStages,
  };
}

/** Attach GitHub job logs after a cache miss (or forced refresh). */
export async function attachFailureAnalysisJobLogs(
  github: GitHubService,
  ctx: FailureAnalysisContext,
  onProgress?: AnalysisProgressHandler,
): Promise<FailureAnalysisContext> {
  const budget = { remaining: MAX_PREFETCH_JOB_LOGS };
  onProgress?.({
    type: 'status',
    message: `Fetching GitHub job logs for ${ctx.failedJobs.length} failed job${ctx.failedJobs.length === 1 ? '' : 's'}…`,
  });
  const failedJobs = await attachJobLogs(
    github,
    ctx.failedJobs.map((job) => ({ ...job, logExcerpt: null, logsFetched: false })),
    ctx.run.owner,
    ctx.run.repo,
    budget,
  );
  onProgress?.({
    type: 'log',
    role: 'system',
    text: `Parent run logs: ${failedJobs.filter((j) => j.logExcerpt).length}/${failedJobs.length} fetched`,
  });

  const failedStages: WorkflowFailureStage[] = [];
  for (const stage of ctx.failedStages) {
    if (stage.linkedFailedJobs.length === 0) {
      failedStages.push(stage);
      continue;
    }
    const { owner, repo } = resolveStageRepo(stage, ctx.run.owner, ctx.run.repo);
    onProgress?.({
      type: 'status',
      message: `Fetching GitHub job logs for stage ${stage.name} (${stage.linkedFailedJobs.length} job${stage.linkedFailedJobs.length === 1 ? '' : 's'})…`,
    });
    const linkedFailedJobs = await attachJobLogs(
      github,
      stage.linkedFailedJobs.map((job) => ({ ...job, logExcerpt: null, logsFetched: false })),
      owner,
      repo,
      budget,
    );
    failedStages.push({ ...stage, linkedFailedJobs, repo: `${owner}/${repo}` });
  }

  return { ...ctx, failedJobs, failedStages };
}

function buildPrompt(ctx: FailureAnalysisContext): string {
  const notesPreview =
    ctx.releaseNotes && ctx.releaseNotes.length > 12_000
      ? `${ctx.releaseNotes.slice(0, 12_000)}\n\n…(truncated)…`
      : ctx.releaseNotes;

  const expectedTargets = [
    ...ctx.failedJobs.map(
      (job) => `job id=${job.id} name=${JSON.stringify(job.name)} logsFetched=${job.logsFetched}`,
    ),
    ...ctx.failedStages.map(
      (stage) =>
        `stage id=${JSON.stringify(stage.id)} name=${JSON.stringify(stage.name)} linkedJobs=${stage.linkedFailedJobs.length}`,
    ),
  ];

  return `Analyze this GitHub Actions workflow failure. Produce a separate analysis for EVERY failed job and EVERY failed orchestration stage, then an overall summary.

## Workflow run
${JSON.stringify(ctx.run, null, 2)}

## Release tag
${ctx.tagName ?? '(unknown)'}
Release notes source: ${ctx.releaseNotesSource}
${ctx.release ? `Release: ${ctx.release.name} (${ctx.release.htmlUrl})` : 'No GitHub Release matched.'}

## Failed jobs / steps (logExcerpt may already include GitHub job logs)
${JSON.stringify(ctx.failedJobs, null, 2)}

## Failed orchestration stages (include TestReport / failed tests / linkedFailedJobs when present)
${JSON.stringify(ctx.failedStages, null, 2)}

## Required byFailure targets (emit exactly one entry for each)
${expectedTargets.length ? expectedTargets.map((t) => `- ${t}`).join('\n') : '- (none listed — still return one overall low-confidence cause)'}

## PRs parsed from release notes
${JSON.stringify(ctx.associatedPrs, null, 2)}

## Author mentions (from orchestration, if any)
${JSON.stringify(ctx.authorMentions, null, 2)}

## Release notes
${notesPreview || '(no release notes available)'}

## Instructions
1. Call get_failure_context if you need to re-read the structured context.
2. For EVERY failed job on the parent run: call get_job_logs with that job id (even if logExcerpt is present) unless the excerpt already clearly shows the error. Cite log evidence in reasoning.
3. For EVERY failed stage: if linkedFailedJobs exist, call get_job_logs for those job ids (pass owner/repo from the stage when set). Also use TestReport / failedTests / stage.error.
4. Call get_pr_detail for any candidate PR you need more detail on (title, body, files, author).
5. Prefer correlating failed job/stage names, log errors, TestReport suite names, and failedTests with PR titles, file paths, and release-note lines.
6. Treat infraFailure / hostPaas / mergeResult signals as distinct from application test failures when assigning blame.
7. Return byFailure with exactly one object per failed job and per failed stage listed above. Use kind "job" with targetId = job id string, or kind "stage" with targetId = stage id.
8. Return likelyCauses as a ranked overall list for the whole run (most likely first). Each cause must be a separate entry.
9. Include every plausible PR from the release-notes list that has supporting evidence (up to 5 overall). Do not merge multiple PRs into one cause.
10. If evidence is weak or no PR fits for a target, still return that target with prNumber null, confidence low, and explain why.
11. Return structured output only.`;
}

function createAnalysisMcpServer(ctx: FailureAnalysisContext, github: GitHubService) {
  const getFailureContext = tool(
    'get_failure_context',
    'Return the structured workflow failure context including tag, release notes metadata, failed jobs/stages (with TestReport, linked jobs, and log excerpts when present), and associated PRs.',
    {},
    async () => ({
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              run: ctx.run,
              tagName: ctx.tagName,
              releaseNotesSource: ctx.releaseNotesSource,
              release: ctx.release
                ? {
                    id: ctx.release.id,
                    tagName: ctx.release.tagName,
                    name: ctx.release.name,
                    htmlUrl: ctx.release.htmlUrl,
                  }
                : null,
              failedJobs: ctx.failedJobs,
              failedStages: ctx.failedStages,
              associatedPrs: ctx.associatedPrs,
              authorMentions: ctx.authorMentions,
              releaseNotes: ctx.releaseNotes,
            },
            null,
            2,
          ),
        },
      ],
    }),
    { annotations: { readOnlyHint: true, openWorldHint: false } },
  );

  const getPrDetail = tool(
    'get_pr_detail',
    'Fetch pull request title, body, author, files changed, and merge metadata for a PR number in this repository.',
    {
      number: z.number().int().positive().describe('Pull request number'),
    },
    async (args) => {
      try {
        const [pr, files] = await Promise.all([
          github.getPullRequest(args.number),
          github.listPullRequestFiles(args.number, 40),
        ]);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  number: pr.number,
                  title: pr.title,
                  author: pr.author,
                  state: pr.state,
                  mergedAt: pr.mergedAt,
                  htmlUrl: pr.htmlUrl,
                  body: pr.body,
                  labels: pr.labels ?? [],
                  files,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `Failed to load PR #${args.number}: ${message}` }],
          isError: true,
        };
      }
    },
    { annotations: { readOnlyHint: true, openWorldHint: true } },
  );

  const getJobLogs = tool(
    'get_job_logs',
    'Download GitHub Actions job logs for a workflow job id. Use for failed parent-run jobs and for jobs linked from failed orchestration stages. Optional owner/repo default to the dashboard repo.',
    {
      jobId: z.number().int().positive().describe('GitHub Actions job id'),
      owner: z
        .string()
        .optional()
        .describe('Repository owner (defaults to the configured dashboard repo owner)'),
      repo: z
        .string()
        .optional()
        .describe('Repository name (defaults to the configured dashboard repo name)'),
    },
    async (args) => {
      try {
        const owner = args.owner?.trim() || ctx.run.owner;
        const repo = args.repo?.trim() || ctx.run.repo;
        const text = await github.downloadJobLogText(args.jobId, { owner, repo });
        if (!text) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `No logs available for job ${args.jobId} in ${owner}/${repo} (expired, missing, or inaccessible).`,
              },
            ],
          };
        }
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  jobId: args.jobId,
                  owner,
                  repo,
                  logExcerpt: truncateWorkflowJobLog(text),
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to download logs for job ${args.jobId}: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
    { annotations: { readOnlyHint: true, openWorldHint: true } },
  );

  return createSdkMcpServer({
    name: 'github-dash',
    version: '1.0.0',
    tools: [getFailureContext, getPrDetail, getJobLogs],
  });
}

/**
 * True when the Claude Agent SDK can authenticate via env vars or user settings
 * (`apiKeyHelper` / `env` in `~/.claude/settings.json`).
 */
export function isClaudeAgentConfigured(): boolean {
  if (process.env.ANTHROPIC_API_KEY?.trim() || process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()) {
    return true;
  }
  const settings = readClaudeUserSettings();
  if (!settings) return false;
  if (typeof settings.apiKeyHelper === 'string' && settings.apiKeyHelper.trim()) {
    return true;
  }
  return Boolean(
    settingsEnvString(settings, 'ANTHROPIC_API_KEY')?.trim() ||
      settingsEnvString(settings, 'CLAUDE_CODE_OAUTH_TOKEN')?.trim(),
  );
}

function contentBlocks(value: unknown): unknown[] {
  if (!value || typeof value !== 'object') return [];
  const content = (value as { content?: unknown }).content;
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return Array.isArray(content) ? content : [];
}

function textFromBlocks(blocks: unknown[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    const b = block as { type?: string; text?: string; name?: string; input?: unknown };
    if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
      parts.push(b.text.trim());
    } else if (b.type === 'tool_use' && typeof b.name === 'string') {
      const inputPreview =
        b.input && typeof b.input === 'object'
          ? JSON.stringify(b.input)
          : '';
      parts.push(
        inputPreview && inputPreview.length < 200
          ? `Calling ${b.name}(${inputPreview})`
          : `Calling ${b.name}`,
      );
    } else if (b.type === 'thinking' && typeof b.text === 'string' && b.text.trim()) {
      // Skip raw thinking blobs in the chat log — too noisy.
    }
  }
  return parts.join('\n');
}

function toolResultPreview(blocks: unknown[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    const b = block as { type?: string; content?: unknown; is_error?: boolean; name?: string };
    if (b.type !== 'tool_result') continue;
    const prefix = b.is_error ? 'Tool error' : 'Tool result';
    let body = '';
    if (typeof b.content === 'string') body = b.content;
    else if (Array.isArray(b.content)) {
      body = b.content
        .map((c) =>
          c && typeof c === 'object' && 'text' in c && typeof (c as { text: unknown }).text === 'string'
            ? (c as { text: string }).text
            : '',
        )
        .filter(Boolean)
        .join('\n');
    }
    const trimmed = body.trim().replace(/\s+/g, ' ');
    parts.push(
      trimmed
        ? `${prefix}: ${trimmed.length > 280 ? `${trimmed.slice(0, 280)}…` : trimmed}`
        : prefix,
    );
  }
  return parts.join('\n');
}

/** Map a Claude Agent SDK message into optional chat/status lines for the UI. */
export function describeSdkMessage(message: {
  type: string;
  [key: string]: unknown;
}): Array<Extract<WorkflowFailureAnalysisEvent, { type: 'status' | 'log' }>> {
  const events: Array<Extract<WorkflowFailureAnalysisEvent, { type: 'status' | 'log' }>> = [];

  if (message.type === 'system') {
    const subtype = typeof message.subtype === 'string' ? message.subtype : '';
    if (subtype === 'init') {
      const model = typeof message.model === 'string' ? message.model : 'Claude';
      events.push({ type: 'status', message: `Starting analysis with ${model}` });
      events.push({
        type: 'log',
        role: 'system',
        text: `Agent ready · model ${model}`,
      });
    } else if (subtype === 'status') {
      const status = message.status;
      if (status === 'compacting') {
        events.push({ type: 'status', message: 'Compacting context…' });
      } else if (status === 'requesting') {
        events.push({ type: 'status', message: 'Waiting on model…' });
      }
    }
    return events;
  }

  if (message.type === 'assistant') {
    const text = textFromBlocks(contentBlocks(message.message));
    if (text) events.push({ type: 'log', role: 'assistant', text });
    return events;
  }

  if (message.type === 'user') {
    const text = toolResultPreview(contentBlocks(message.message));
    if (text) events.push({ type: 'log', role: 'tool', text });
    return events;
  }

  if (message.type === 'tool_progress') {
    const name = typeof message.tool_name === 'string' ? message.tool_name : 'tool';
    const elapsed =
      typeof message.elapsed_time_seconds === 'number'
        ? ` (${Math.round(message.elapsed_time_seconds)}s)`
        : '';
    events.push({
      type: 'status',
      message: `Running ${name.replace(/^mcp__github-dash__/, '')}${elapsed}…`,
    });
    return events;
  }

  if (message.type === 'result') {
    const subtype = typeof message.subtype === 'string' ? message.subtype : '';
    if (subtype === 'success') {
      events.push({ type: 'status', message: 'Analysis complete' });
    } else {
      events.push({ type: 'status', message: `Agent finished (${subtype || 'error'})` });
    }
  }

  return events;
}

function summarizeContextForProgress(ctx: FailureAnalysisContext): string {
  const stageBits = ctx.failedStages.map((stage) => {
    const failedSuites =
      stage.testReport?.suites.filter((s) => s.failed > 0 || s.failedTests.length > 0) ?? [];
    const testCount = failedSuites.reduce((n, s) => n + s.failedTests.length, 0);
    const linkedLogs = stage.linkedFailedJobs.filter((j) => j.logExcerpt).length;
    const extras: string[] = [];
    if (testCount > 0) extras.push(`${testCount} failed test${testCount === 1 ? '' : 's'}`);
    if (stage.testReport?.infraFailure) extras.push('infra failure');
    if (linkedLogs > 0) extras.push(`${linkedLogs} linked job log${linkedLogs === 1 ? '' : 's'}`);
    if (extras.length) return `${stage.name} (${extras.join(', ')})`;
    if (stage.testReport) return `${stage.name} (tests: ${stage.testReport.overall || 'reported'})`;
    return stage.name;
  });
  const parentLogs = ctx.failedJobs.filter((j) => j.logExcerpt).length;
  const parts = [
    `${ctx.failedJobs.length} failed job${ctx.failedJobs.length === 1 ? '' : 's'}`,
    `${parentLogs} job log${parentLogs === 1 ? '' : 's'} fetched`,
    `${ctx.failedStages.length} failed stage${ctx.failedStages.length === 1 ? '' : 's'}`,
    `${ctx.associatedPrs.length} PR${ctx.associatedPrs.length === 1 ? '' : 's'} from notes`,
  ];
  if (stageBits.length) parts.push(`stages: ${stageBits.join(', ')}`);
  return parts.join(' · ');
}

function mapCauses(
  causes: AnalysisOutput['likelyCauses'],
  ctx: FailureAnalysisContext,
): WorkflowFailureAnalysis['likelyCauses'] {
  return causes.map((cause) => {
    const matchedPr =
      cause.prNumber != null
        ? ctx.associatedPrs.find((pr) => pr.number === cause.prNumber)
        : undefined;
    return {
      prNumber: cause.prNumber,
      prTitle: matchedPr?.title ?? null,
      author: cause.author ?? matchedPr?.author ?? null,
      confidence: cause.confidence as WorkflowFailureConfidence,
      reasoning: cause.reasoning,
    };
  });
}

function ensureByFailureCoverage(
  byFailure: WorkflowFailureTargetAnalysis[],
  ctx: FailureAnalysisContext,
  overallCauses: WorkflowFailureAnalysis['likelyCauses'],
): WorkflowFailureTargetAnalysis[] {
  const fallbackCause = overallCauses[0] ?? {
    prNumber: null,
    prTitle: null,
    author: null,
    confidence: 'low' as const,
    reasoning: 'Insufficient evidence to identify a PR.',
  };
  const byKey = new Map<string, WorkflowFailureTargetAnalysis>();
  for (const entry of byFailure) {
    byKey.set(`${entry.kind}:${entry.targetId}`, entry);
  }

  const ensured: WorkflowFailureTargetAnalysis[] = [];
  for (const job of ctx.failedJobs) {
    const key = `job:${job.id}`;
    const existing = byKey.get(key) ?? byKey.get(`job:${job.name}`);
    if (existing) {
      ensured.push({ ...existing, kind: 'job', targetId: String(job.id), targetName: job.name });
      continue;
    }
    ensured.push({
      kind: 'job',
      targetId: String(job.id),
      targetName: job.name,
      summary: `No dedicated agent analysis returned for job ${job.name}; using overall cause.`,
      likelyCauses: [fallbackCause],
    });
  }
  for (const stage of ctx.failedStages) {
    const key = `stage:${stage.id}`;
    const existing = byKey.get(key) ?? byKey.get(`stage:${stage.name}`);
    if (existing) {
      ensured.push({
        ...existing,
        kind: 'stage',
        targetId: stage.id,
        targetName: stage.name,
      });
      continue;
    }
    ensured.push({
      kind: 'stage',
      targetId: stage.id,
      targetName: stage.name,
      summary: `No dedicated agent analysis returned for stage ${stage.name}; using overall cause.`,
      likelyCauses: [fallbackCause],
    });
  }

  if (ensured.length === 0) {
    ensured.push({
      kind: 'job',
      targetId: 'unknown',
      targetName: ctx.run.name || 'workflow',
      summary: 'No failed jobs or stages were listed; overall analysis only.',
      likelyCauses: [fallbackCause],
    });
  }
  return ensured;
}

function shrinkJobForStorage(job: WorkflowFailureJob): WorkflowFailureJob {
  return {
    ...job,
    logExcerpt: job.logExcerpt
      ? truncateWorkflowJobLog(job.logExcerpt, STORED_LOG_EXCERPT_CHARS)
      : null,
  };
}

export async function runClaudeFailureAnalysis(
  github: GitHubService,
  ctx: FailureAnalysisContext,
  onProgress?: AnalysisProgressHandler,
): Promise<
  Pick<
    WorkflowFailureAnalysis,
    'summary' | 'likelyCause' | 'likelyCauses' | 'byFailure' | 'model'
  >
> {
  if (!isClaudeAgentConfigured()) {
    const err = new Error(
      'Claude Agent is not configured. Set ANTHROPIC_API_KEY, or configure apiKeyHelper (and related env) in ~/.claude/settings.json.',
    );
    (err as Error & { status: number }).status = 503;
    throw err;
  }

  const emit = (event: WorkflowFailureAnalysisEvent) => {
    try {
      onProgress?.(event);
    } catch {
      // Progress listeners must not break analysis.
    }
  };

  emit({ type: 'status', message: 'Preparing Claude Agent…' });
  emit({
    type: 'log',
    role: 'system',
    text: `Context ready · ${summarizeContextForProgress(ctx)}`,
  });

  const mcpServer = createAnalysisMcpServer(ctx, github);
  const schema = z.toJSONSchema(analysisOutputSchema, { target: 'draft-7' });
  // Strip $schema — Agent SDK structured outputs expect a plain JSON Schema object.
  const { $schema: _schema, ...outputSchema } = schema as Record<string, unknown>;

  let structured: AnalysisOutput | null = null;
  let model: string | null = null;
  let lastError: string | null = null;

  try {
    for await (const message of query({
      prompt: buildPrompt(ctx),
      options: {
        model: analysisModel(),
        permissionMode: 'bypassPermissions',
        // Load ~/.claude/settings.json so apiKeyHelper / user env apply.
        settingSources: ['user'],
        // Keep analysis isolated: no filesystem skills; only our MCP tools.
        skills: [],
        tools: [],
        mcpServers: { 'github-dash': mcpServer },
        allowedTools: [
          'mcp__github-dash__get_failure_context',
          'mcp__github-dash__get_pr_detail',
          'mcp__github-dash__get_job_logs',
        ],
        maxTurns: 20,
        outputFormat: {
          type: 'json_schema',
          schema: outputSchema,
        },
      },
    })) {
      if (message.type === 'system' && 'model' in message && typeof message.model === 'string') {
        model = message.model;
      }

      for (const event of describeSdkMessage(message as { type: string; [key: string]: unknown })) {
        emit(event);
      }

      if (message.type === 'result') {
        if ('structured_output' in message && message.structured_output) {
          const parsed = analysisOutputSchema.safeParse(message.structured_output);
          if (parsed.success) structured = parsed.data;
        }
        if (message.subtype !== 'success') {
          lastError =
            'errors' in message && Array.isArray(message.errors)
              ? message.errors.join('; ')
              : `Agent finished with subtype ${message.subtype}`;
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const wrapped = new Error(`Claude Agent analysis failed: ${message}`);
    (wrapped as Error & { status: number }).status = 502;
    throw wrapped;
  }

  if (!structured) {
    const wrapped = new Error(
      lastError
        ? `Claude Agent analysis failed: ${lastError}`
        : 'Claude Agent analysis returned no structured result',
    );
    (wrapped as Error & { status: number }).status = 502;
    throw wrapped;
  }

  const likelyCauses = mapCauses(structured.likelyCauses, ctx);
  const byFailure = ensureByFailureCoverage(
    structured.byFailure.map((entry) => ({
      kind: entry.kind,
      targetId: entry.targetId,
      targetName: entry.targetName,
      summary: entry.summary,
      likelyCauses: mapCauses(entry.likelyCauses, ctx),
    })),
    ctx,
    likelyCauses,
  );

  return {
    summary: structured.summary,
    model,
    likelyCause: likelyCauses[0]!,
    likelyCauses,
    byFailure,
  };
}

export async function analyzeWorkflowFailure(
  github: GitHubService,
  runId: number,
  options: AnalyzeWorkflowFailureOptions = {},
): Promise<WorkflowFailureAnalysis> {
  const { refresh = false, onProgress } = options;
  const emit = (event: WorkflowFailureAnalysisEvent) => {
    try {
      onProgress?.(event);
    } catch {
      // ignore listener errors
    }
  };

  emit({ type: 'status', message: 'Loading workflow run and orchestration state…' });
  const run = await github.getWorkflowRun(runId, { includeOrchestration: true });

  emit({
    type: 'status',
    message: 'Building failure context (jobs, stages, test reports, release notes)…',
  });
  let ctx = await buildFailureAnalysisContext(github, run, {
    onProgress: emit,
    includeJobLogs: false,
  });
  const fingerprint = failureAnalysisFingerprint(ctx);

  if (!refresh) {
    const stored = await github.getCachedFailureAnalysis(runId);
    if (stored && stored.fingerprint === fingerprint) {
      emit({ type: 'status', message: 'Loaded cached analysis' });
      emit({
        type: 'log',
        role: 'system',
        text: `Using cached analysis from ${stored.analyzedAt} (skipped Claude).`,
      });
      const analysis = normalizeFailureAnalysis({
        ...stored.analysis,
        analyzedAt: stored.analyzedAt,
      });
      emit({ type: 'result', analysis });
      return analysis;
    }
  } else {
    await github.clearCachedFailureAnalysis(runId);
  }

  ctx = await attachFailureAnalysisJobLogs(github, ctx, emit);

  const testStageCount = ctx.failedStages.filter((s) => s.testReport).length;
  const linkedJobLogs = ctx.failedStages.reduce(
    (n, s) => n + s.linkedFailedJobs.filter((j) => j.logExcerpt).length,
    0,
  );
  emit({
    type: 'log',
    role: 'system',
    text:
      testStageCount > 0
        ? `Included TestReport data for ${testStageCount} stage${testStageCount === 1 ? '' : 's'}.`
        : 'No TestReport data found on failed stages.',
  });
  emit({
    type: 'log',
    role: 'system',
    text: `GitHub job logs ready · parent=${ctx.failedJobs.filter((j) => j.logExcerpt).length}/${ctx.failedJobs.length} · linked stage jobs=${linkedJobLogs}`,
  });

  const agent = await runClaudeFailureAnalysis(github, ctx, onProgress);
  const analyzedAt = new Date().toISOString();

  const analysis: WorkflowFailureAnalysis = {
    runId: run.id,
    tagName: ctx.tagName,
    release: ctx.release
      ? {
          id: ctx.release.id,
          tagName: ctx.release.tagName,
          name: ctx.release.name,
          htmlUrl: ctx.release.htmlUrl,
        }
      : null,
    releaseNotesSource: ctx.releaseNotesSource,
    associatedPrs: ctx.associatedPrs,
    failedJobs: ctx.failedJobs.map(shrinkJobForStorage),
    failedStages: ctx.failedStages.map((stage) => ({
      ...stage,
      linkedFailedJobs: stage.linkedFailedJobs.map(shrinkJobForStorage),
    })),
    summary: agent.summary,
    likelyCause: agent.likelyCause,
    likelyCauses: agent.likelyCauses,
    byFailure: agent.byFailure,
    model: agent.model,
    analyzedAt,
  };

  await github.setCachedFailureAnalysis(runId, {
    fingerprint,
    analyzedAt,
    analysis,
  });

  emit({ type: 'result', analysis });
  return analysis;
}
