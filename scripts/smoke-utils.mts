import assert from 'node:assert/strict';
import { parsePrNumbersFromReleaseNotes, parseRepoArg, computeTimingStats } from '../src/shared/utils.ts';

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

const stats = computeTimingStats([1, 2, 3, 4, 10]);
assert.equal(stats.count, 5);
assert.equal(stats.avgHours, 4);
assert.equal(stats.medianHours, 3);
assert.equal(stats.minHours, 1);
assert.equal(stats.maxHours, 10);

console.log('ok');
