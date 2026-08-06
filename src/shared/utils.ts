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
