# GitHub Dash

Local GitHub repository dashboard. Pass an org/repo on the CLI; the app opens a web UI for pull requests, commits, releases, and GitHub Actions metrics.

## Stack

- **pnpm** · **TypeScript** · **ESM**
- **React** + **MUI** frontend
- **Express** API backed by **Octokit**
- CLI entry via **Commander**

## Setup

```bash
pnpm install
```

Set a GitHub token (recommended — unauthenticated calls are rate-limited):

```bash
export GITHUB_TOKEN=ghp_...
```

The token needs `repo` (private) or public read access for public repos. Workflow metrics need Actions read permission.

## Run

Build and start for a repository:

```bash
pnpm build
pnpm start -- facebook/react
```

Or:

```bash
pnpm start -- owner/repo --port 3847
```

Options:

| Flag | Description |
|------|-------------|
| `<repo>` | Required. `owner/repo` or a github.com URL |
| `-p, --port` | HTTP port (default `3847`) |
| `-t, --token` | GitHub token (else `GITHUB_TOKEN`) |
| `-r, --release-workflow` | Actions workflow file that creates releases (default `release.yml`, or `RELEASE_WORKFLOW`) |
| `--no-open` | Skip opening the browser |
| `--host` | Bind address (default `127.0.0.1`) |

### Development

```bash
export GITHUB_REPO=owner/repo   # used by the API in dev
export GITHUB_TOKEN=...
pnpm dev
```

Vite serves the UI on `:5173` and proxies `/api` to the Express server on `:3847`.

## Features

- **Overview** — repo snapshot, attention strip (oldest PRs, flaky/slow workflows, release gap, orchestration), merge timing, pinned workflow cards, and charts
- **Pull requests** — list with merge timing (avg / median / p90), drill into description, reviewers, timeline, and commit checks (polls while pending)
- **Commits** — recent history, verification, author stats, file-level drill-down
- **Releases** — publish cadence timing; release notes parsed for `#123` / PR URLs; associated PRs listed on the detail page; creating-run stats from the configured release workflow (default `release.yml`), matched by release tag; cached release-train / orchestration stage health
- **Workflows** — Actions success rate and duration stats with per-workflow flake streaks, conclusion strips, and duration sparklines; pin summary cards; click a workflow to see its past 100 runs, then open a run for job/step timings with longest job and step highlighted

GitHub responses are cached in-memory (`CACHE_TTL_MS`, default 5 minutes). Overview and orchestration health are warmed on server start.

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/meta` | Configured owner/repo |
| `GET /api/overview` | Aggregated stats + insights |
| `GET /api/prs` | PR list + stats |
| `GET /api/prs/:number` | PR detail |
| `GET /api/prs/:number/checks` | Check runs + commit statuses for the PR head (for polling) |
| `GET /api/commits` | Commit list + stats |
| `GET /api/commits/:sha` | Commit detail |
| `GET /api/releases` | Release list + stats |
| `GET /api/releases/:id` | Release detail + linked PRs |
| `GET /api/workflows` | Workflow runs + metrics (includes per-workflow ids for drill-down) |
| `GET /api/workflows/by/:workflowId` | Past 100 runs for a selected workflow |
| `GET /api/workflows/:id` | Run detail with jobs/steps and durations |
| `GET /api/orchestration/health` | Cached release-workflow orchestration stage rollups |
