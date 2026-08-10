export interface RepoRef {
  owner: string;
  repo: string;
}

export interface TimingStats {
  count: number;
  avgHours: number | null;
  medianHours: number | null;
  p90Hours: number | null;
  minHours: number | null;
  maxHours: number | null;
}

export interface PrSummary {
  number: number;
  title: string;
  state: 'open' | 'closed';
  draft: boolean;
  merged: boolean;
  author: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  mergedAt: string | null;
  ageHours: number | null;
  timeToCloseHours: number | null;
  /** Hours from created → merged; null when not merged. */
  timeToMergeHours: number | null;
  comments: number;
  additions: number;
  deletions: number;
  changedFiles: number;
  labels: string[];
  base: string;
  head: string;
  htmlUrl: string;
}

export interface PrDetail extends PrSummary {
  body: string | null;
  commits: number;
  headSha: string;
  reviewers: string[];
  requestedReviewers: string[];
  timeline: Array<{
    event: string;
    createdAt: string;
    actor: string | null;
  }>;
}

export type PrCheckState = 'pending' | 'success' | 'failure' | 'neutral';

export interface PrCheck {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationSeconds: number | null;
  htmlUrl: string | null;
  appName: string | null;
}

export interface PrChecks {
  headSha: string;
  shortSha: string;
  state: PrCheckState;
  totalCount: number;
  checks: PrCheck[];
}

export interface PrStats {
  total: number;
  open: number;
  closed: number;
  merged: number;
  draft: number;
  ageTiming: TimingStats;
  /** Closed without merge only. */
  closeTiming: TimingStats;
  /** Merged PRs: created → merged. */
  mergeTiming: TimingStats;
  avgAdditions: number;
  avgDeletions: number;
  avgChangedFiles: number;
  topAuthors: Array<{ login: string; count: number }>;
}

export type WorkflowConclusionKind = 'success' | 'failure' | 'cancelled' | 'other';

export interface OrchestrationHealthSummary {
  sampleSize: number;
  runsWithState: number;
  stageStats: Array<{
    stageId: string;
    name: string;
    group: string;
    successRate: number;
    failureRate: number;
    samples: number;
  }>;
  topFailingSuites: Array<{ name: string; failures: number }>;
  recentRuns: Array<{
    runId: number;
    createdAt: string;
    htmlUrl: string;
    failedStages: string[];
  }>;
}

export interface OverviewInsights {
  oldestOpenPrs: Array<{
    number: number;
    title: string;
    ageHours: number | null;
    htmlUrl: string;
  }>;
  attentionWorkflows: Array<{
    workflowId: number;
    name: string;
    successRate: number;
    consecutiveFailures: number;
    avgDurationSeconds: number | null;
  }>;
  slowestWorkflows: Array<{
    workflowId: number;
    name: string;
    avgDurationSeconds: number | null;
  }>;
  releaseGapHours: number | null;
  orchestrationSummary: OrchestrationHealthSummary | null;
}

export interface CommitSummary {
  sha: string;
  shortSha: string;
  message: string;
  authorName: string | null;
  authorLogin: string | null;
  authorDate: string | null;
  committerDate: string | null;
  htmlUrl: string;
  verified: boolean;
}

export interface CommitDetail extends CommitSummary {
  body: string;
  parents: string[];
  stats: { additions: number; deletions: number; total: number };
  files: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    changes: number;
  }>;
}

export interface CommitStats {
  total: number;
  verified: number;
  topAuthors: Array<{ login: string; count: number }>;
  commitsPerDay: Array<{ date: string; count: number }>;
}

/** Workflow run that created (or is tagged with) a GitHub Release. */
export interface ReleaseCreatingRunSummary {
  id: number;
  workflowId: number;
  status: string | null;
  conclusion: string | null;
  event: string;
  durationSeconds: number | null;
  htmlUrl: string;
  createdAt: string;
  attempt: number;
}

export interface ReleaseSummary {
  id: number;
  tagName: string;
  name: string;
  draft: boolean;
  prerelease: boolean;
  author: string | null;
  createdAt: string;
  publishedAt: string | null;
  htmlUrl: string;
  timeSincePreviousHours: number | null;
  associatedPrNumbers: number[];
  associatedPrCount: number;
  /** Run from the configured release workflow (matched by commit SHA and/or tag). */
  creatingRun: ReleaseCreatingRunSummary | null;
  /** Release target commit / branch from GitHub (`target_commitish`). */
  targetCommitish: string | null;
}

export interface ReleaseDetail extends ReleaseSummary {
  body: string | null;
  associatedPrs: Array<{
    number: number;
    title: string | null;
    htmlUrl: string | null;
    mergedAt: string | null;
    author: string | null;
  }>;
  assets: Array<{
    name: string;
    size: number;
    downloadCount: number;
    contentType: string;
  }>;
}

export interface ReleaseStats {
  total: number;
  drafts: number;
  prereleases: number;
  published: number;
  releaseCadence: TimingStats;
  avgPrsPerRelease: number;
  associatedPrTotal: number;
  /** Configured workflow file used to look up creating runs (e.g. `release.yml`). */
  creatingWorkflowFile: string;
  creatingRunsMatched: number;
  creatingRunsMissing: number;
  creatingRunSuccess: number;
  creatingRunFailure: number;
  creatingRunSuccessRate: number;
  creatingRunDuration: TimingStats;
}

export interface WorkflowRunSummary {
  id: number;
  name: string;
  workflowId: number;
  workflowName: string;
  status: string | null;
  conclusion: string | null;
  event: string;
  branch: string;
  headSha: string;
  createdAt: string;
  updatedAt: string;
  runStartedAt: string | null;
  durationSeconds: number | null;
  htmlUrl: string;
  attempt: number;
}

/** Stage status from release-train / orchestration state.json (Go enum). */
export type OrchestrationStageStateCode = 0 | 1 | 2 | 3 | 4;

export interface OrchestrationOutputSpec {
  From: string;
  JobMatch: string;
  Pattern: string;
}

export interface OrchestrationStageDef {
  ID: string;
  Name: string;
  Group: string;
  Type: string;
  Repo: string;
  Workflow: string;
  Ref: string;
  ActiveRunCheck: boolean | null;
  ActiveRunFilter: string;
  Advisory: boolean;
  TestSummary: boolean;
  HostPaas: boolean;
  Inputs: Record<string, string> | null;
  Outputs: Record<string, OrchestrationOutputSpec> | null;
  Matrix: Array<{ Inputs: Record<string, string> }> | null;
  Items: string[] | null;
  URL: string;
  ExpectVersion: string;
}

export interface OrchestrationMatrixRun {
  Inputs: Record<string, string>;
  RunURL: string;
  RunID: number;
  State: number;
  Error: string;
  DryRunCmd: string;
  StatusText: string;
}

export interface OrchestrationTestSuite {
  key: string;
  label: string;
  status: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  failedShards: number[];
  failedTests: string[];
  failedTestsOverflow: number;
}

export interface OrchestrationTestReport {
  environment: string;
  overall: string;
  testJobResult: string;
  mergeResult: string;
  hostPaasResult: string;
  infraFailure: boolean;
  suites: OrchestrationTestSuite[];
  hostPaas: { present: boolean; status: string };
}

export interface OrchestrationStageRun {
  Stage: OrchestrationStageDef;
  Env: string;
  State: number;
  RunURL: string;
  RunID: number;
  StartTime: string;
  EndTime: string;
  Error: string;
  Outputs: Record<string, string>;
  DryRunCmd: string;
  StatusText: string;
  MatrixRuns: OrchestrationMatrixRun[] | null;
  TestReport: OrchestrationTestReport | null;
}

export interface WorkflowOrchestrationState {
  pipeline: {
    stages: OrchestrationStageRun[];
    values: Record<string, string>;
    snapshot: Record<string, string>;
  };
  release_notes?: string;
  release_notes_url?: string;
  author_mentions?: Record<string, string>;
  slack_ts?: string;
  operator?: string;
  branch?: string;
  commit?: string;
  start_unix?: number;
}

export interface WorkflowRunDetail extends WorkflowRunSummary {
  jobs: Array<{
    id: number;
    name: string;
    status: string;
    conclusion: string | null;
    /** When the job entered the queued state (after `needs` clear). */
    createdAt: string | null;
    startedAt: string | null;
    completedAt: string | null;
    /** Runner execution time: started → completed. */
    durationSeconds: number | null;
    /** Idle time waiting for a runner: created → started. */
    queueSeconds: number | null;
    htmlUrl: string;
    steps: Array<{
      name: string;
      status: string;
      conclusion: string | null;
      number: number;
      durationSeconds: number | null;
      /** Deep link to this step's logs on the GitHub job page. */
      htmlUrl: string;
    }>;
  }>;
  /** Parsed state.json from a run artifact, when present. */
  orchestration: WorkflowOrchestrationState | null;
  orchestrationArtifact: { id: number; name: string } | null;
}

export interface WorkflowStats {
  totalRuns: number;
  success: number;
  failure: number;
  cancelled: number;
  other: number;
  successRate: number;
  duration: TimingStats;
  byWorkflow: Array<{
    workflowId: number;
    name: string;
    total: number;
    success: number;
    failure: number;
    successRate: number;
    failureRate: number;
    consecutiveFailures: number;
    recentConclusions: WorkflowConclusionKind[];
    /** Durations oldest → newest (for sparklines). */
    durationSparkline: number[];
    avgDurationSeconds: number | null;
    maxDurationSeconds: number | null;
  }>;
  recentConclusions: Array<{ date: string; success: number; failure: number; other: number }>;
}

/** Lifecycle stage for grouping workflows by when they run. */
export type WorkflowLifecycleLaneId =
  | 'pull_request'
  | 'merge_queue'
  | 'push'
  | 'release'
  | 'schedule'
  | 'manual'
  | 'reusable'
  | 'other';

export interface WorkflowMapEntry {
  workflowId: number;
  name: string;
  path: string;
  state: string;
  /** Raw GitHub Actions event names from the workflow `on:` block. */
  triggers: string[];
  lanes: WorkflowLifecycleLaneId[];
  /** True when any trigger declares `paths` / `paths-ignore`. */
  pathFiltered: boolean;
  /** How triggers were determined. */
  source: 'yaml' | 'observed' | 'unknown';
}

export interface WorkflowLifecycleLane {
  id: WorkflowLifecycleLaneId;
  label: string;
  description: string;
  /** Part of the main PR → queue → push → release path. */
  primary: boolean;
  workflows: WorkflowMapEntry[];
}

export interface WorkflowLifecycleMap {
  lanes: WorkflowLifecycleLane[];
  workflows: WorkflowMapEntry[];
  parsedFromYaml: number;
  observedOnly: number;
  unknown: number;
}

export interface OverviewStats {
  repo: {
    fullName: string;
    description: string | null;
    htmlUrl: string;
    defaultBranch: string;
    stars: number;
    forks: number;
    openIssues: number;
    language: string | null;
    pushedAt: string | null;
  };
  prs: PrStats;
  commits: CommitStats;
  releases: ReleaseStats;
  workflows: WorkflowStats;
  insights: OverviewInsights;
}
