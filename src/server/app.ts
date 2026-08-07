import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_AGE_LOOKBACK_DAYS,
  DEFAULT_RELEASE_WORKFLOW_FILE,
  DEFAULT_RUN_LIMIT,
  normalizeReleaseWorkflowFile,
  parseAgeLookbackParam,
  parseRunLimitParam,
} from '../shared/utils.js';
import { GitHubService } from './github/service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface CreateAppOptions {
  owner: string;
  repo: string;
  token?: string;
  staticDir?: string;
  /** Prefetch default lookback on boot (default true). */
  warmCache?: boolean;
  /** Actions workflow file that creates releases (default `release.yml`). */
  releaseWorkflowFile?: string;
}

export function createApp(options: CreateAppOptions): Express {
  const app = express();
  const releaseWorkflowFile = normalizeReleaseWorkflowFile(
    options.releaseWorkflowFile ?? process.env.RELEASE_WORKFLOW ?? DEFAULT_RELEASE_WORKFLOW_FILE,
  );
  const github = new GitHubService({
    owner: options.owner,
    repo: options.repo,
    token: options.token,
    releaseWorkflowFile,
  });

  if (options.warmCache !== false) {
    github.warmDefaults();
  }
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, repo: `${options.owner}/${options.repo}` });
  });

  app.get('/api/meta', (_req, res) => {
    res.json({
      owner: options.owner,
      repo: options.repo,
      releaseWorkflowFile: github.releaseWorkflowFile,
    });
  });

  app.get('/api/overview', async (req, res, next) => {
    try {
      const days =
        req.query.days === undefined
          ? DEFAULT_AGE_LOOKBACK_DAYS
          : parseAgeLookbackParam(req.query.days);
      res.json(await github.getOverview(days));
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/prs', async (req, res, next) => {
    try {
      const days =
        req.query.days === undefined
          ? DEFAULT_AGE_LOOKBACK_DAYS
          : parseAgeLookbackParam(req.query.days);
      const [items, stats] = await Promise.all([
        github.listPullRequests(days),
        github.getPrStats(days),
      ]);
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

  app.get('/api/commits', async (req, res, next) => {
    try {
      const days =
        req.query.days === undefined
          ? DEFAULT_AGE_LOOKBACK_DAYS
          : parseAgeLookbackParam(req.query.days);
      const [items, stats] = await Promise.all([
        github.listCommits(days),
        github.getCommitStats(days),
      ]);
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

  app.get('/api/releases', async (req, res, next) => {
    try {
      const days =
        req.query.days === undefined
          ? DEFAULT_AGE_LOOKBACK_DAYS
          : parseAgeLookbackParam(req.query.days);
      const [items, stats] = await Promise.all([
        github.listReleases(days),
        github.getReleaseStats(days),
      ]);
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

  app.get('/api/workflows', async (req, res, next) => {
    try {
      const limit =
        req.query.limit === undefined
          ? DEFAULT_RUN_LIMIT
          : parseRunLimitParam(req.query.limit);
      const [items, stats] = await Promise.all([
        github.listWorkflowRuns(limit),
        github.getWorkflowStats(limit),
      ]);
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
      const limit =
        req.query.limit === undefined
          ? DEFAULT_RUN_LIMIT
          : parseRunLimitParam(req.query.limit);
      res.json(await github.listRunsForWorkflow(workflowId, limit));
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
      const includeOrchestration = req.query.orchestration !== '0';
      const owner = typeof req.query.owner === 'string' ? req.query.owner : undefined;
      const repo = typeof req.query.repo === 'string' ? req.query.repo : undefined;
      if ((owner && !repo) || (!owner && repo)) {
        res.status(400).json({ error: 'Both owner and repo are required when overriding repo' });
        return;
      }
      res.json(await github.getWorkflowRun(id, { includeOrchestration, owner, repo }));
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/orchestration/health', async (_req, res, next) => {
    try {
      res.json(await github.getOrchestrationHealth());
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
