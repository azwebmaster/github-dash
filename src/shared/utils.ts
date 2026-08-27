/** Extract PR numbers referenced in GitHub release notes / changelogs. */
const PR_PATTERNS = [
  /https?:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)/gi,
  /(?:^|[^/\w])#(\d+)\b/g,
  /\b(?:PR|pr|pull request|Pull Request)\s*#?(\d+)\b/g,
  /\([^)]*#(\d+)[^)]*\)/g,
];

export function parsePrNumbersFromReleaseNotes(body: string | null | undefined): number[] {
  if (!body) return [];

  const found = new Set<number>();

  for (const pattern of PR_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(body)) !== null) {
      const num = Number(match[1]);
      if (Number.isFinite(num) && num > 0) {
        found.add(num);
      }
    }
  }

  return [...found].sort((a, b) => a - b);
}

export function hoursBetween(start: string | null | undefined, end: string | null | undefined): number | null {
  if (!start || !end) return null;
  const a = Date.parse(start);
  const b = Date.parse(end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return (b - a) / (1000 * 60 * 60);
}

export function secondsBetween(start: string | null | undefined, end: string | null | undefined): number | null {
  if (!start || !end) return null;
  const a = Date.parse(start);
  const b = Date.parse(end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return (b - a) / 1000;
}

export function computeTimingStats(valuesHours: Array<number | null | undefined>): {
  count: number;
  avgHours: number | null;
  medianHours: number | null;
  p90Hours: number | null;
  minHours: number | null;
  maxHours: number | null;
} {
  const values = valuesHours.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (values.length === 0) {
    return { count: 0, avgHours: null, medianHours: null, p90Hours: null, minHours: null, maxHours: null };
  }

  const sum = values.reduce((acc, v) => acc + v, 0);
  const mid = Math.floor(values.length / 2);
  const median =
    values.length % 2 === 0 ? (values[mid - 1]! + values[mid]!) / 2 : values[mid]!;
  const p90Index = Math.min(values.length - 1, Math.ceil(values.length * 0.9) - 1);

  return {
    count: values.length,
    avgHours: round(sum / values.length, 2),
    medianHours: round(median, 2),
    p90Hours: round(values[p90Index]!, 2),
    minHours: round(values[0]!, 2),
    maxHours: round(values[values.length - 1]!, 2),
  };
}

export function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function parseRepoArg(value: string): { owner: string; repo: string } {
  const cleaned = value.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '');
  const parts = cleaned.split('/').filter(Boolean);
  if (parts.length < 2) {
    throw new Error(`Invalid repo "${value}". Expected owner/repo`);
  }
  return { owner: parts[0]!, repo: parts[1]! };
}

/** Default Actions workflow file that creates GitHub Releases. */
export const DEFAULT_RELEASE_WORKFLOW_FILE = 'release.yml';

/** Normalize a workflow path/filename to the basename GitHub's API accepts (e.g. `release.yml`). */
export function normalizeReleaseWorkflowFile(value: string | null | undefined): string {
  const raw = (value ?? DEFAULT_RELEASE_WORKFLOW_FILE).trim();
  if (!raw) return DEFAULT_RELEASE_WORKFLOW_FILE;
  return raw
    .replace(/^\.?\//, '')
    .replace(/^\.?github\/workflows\//i, '')
    .replace(/^workflows\//i, '');
}

export function normalizeTagRef(value: string): string {
  return value.replace(/^refs\/tags\//, '').trim();
}

/**
 * Heuristic: treat a ref as a release tag when it is not a typical branch name
 * (main/master/develop/…, or a long commit SHA).
 */
export function looksLikeReleaseTag(value: string | null | undefined): boolean {
  if (!value) return false;
  const tag = normalizeTagRef(value);
  if (!tag) return false;
  if (looksLikeCommitSha(tag) && tag.length >= 40) return false;
  if (/^(main|master|develop|development|trunk|head|gh-pages)$/i.test(tag)) return false;
  if (/^(feature|bugfix|hotfix|release|chore|docs|ci|test|refactor)\//i.test(tag)) return false;
  // Prefer version-ish / dated tags, or refs that already look like tags (v1.2.3, 2026.08.06.1).
  if (/^v?\d+(\.\d+)+/i.test(tag)) return true;
  if (/^\d{4}[.\-_]\d{2}[.\-_]\d{2}/.test(tag)) return true;
  // Tag-triggered release trains often use the tag as head_branch.
  if (!tag.includes('/') && /[0-9]/.test(tag)) return true;
  return false;
}

/**
 * Resolve the release tag associated with a workflow run.
 * Prefers orchestration.branch, then a tag-like head_branch, then release_notes_url path.
 */
export function resolveWorkflowRunTag(input: {
  branch?: string | null;
  orchestrationBranch?: string | null;
  releaseNotesUrl?: string | null;
}): string | null {
  const candidates = [input.orchestrationBranch, input.branch]
    .map((v) => (v ? normalizeTagRef(v) : ''))
    .filter(Boolean);

  for (const candidate of candidates) {
    if (looksLikeReleaseTag(candidate)) return candidate;
  }

  const url = input.releaseNotesUrl?.trim();
  if (url) {
    const tagMatch = url.match(/\/(?:releases\/tag|tags)\/([^/?#]+)/i);
    if (tagMatch?.[1]) {
      try {
        return normalizeTagRef(decodeURIComponent(tagMatch[1]));
      } catch {
        return normalizeTagRef(tagMatch[1]);
      }
    }
  }

  return candidates[0] || null;
}

/** True when a GitHub `target_commitish` looks like a commit SHA rather than a branch name. */
export function looksLikeCommitSha(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^[0-9a-f]{7,40}$/i.test(value.trim());
}

function shaEquals(a: string, b: string): boolean {
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  if (!left || !right) return false;
  if (left === right) return true;
  // Allow abbreviated SHA prefix matches when either side is short.
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  return shorter.length >= 7 && longer.startsWith(shorter);
}

function pickBestCreatingRunCandidate<
  T extends {
    createdAt: string;
    updatedAt: string;
    status: string | null;
    conclusion: string | null;
  },
>(candidates: T[], publishedAt: string | null | undefined): T {
  if (candidates.length === 1) return candidates[0]!;
  const publishedMs = publishedAt ? Date.parse(publishedAt) : Number.NaN;
  return [...candidates].sort((a, b) => {
    const score = (run: T) => {
      let s = 0;
      if (run.conclusion === 'success') s += 2;
      if (run.status === 'completed') s += 1;
      return s;
    };
    const byScore = score(b) - score(a);
    if (byScore !== 0) return byScore;
    if (Number.isFinite(publishedMs)) {
      const aDelta = Math.abs(Date.parse(a.updatedAt) - publishedMs);
      const bDelta = Math.abs(Date.parse(b.updatedAt) - publishedMs);
      return aDelta - bDelta;
    }
    return Date.parse(b.createdAt) - Date.parse(a.createdAt);
  })[0]!;
}

/**
 * Find the Actions run that likely created a release.
 *
 * Matching order:
 * 1. `head_sha` equals release `target_commitish` (schedule / workflow_dispatch release trains)
 * 2. `head_branch` equals the release tag (tag-triggered workflows)
 */
export function matchReleaseCreatingRun<
  T extends {
    branch: string;
    headSha?: string | null;
    createdAt: string;
    updatedAt: string;
    status: string | null;
    conclusion: string | null;
  },
>(
  tagName: string,
  publishedAt: string | null | undefined,
  runs: T[],
  targetCommitish?: string | null,
): T | null {
  const tag = normalizeTagRef(tagName);

  if (looksLikeCommitSha(targetCommitish)) {
    const bySha = runs.filter((run) => run.headSha && shaEquals(run.headSha, targetCommitish!));
    if (bySha.length > 0) return pickBestCreatingRunCandidate(bySha, publishedAt);
  }

  if (tag) {
    const byTag = runs.filter((run) => normalizeTagRef(run.branch) === tag);
    if (byTag.length > 0) return pickBestCreatingRunCandidate(byTag, publishedAt);
  }

  return null;
}

/** Parse owner/repo from `owner/repo`, a github.com URL, or a repo-only name with fallback owner. */
export function parseGithubRepoRef(
  value: string | null | undefined,
  fallbackOwner?: string,
): { owner: string; repo: string } | null {
  if (!value?.trim()) return null;
  const cleaned = value
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '');
  const parts = cleaned.split('/').filter(Boolean);
  if (parts.length >= 2) return { owner: parts[0]!, repo: parts[1]! };
  if (parts.length === 1 && fallbackOwner) return { owner: fallbackOwner, repo: parts[0]! };
  return null;
}

/** Parse owner/repo/runId from a GitHub Actions run URL. */
export function parseGithubActionsRunUrl(
  url: string | null | undefined,
): { owner: string; repo: string; runId: number } | null {
  if (!url) return null;
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/actions\/runs\/(\d+)/i);
  if (!match) return null;
  const runId = Number(match[3]);
  if (!Number.isFinite(runId) || runId <= 0) return null;
  return { owner: match[1]!, repo: match[2]!, runId };
}

/** Lookback window for list views. Always a finite age — never “all items”. */
export type AgeLookbackDays = 7 | 14 | 30 | 90;

export const DEFAULT_AGE_LOOKBACK_DAYS: AgeLookbackDays = 7;

export const AGE_LOOKBACK_OPTIONS: Array<{ value: AgeLookbackDays; label: string }> = [
  { value: 7, label: 'Last 7 days' },
  { value: 14, label: 'Last 14 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
];

/** Earliest ms still inside the lookback window. */
export function ageLookbackCutoffMs(days: AgeLookbackDays, now = Date.now()): number {
  return now - days * 24 * 60 * 60 * 1000;
}

/** ISO cutoff for APIs that accept `since` / `created`. */
export function ageLookbackCutoffIso(days: AgeLookbackDays, now = Date.now()): string {
  return new Date(ageLookbackCutoffMs(days, now)).toISOString();
}

/** True when `isoDate` falls within the lookback window. */
export function isWithinAgeLookback(
  isoDate: string | null | undefined,
  days: AgeLookbackDays,
  now = Date.now(),
): boolean {
  if (!isoDate) return false;
  const t = Date.parse(isoDate);
  if (!Number.isFinite(t)) return false;
  return t >= ageLookbackCutoffMs(days, now);
}

/** Parse `days` query values (`7` | `14` | `30` | `90`). Invalid → default 7d. */
export function parseAgeLookbackParam(raw: unknown): AgeLookbackDays {
  if (raw == null || raw === '') return DEFAULT_AGE_LOOKBACK_DAYS;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (n === 7 || n === 14 || n === 30 || n === 90) return n;
  return DEFAULT_AGE_LOOKBACK_DAYS;
}

/**
 * Cap for workflow run fetches. Busy repos can produce thousands of runs in a
 * few days, so count is a better bound than age for Actions data.
 */
export type RunLimit = 50 | 100 | 200 | 500;

export const DEFAULT_RUN_LIMIT: RunLimit = 100;

/** Recent runs sampled per workflow definition (GraphQL batch on workflows page / stats). */
export const PER_WORKFLOW_RUN_SAMPLE = 20;

export const RUN_LIMIT_OPTIONS: Array<{ value: RunLimit; label: string }> = [
  { value: 50, label: 'Last 50 runs' },
  { value: 100, label: 'Last 100 runs' },
  { value: 200, label: 'Last 200 runs' },
  { value: 500, label: 'Last 500 runs' },
];

/** Parse `limit` query values for workflow runs. Invalid → default 100. */
export function parseRunLimitParam(raw: unknown): RunLimit {
  if (raw == null || raw === '') return DEFAULT_RUN_LIMIT;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (n === 50 || n === 100 || n === 200 || n === 500) return n;
  return DEFAULT_RUN_LIMIT;
}

/** Map overview age filter to a workflow run sample size. */
export function runLimitForAgeLookback(days: AgeLookbackDays): RunLimit {
  switch (days) {
    case 7:
      return 100;
    case 14:
      return 200;
    case 30:
      return 500;
    case 90:
      return 500;
  }
}

export function formatDurationHours(hours: number | null | undefined): string {
  if (hours == null || !Number.isFinite(hours)) return '—';
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${round(hours, 1)}h`;
  return `${round(hours / 24, 1)}d`;
}

export function formatDurationSeconds(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${round(seconds / 60, 1)}m`;
  return `${round(seconds / 3600, 1)}h`;
}

const FAILURE_CONCLUSIONS = new Set([
  'failure',
  'timed_out',
  'startup_failure',
  'action_required',
]);

/** Roll up individual check/status items into an overall PR check state. */
export function rollupCheckState(
  checks: Array<{ status: string; conclusion: string | null }>,
): 'pending' | 'success' | 'failure' | 'neutral' {
  if (checks.length === 0) return 'neutral';
  if (checks.some((c) => c.status !== 'completed')) return 'pending';
  if (checks.some((c) => c.conclusion && FAILURE_CONCLUSIONS.has(c.conclusion))) return 'failure';
  if (checks.some((c) => c.conclusion === 'success')) return 'success';
  return 'neutral';
}
