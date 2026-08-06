import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GitHubService } from './github/service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface CreateAppOptions {
  owner: string;
  repo: string;
  token?: string;
  staticDir?: string;
}

export function createApp(options: CreateAppOptions): Express {
  const app = express();
  const github = new GitHubService({
    owner: options.owner,
    repo: options.repo,
    token: options.token,
  });

  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, repo: `${options.owner}/${options.repo}` });
  });

  app.get('/api/meta', (_req, res) => {
    res.json({ owner: options.owner, repo: options.repo });
  });

  app.get('/api/overview', async (_req, res, next) => {
    try {
      res.json(await github.getOverview());
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/prs', async (_req, res, next) => {
    try {
      const [items, stats] = await Promise.all([github.listPullRequests(), github.getPrStats()]);
      res.json({ items, stats });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/prs/:number', async (req, res, next) => {
    try {
      const number = Number(req.params.number);
      if (!Number.isFinite(number)) {
        res.status(400).json({ error: 'Invalid PR number' });
        return;
      }
      res.json(await github.getPullRequest(number));
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/prs/:number/checks', async (req, res, next) => {
    try {
      const number = Number(req.params.number);
      if (!Number.isFinite(number)) {
        res.status(400).json({ error: 'Invalid PR number' });
        return;
      }
      res.json(await github.getPullRequestChecks(number));
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/commits', async (_req, res, next) => {
    try {
      const [items, stats] = await Promise.all([github.listCommits(), github.getCommitStats()]);
      res.json({ items, stats });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/commits/:sha', async (req, res, next) => {
    try {
      res.json(await github.getCommit(req.params.sha));
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/releases', async (_req, res, next) => {
    try {
      const [items, stats] = await Promise.all([github.listReleases(), github.getReleaseStats()]);
      res.json({ items, stats });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/releases/:id', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: 'Invalid release id' });
        return;
      }
      res.json(await github.getRelease(id));
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/workflows', async (_req, res, next) => {
    try {
      const [items, stats] = await Promise.all([github.listWorkflowRuns(), github.getWorkflowStats()]);
      res.json({ items, stats });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/workflows/by/:workflowId', async (req, res, next) => {
    try {
      const workflowId = Number(req.params.workflowId);
      if (!Number.isFinite(workflowId)) {
        res.status(400).json({ error: 'Invalid workflow id' });
        return;
      }
      res.json(await github.listRunsForWorkflow(workflowId));
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/workflows/:id', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: 'Invalid workflow run id' });
        return;
      }
      res.json(await github.getWorkflowRun(id));
    } catch (err) {
      next(err);
    }
  });

  const staticDir = options.staticDir ?? path.resolve(__dirname, '../client');
  app.use(express.static(staticDir));
  app.get('/{*splat}', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }
    res.sendFile(path.join(staticDir, 'index.html'), (err) => {
      if (err) next();
    });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status =
      typeof err === 'object' && err && 'status' in err && typeof (err as { status: unknown }).status === 'number'
        ? (err as { status: number }).status
        : typeof err === 'object' && err && 'statusCode' in err && typeof (err as { statusCode: unknown }).statusCode === 'number'
          ? (err as { statusCode: number }).statusCode
          : 500;

    const message =
      err instanceof Error
        ? err.message
        : typeof err === 'object' && err && 'message' in err
          ? String((err as { message: unknown }).message)
          : 'Internal server error';

    console.error('[api]', message);
    res.status(status >= 400 && status < 600 ? status : 500).json({ error: message });
  });

  return app;
}
