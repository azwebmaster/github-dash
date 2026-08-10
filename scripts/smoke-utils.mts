import assert from 'node:assert/strict';
import {
  ageLookbackCutoffIso,
  ageLookbackCutoffMs,
  DEFAULT_AGE_LOOKBACK_DAYS,
  DEFAULT_RELEASE_WORKFLOW_FILE,
  DEFAULT_RUN_LIMIT,
  matchReleaseCreatingRun,
  normalizeReleaseWorkflowFile,
  parsePrNumbersFromReleaseNotes,
  parseRepoArg,
  parseAgeLookbackParam,
  parseRunLimitParam,
  computeTimingStats,
  isWithinAgeLookback,
  rollupCheckState,
  runLimitForAgeLookback,
} from '../src/shared/utils.ts';
import { MemoryCache } from '../src/server/cache/memory.ts';

const notes = `
## What's Changed
* Feature A by @alice in https://github.com/acme/app/pull/42
* Fix bug (#99)
* Pull Request 101: docs
* Also see PR #7
`;

assert.deepEqual(parsePrNumbersFromReleaseNotes(notes), [7, 42, 99, 101]);
assert.deepEqual(parsePrNumbersFromReleaseNotes(null), []);
assert.deepEqual(parseRepoArg('acme/app'), { owner: 'acme', repo: 'app' });
assert.deepEqual(parseRepoArg('https://github.com/acme/app.git'), { owner: 'acme', repo: 'app' });

assert.equal(normalizeReleaseWorkflowFile(undefined), DEFAULT_RELEASE_WORKFLOW_FILE);
assert.equal(normalizeReleaseWorkflowFile('.github/workflows/release.yml'), 'release.yml');
assert.equal(normalizeReleaseWorkflowFile('workflows/publish.yaml'), 'publish.yaml');
{
  const runs = [
    {
      branch: 'v1.0.0',
      headSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-01T10:05:00.000Z',
      status: 'completed',
      conclusion: 'failure',
    },
    {
      branch: 'v1.0.0',
      headSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      createdAt: '2026-08-01T11:00:00.000Z',
      updatedAt: '2026-08-01T11:04:00.000Z',
      status: 'completed',
      conclusion: 'success',
    },
    {
      branch: 'main',
      headSha: '10af19edfaeab1d81d15c66477752b4fda8339d4',
      createdAt: '2026-08-06T00:33:52.000Z',
      updatedAt: '2026-08-06T03:08:48.000Z',
      status: 'completed',
      conclusion: 'success',
    },
  ];
  const matched = matchReleaseCreatingRun('v1.0.0', '2026-08-01T11:05:00.000Z', runs);
  assert.equal(matched?.conclusion, 'success');
  assert.equal(matched?.createdAt, '2026-08-01T11:00:00.000Z');
  assert.equal(matchReleaseCreatingRun('v9.9.9', '2026-08-01T11:05:00.000Z', runs), null);

  const bySha = matchReleaseCreatingRun(
    'v2026.08.06.1',
    '2026-08-06T03:08:42.000Z',
    runs,
    '10af19edfaeab1d81d15c66477752b4fda8339d4',
  );
  assert.equal(bySha?.branch, 'main');
  assert.equal(bySha?.headSha, '10af19edfaeab1d81d15c66477752b4fda8339d4');
}

const stats = computeTimingStats([1, 2, 3, 4, 10]);
assert.equal(stats.count, 5);
assert.equal(stats.avgHours, 4);
assert.equal(stats.medianHours, 3);
assert.equal(stats.minHours, 1);
assert.equal(stats.maxHours, 10);

assert.equal(rollupCheckState([]), 'neutral');
assert.equal(rollupCheckState([{ status: 'in_progress', conclusion: null }]), 'pending');
assert.equal(
  rollupCheckState([
    { status: 'completed', conclusion: 'success' },
    { status: 'completed', conclusion: 'failure' },
  ]),
  'failure',
);
assert.equal(
  rollupCheckState([
    { status: 'completed', conclusion: 'success' },
    { status: 'completed', conclusion: 'skipped' },
  ]),
  'success',
);
assert.equal(rollupCheckState([{ status: 'completed', conclusion: 'cancelled' }]), 'neutral');

const now = Date.parse('2026-08-07T12:00:00.000Z');
assert.equal(ageLookbackCutoffMs(7, now), now - 7 * 24 * 60 * 60 * 1000);
assert.equal(ageLookbackCutoffIso(7, now), new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString());
assert.equal(isWithinAgeLookback('2026-08-06T00:00:00.000Z', 7, now), true);
assert.equal(isWithinAgeLookback('2026-07-01T00:00:00.000Z', 7, now), false);
assert.equal(parseAgeLookbackParam('all'), DEFAULT_AGE_LOOKBACK_DAYS);
assert.equal(parseAgeLookbackParam('30'), 30);
assert.equal(parseRunLimitParam('100'), 100);
assert.equal(parseRunLimitParam('999'), DEFAULT_RUN_LIMIT);
assert.equal(runLimitForAgeLookback(7), 100);
assert.equal(runLimitForAgeLookback(90), 500);

{
  const { mapGraphqlWorkflowRun } = await import('../src/server/github/workflow-runs-graphql.ts');
  const mapped = mapGraphqlWorkflowRun(42, 'CI', {
    databaseId: 99,
    runNumber: 7,
    runAttempt: 1,
    event: 'push',
    url: 'https://github.com/acme/app/actions/runs/99',
    createdAt: '2026-08-07T10:00:00.000Z',
    updatedAt: '2026-08-07T10:05:00.000Z',
    checkSuite: {
      status: 'COMPLETED',
      conclusion: 'SUCCESS',
      branch: { name: 'main' },
    },
  });
  assert.equal(mapped?.id, 99);
  assert.equal(mapped?.workflowId, 42);
  assert.equal(mapped?.conclusion, 'success');
  assert.equal(mapped?.status, 'completed');
  assert.equal(mapped?.branch, 'main');
  assert.equal(mapped?.headSha, '');
  assert.equal(mapped?.durationSeconds, 300);
}

const cache = new MemoryCache({ defaultTtlMs: 50 });
await cache.set('k', { n: 1 });
assert.deepEqual(await cache.get('k'), { n: 1 });
await new Promise((r) => setTimeout(r, 60));
assert.equal(await cache.get('k'), undefined);

{
  const { DEFAULT_CACHE_TTL_MS, resolveCacheTtlMs } = await import('../src/server/cache/index.ts');
  assert.equal(DEFAULT_CACHE_TTL_MS, 300_000);
  assert.equal(resolveCacheTtlMs({}), 300_000);
  assert.equal(resolveCacheTtlMs({ CACHE_TTL_MS: '120000' }), 120_000);
}

{
  const {
    extractWorkflowTriggers,
    lanesForTriggers,
  } = await import('../src/server/github/workflow-triggers.ts');

  assert.deepEqual(
    extractWorkflowTriggers(`
name: Merge Queue
on:
  pull_request:
  merge_group:
    branches: [main]
jobs: {}
`),
    { events: ['pull_request', 'merge_group'], hasPathFilters: false },
  );

  assert.deepEqual(
    extractWorkflowTriggers(`
on:
  pull_request:
    paths:
      - 'app/**'
  push:
    branches: [main]
`),
    { events: ['pull_request', 'push'], hasPathFilters: true },
  );

  assert.deepEqual(extractWorkflowTriggers('on: [push, pull_request]\n'), {
    events: ['push', 'pull_request'],
    hasPathFilters: false,
  });

  assert.deepEqual(lanesForTriggers(['merge_group', 'pull_request'], 'Merge Queue'), [
    'pull_request',
    'merge_queue',
  ]);
  assert.deepEqual(lanesForTriggers(['workflow_dispatch'], 'Promote Artifact'), [
    'release',
    'manual',
  ]);
}

console.log('ok');
