#!/usr/bin/env node
import { Command } from 'commander';
import open from 'open';
import { createApp } from './server/app.js';
import {
  DEFAULT_RELEASE_WORKFLOW_FILE,
  normalizeReleaseWorkflowFile,
  parseRepoArg,
} from './shared/utils.js';

const program = new Command();

program
  .name('github-dash')
  .description('Local GitHub dashboard for a repository — PRs, commits, releases, and workflow metrics')
  .argument('<repo>', 'GitHub repository as owner/repo (or full github.com URL)')
  .option('-p, --port <port>', 'HTTP port', '3847')
  .option('-t, --token <token>', 'GitHub token (defaults to GITHUB_TOKEN env)')
  .option(
    '-r, --release-workflow <file>',
    'Actions workflow file that creates releases (defaults to RELEASE_WORKFLOW env or release.yml)',
    process.env.RELEASE_WORKFLOW ?? DEFAULT_RELEASE_WORKFLOW_FILE,
  )
  .option('--no-open', 'Do not open the browser automatically')
  .option('--host <host>', 'Bind host', '127.0.0.1')
  .action(
    async (
      repoArg: string,
      opts: { port: string; token?: string; open: boolean; host: string; releaseWorkflow: string },
    ) => {
    let owner: string;
    let repo: string;
    try {
      ({ owner, repo } = parseRepoArg(repoArg));
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
      return;
    }

    const port = Number(opts.port);
    if (!Number.isFinite(port) || port <= 0) {
      console.error('Invalid port');
      process.exitCode = 1;
      return;
    }

    const token = opts.token ?? process.env.GITHUB_TOKEN;
    if (!token) {
      console.warn(
        'Warning: no GitHub token set. Unauthenticated requests are heavily rate-limited. Set GITHUB_TOKEN or pass --token.',
      );
    }

    const releaseWorkflowFile = normalizeReleaseWorkflowFile(opts.releaseWorkflow);
    const app = createApp({ owner, repo, token, releaseWorkflowFile });
    const server = app.listen(port, opts.host, async () => {
      const url = `http://${opts.host === '0.0.0.0' ? '127.0.0.1' : opts.host}:${port}`;
      console.log(`GitHub Dash → ${owner}/${repo}`);
      console.log(`Release workflow → ${releaseWorkflowFile}`);
      console.log(`Listening on ${url}`);
      if (opts.open) {
        try {
          await open(url);
        } catch {
          // ignore browser open failures
        }
      }
    });

    const shutdown = () => {
      server.close(() => process.exit(0));
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
