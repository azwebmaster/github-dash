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
  timeToMergeHours: number | null;
  timeToCloseHours: number | null;
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
  reviewers: string[];
  requestedReviewers: string[];
  timeline: Array<{
    event: string;
    createdAt: string;
    actor: string | null;
  }>;
}

export interface PrStats {
  total: number;
  open: number;
  closed: number;
  merged: number;
  draft: number;
  mergeTiming: TimingStats;
  closeTiming: TimingStats;
  avgAdditions: number;
  avgDeletions: number;
  avgChangedFiles: number;
  topAuthors: Array<{ login: string; count: number }>;
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
  createdAt: string;
  updatedAt: string;
  runStartedAt: string | null;
  durationSeconds: number | null;
  htmlUrl: string;
  attempt: number;
}

export interface WorkflowRunDetail extends WorkflowRunSummary {
  jobs: Array<{
    id: number;
    name: string;
    status: string;
    conclusion: string | null;
    startedAt: string | null;
    completedAt: string | null;
    durationSeconds: number | null;
    steps: Array<{
      name: string;
      status: string;
      conclusion: string | null;
      number: number;
      durationSeconds: number | null;
    }>;
  }>;
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
    name: string;
    total: number;
    success: number;
    failure: number;
    avgDurationSeconds: number | null;
  }>;
  recentConclusions: Array<{ date: string; success: number; failure: number; other: number }>;
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
}
