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

- **Overview** — repo snapshot plus PR / commit / release / workflow highlights and charts
- **Pull requests** — list with merge timing (avg / median / p90), drill into description, reviewers, timeline
- **Commits** — recent history, verification, author stats, file-level drill-down
- **Releases** — publish cadence timing; release notes parsed for `#123` / PR URLs; associated PRs listed on the detail page
- **Workflows** — Actions success rate, duration stats, per-workflow breakdown, job/step drill-down

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/meta` | Configured owner/repo |
| `GET /api/overview` | Aggregated stats |
| `GET /api/prs` | PR list + stats |
| `GET /api/prs/:number` | PR detail |
| `GET /api/commits` | Commit list + stats |
| `GET /api/commits/:sha` | Commit detail |
| `GET /api/releases` | Release list + stats |
| `GET /api/releases/:id` | Release detail + linked PRs |
| `GET /api/workflows` | Workflow runs + metrics |
| `GET /api/workflows/:id` | Run detail with jobs/steps |
