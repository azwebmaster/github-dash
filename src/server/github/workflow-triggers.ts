/** Known GitHub Actions event → lifecycle lane mapping. */
export type WorkflowLifecycleLaneId =
  | 'pull_request'
  | 'merge_queue'
  | 'push'
  | 'release'
  | 'schedule'
  | 'manual'
  | 'reusable'
  | 'other';

export const LIFECYCLE_LANE_ORDER: WorkflowLifecycleLaneId[] = [
  'pull_request',
  'merge_queue',
  'push',
  'release',
  'schedule',
  'manual',
  'reusable',
  'other',
];

export const LIFECYCLE_LANE_META: Record<
  WorkflowLifecycleLaneId,
  { label: string; description: string; primary: boolean }
> = {
  pull_request: {
    label: 'Pull request',
    description: 'Runs on PR open / sync (path-filtered where noted).',
    primary: true,
  },
  merge_queue: {
    label: 'Merge queue',
    description: 'Runs when a PR enters the merge queue (`merge_group`).',
    primary: true,
  },
  push: {
    label: 'Push',
    description: 'Runs after merge / push to configured branches.',
    primary: true,
  },
  release: {
    label: 'Release / deploy',
    description: 'Release trains, promotes, and deploy workflows.',
    primary: true,
  },
  schedule: {
    label: 'Schedule',
    description: 'Cron / scheduled workflows.',
    primary: false,
  },
  manual: {
    label: 'Manual',
    description: 'Triggered via workflow_dispatch or repository_dispatch.',
    primary: false,
  },
  reusable: {
    label: 'Reusable',
    description: 'Called by other workflows (`workflow_call`).',
    primary: false,
  },
  other: {
    label: 'Other',
    description: 'Less common events (workflow_run, issues, bots, …).',
    primary: false,
  },
};

const EVENT_TO_LANE: Record<string, WorkflowLifecycleLaneId> = {
  pull_request: 'pull_request',
  pull_request_target: 'pull_request',
  pull_request_review: 'pull_request',
  pull_request_review_comment: 'pull_request',
  merge_group: 'merge_queue',
  push: 'push',
  create: 'push',
  delete: 'push',
  release: 'release',
  deployment: 'release',
  deployment_status: 'release',
  schedule: 'schedule',
  workflow_dispatch: 'manual',
  repository_dispatch: 'manual',
  workflow_call: 'reusable',
};

const RELEASEISH_NAME =
  /\b(release|promote|rollback|deploy|dark.?release|katana)\b/i;

export function laneForEvent(event: string): WorkflowLifecycleLaneId {
  return EVENT_TO_LANE[event] ?? 'other';
}

export function lanesForTriggers(
  triggers: string[],
  workflowName: string,
): WorkflowLifecycleLaneId[] {
  const lanes = new Set<WorkflowLifecycleLaneId>();
  for (const event of triggers) {
    lanes.add(laneForEvent(event));
  }
  // Manual promote / release workflows often only declare workflow_dispatch;
  // surface them on the release lane when the name clearly matches.
  if (
    lanes.has('manual') &&
    !lanes.has('release') &&
    RELEASEISH_NAME.test(workflowName)
  ) {
    lanes.add('release');
  }
  return LIFECYCLE_LANE_ORDER.filter((id) => lanes.has(id));
}

/**
 * Extract top-level `on:` triggers from a GitHub Actions workflow YAML.
 * Intentionally lightweight — only needs event names and path-filter presence.
 */
export function extractWorkflowTriggers(yaml: string): {
  events: string[];
  hasPathFilters: boolean;
} {
  const lines = yaml.replace(/\r\n/g, '\n').split('\n');
  let onStart = -1;
  let onInline: string | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (/^\s*#/.test(line) || !line.trim()) continue;
    const match = /^(?:on|"on"|'on')\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    // Top-level only (no leading indent).
    if (/^\s/.test(line)) continue;
    onStart = i;
    onInline = match[1]!.trim();
    break;
  }

  if (onStart < 0) return { events: [], hasPathFilters: false };

  // Scalar / flow form on the same line: `on: push` or `on: [push, pull_request]`
  if (onInline && onInline !== '|' && onInline !== '>') {
    if (onInline.startsWith('[') && onInline.endsWith(']')) {
      const events = onInline
        .slice(1, -1)
        .split(',')
        .map((s) => stripQuotes(s.trim()))
        .filter(Boolean);
      return { events, hasPathFilters: false };
    }
    if (!onInline.startsWith('{')) {
      return { events: [stripQuotes(onInline)], hasPathFilters: false };
    }
  }

  const events: string[] = [];
  let hasPathFilters = false;
  for (let i = onStart + 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (!line.trim() || /^\s*#/.test(line)) continue;
    // Next top-level key ends the `on:` block.
    if (/^[A-Za-z"']/.test(line)) break;

    if (/\bpaths\s*:/.test(line) || /\bpaths-ignore\s*:/.test(line)) {
      hasPathFilters = true;
    }

    // Direct children of `on:` are indented with 2 spaces (typical) and are keys.
    const child = /^ {2}(?:- )?([A-Za-z0-9_-]+|"[^"]+"|'[^']+')\s*:/.exec(line);
    if (child) {
      events.push(stripQuotes(child[1]!));
      continue;
    }
    // Sequence under `on:`: `- push`
    const seq = /^ {2}- ([A-Za-z0-9_-]+|"[^"]+"|'[^']+')\s*$/.exec(line);
    if (seq) {
      events.push(stripQuotes(seq[1]!));
    }
  }

  return { events: unique(events), hasPathFilters };
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
