import { createApp } from './app.js';
import {
  DEFAULT_RELEASE_WORKFLOW_FILE,
  normalizeReleaseWorkflowFile,
  parseRepoArg,
} from '../shared/utils.js';

const repoArg = process.env.GITHUB_REPO ?? process.argv[2] ?? 'facebook/react';
const { owner, repo } = parseRepoArg(repoArg);
const port = Number(process.env.PORT ?? 3847);
const releaseWorkflowFile = normalizeReleaseWorkflowFile(
  process.env.RELEASE_WORKFLOW ?? DEFAULT_RELEASE_WORKFLOW_FILE,
);

const app = createApp({
  owner,
  repo,
  token: process.env.GITHUB_TOKEN,
  releaseWorkflowFile,
});

app.listen(port, () => {
  console.log(
    `[dev-server] http://localhost:${port} → ${owner}/${repo} (release workflow: ${releaseWorkflowFile})`,
  );
});
