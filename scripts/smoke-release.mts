import { GitHubService } from '../src/server/github/service.ts';

async function main() {
  const g = new GitHubService({ owner: 'expressjs', repo: 'express' });
  const releases = await g.listReleases();
  const withPrs = releases.find((r) => r.associatedPrCount > 0);
  if (!withPrs) {
    console.log('no releases with PRs found');
    return;
  }
  console.log('sample', withPrs.tagName, withPrs.associatedPrNumbers);
  const detail = await g.getRelease(withPrs.id);
  console.log(
    'detail prs',
    detail.associatedPrs.slice(0, 3).map((p) => `#${p.number} ${p.title ?? ''}`),
  );
  console.log('timing hours since previous', detail.timeSincePreviousHours);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
