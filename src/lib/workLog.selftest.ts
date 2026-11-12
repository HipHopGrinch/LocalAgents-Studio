/**
 * Run: npx --yes tsx src/lib/workLog.selftest.ts
 */
import assert from 'node:assert/strict';
import { emptyWorkLog, noteSavedFiles, stickyBugCleared } from './workLog';

const unnamed = { ...emptyWorkLog(), bug: 'spacebar is broken', next: 'fix the spacebar' };
const wroteOther = noteSavedFiles(unnamed, [
  { name: 'write_file', status: 'done', args: { path: 'src/app.ts' } }
]);
assert.equal(wroteOther.bug, 'spacebar is broken');
assert.equal(stickyBugCleared('spacebar is broken', ['src/app.ts']), false);

const named = noteSavedFiles(
  { ...emptyWorkLog(), bug: 'fix src/app.ts toggle' },
  [{ name: 'edit_file', status: 'done', args: { path: 'src/app.ts' } }]
);
assert.equal(named.bug, '');

const wrongFile = noteSavedFiles(
  { ...emptyWorkLog(), bug: 'fix src/app.ts toggle' },
  [{ name: 'write_file', status: 'done', args: { path: 'src/other.ts' } }]
);
assert.equal(wrongFile.bug, 'fix src/app.ts toggle');

const fingerprint = noteSavedFiles(unnamed, [], { previous: 'eabc_2', next: 'none' });
assert.equal(fingerprint.bug, '');

const sameFingerprint = noteSavedFiles(
  unnamed,
  [{ name: 'write_file', status: 'done', args: { path: 'src/x.ts' } }],
  { previous: 'eabc_2', next: 'eabc_2' }
);
assert.equal(sameFingerprint.bug, 'spacebar is broken');

console.log('workLog.selftest ok');
