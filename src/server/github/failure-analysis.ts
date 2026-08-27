import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type {
  WorkflowFailureAnalysis,
  WorkflowFailureConfidence,
  WorkflowFailureNotesSource,
  WorkflowRunDetail,
} from '../../shared/types.js';
import {
  parsePrNumbersFromReleaseNotes,
  resolveWorkflowRunTag,
} from '../../shared/utils.js';
import type { GitHubService } from './service.js';

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

const analysisOutputSchema = z.object({
  summary: z.string().describe('1-3 sentence summary of what failed'),
  likelyPrNumber: z
    .number()
    .nullable()
    .describe('PR number from release notes most likely related to the failure, or null'),
  likelyAuthor: z
    .string()
    .nullable()
    .describe('GitHub login of the likely PR author, or null'),
  confidence: z.enum(['high', 'medium', 'low']),
  reasoning: z
    .string()
    .describe('Why this PR/author is implicated, citing release notes and failure signals'),
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
  failedJobs: Array<{
    name: string;
    conclusion: string | null;
    failedSteps: string[];
  }>;
  failedStages: Array<{
    id: string;
    name: string;
    error: string;
  }>;
}

function isFailureConclusion(conclusion: string | null | undefined): boolean {
  return (
    conclusion === 'failure' ||
    conclusion === 'timed_out' ||
    conclusion === 'startup_failure' ||
    conclusion === 'action_required'
  );
}

export function extractFailedJobs(run: WorkflowRunDetail): FailureAnalysisContext['failedJobs'] {
  return run.jobs
    .filter((job) => isFailureConclusion(job.conclusion))
    .map((job) => ({
      name: job.name,
      conclusion: job.conclusion,
      failedSteps: job.steps
        .filter((step) => isFailureConclusion(step.conclusion))
        .map((step) => step.name),
    }));
}

export function extractFailedStages(
  run: WorkflowRunDetail,
): FailureAnalysisContext['failedStages'] {
  const stages = run.orchestration?.pipeline.stages ?? [];
  return stages
    .filter((stage) => stage.State === ORCH_STAGE_FAILURE)
    .map((stage) => ({
      id: stage.Stage.ID || stage.Stage.Name,
      name: stage.Stage.Name || stage.Stage.ID,
      error: stage.Error || stage.StatusText || '',
    }));
}

export async function buildFailureAnalysisContext(
  github: GitHubService,
  run: WorkflowRunDetail,
): Promise<FailureAnalysisContext> {
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
    },
    tagName,
    releaseNotesSource,
    release,
    releaseNotes,
    authorMentions,
    associatedPrs: enrichedPrs,
    failedJobs: extractFailedJobs(run),
    failedStages: extractFailedStages(run),
  };
}

function buildPrompt(ctx: FailureAnalysisContext): string {
  const notesPreview =
    ctx.releaseNotes && ctx.releaseNotes.length > 12_000
      ? `${ctx.releaseNotes.slice(0, 12_000)}\n\n…(truncated)…`
      : ctx.releaseNotes;

  return `Analyze this GitHub Actions workflow failure and identify which pull request (and author) from the release notes is the most likely cause.

## Workflow run
${JSON.stringify(ctx.run, null, 2)}

## Release tag
${ctx.tagName ?? '(unknown)'}
Release notes source: ${ctx.releaseNotesSource}
${ctx.release ? `Release: ${ctx.release.name} (${ctx.release.htmlUrl})` : 'No GitHub Release matched.'}

## Failed jobs / steps
${JSON.stringify(ctx.failedJobs, null, 2)}

## Failed orchestration stages
${JSON.stringify(ctx.failedStages, null, 2)}

## PRs parsed from release notes
${JSON.stringify(ctx.associatedPrs, null, 2)}

## Author mentions (from orchestration, if any)
${JSON.stringify(ctx.authorMentions, null, 2)}

## Release notes
${notesPreview || '(no release notes available)'}

## Instructions
1. Call get_failure_context if you need to re-read the structured context.
2. Call get_pr_detail for any candidate PR you need more detail on (title, body, files, author).
3. Prefer correlating failed job/stage/test names with PR titles, file paths, and release-note lines.
4. Pick at most one likely PR from the release-notes list. If evidence is weak, set likelyPrNumber to null and confidence to low.
5. Return structured output only.`;
}

function createAnalysisMcpServer(ctx: FailureAnalysisContext, github: GitHubService) {
  const getFailureContext = tool(
    'get_failure_context',
    'Return the structured workflow failure context including tag, release notes metadata, failed jobs/stages, and associated PRs.',
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

  return createSdkMcpServer({
    name: 'github-dash',
    version: '1.0.0',
    tools: [getFailureContext, getPrDetail],
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

export async function runClaudeFailureAnalysis(
  github: GitHubService,
  ctx: FailureAnalysisContext,
): Promise<Pick<WorkflowFailureAnalysis, 'summary' | 'likelyCause' | 'model'>> {
  if (!isClaudeAgentConfigured()) {
    const err = new Error(
      'Claude Agent is not configured. Set ANTHROPIC_API_KEY, or configure apiKeyHelper (and related env) in ~/.claude/settings.json.',
    );
    (err as Error & { status: number }).status = 503;
    throw err;
  }

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
        model: process.env.CLAUDE_MODEL?.trim() || 'sonnet',
        permissionMode: 'bypassPermissions',
        // Load ~/.claude/settings.json so apiKeyHelper / user env apply.
        settingSources: ['user'],
        // Keep analysis isolated: no filesystem skills; only our MCP tools.
        skills: [],
        tools: [],
        mcpServers: { 'github-dash': mcpServer },
        allowedTools: ['mcp__github-dash__get_failure_context', 'mcp__github-dash__get_pr_detail'],
        maxTurns: 8,
        outputFormat: {
          type: 'json_schema',
          schema: outputSchema,
        },
      },
    })) {
      if (message.type === 'system' && 'model' in message && typeof message.model === 'string') {
        model = message.model;
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

  const matchedPr =
    structured.likelyPrNumber != null
      ? ctx.associatedPrs.find((pr) => pr.number === structured!.likelyPrNumber)
      : undefined;

  const confidence = structured.confidence as WorkflowFailureConfidence;

  return {
    summary: structured.summary,
    model,
    likelyCause: {
      prNumber: structured.likelyPrNumber,
      prTitle: matchedPr?.title ?? null,
      author: structured.likelyAuthor ?? matchedPr?.author ?? null,
      confidence,
      reasoning: structured.reasoning,
    },
  };
}

export async function analyzeWorkflowFailure(
  github: GitHubService,
  runId: number,
): Promise<WorkflowFailureAnalysis> {
  const run = await github.getWorkflowRun(runId, { includeOrchestration: true });
  const ctx = await buildFailureAnalysisContext(github, run);
  const agent = await runClaudeFailureAnalysis(github, ctx);

  return {
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
    failedJobs: ctx.failedJobs,
    failedStages: ctx.failedStages,
    summary: agent.summary,
    likelyCause: agent.likelyCause,
    model: agent.model,
  };
}
