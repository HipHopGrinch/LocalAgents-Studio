/**
 * Run: npx --yes tsx src/lib/workLog.selftest.ts
 */
import assert from 'node:assert/strict';
import {
  avoidRepeat,
  emptyWorkLog,
  fileNamesIn,
  noteSavedFiles,
  noteUserTurn,
  parseWorkLog,
  renderWorkLog,
  stickyBugCleared
} from './workLog';

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

// B-82: longest extension first, with an end boundary
// F-08: the shared matcher (also used by continuationReview) keeps the full extension
assert.deepEqual(fileNamesIn('fix App.tsx and package.json'), ['app.tsx', 'package.json']);
assert.notDeepEqual(fileNamesIn('App.tsx'), ['app.ts']);
assert.notDeepEqual(fileNamesIn('package.json'), ['package.js']);
assert.equal(stickyBugCleared('fix the toggle in App.tsx', ['src/App.tsx']), true);
assert.equal(stickyBugCleared('fix package.json deps', ['package.json']), true);
assert.equal(stickyBugCleared('fix main.cpp crash', ['src/main.cpp']), true);
const sameBase = avoidRepeat(
  { ...emptyWorkLog(), done: ['Wrote src/App.tsx'] },
  'continue',
  'fix the types in src/app.ts',
  []
);
assert.equal(sameBase.decision, 'continue');

// B-86: the "(none yet)" placeholder is not a request
assert.equal(parseWorkLog(renderWorkLog(emptyWorkLog())).request, '');
assert.equal(
  noteUserTurn(parseWorkLog(renderWorkLog(emptyWorkLog())), 'Build a checkers game').request,
  'Build a checkers game'
);

// B-87: user text that mentions HTTP/1.1 is recorded
const httpTurn = noteUserTurn(emptyWorkLog(), 'The client sends HTTP/1.1 and the parser drops the body');
assert.match(httpTurn.request, /HTTP\/1\.1/);

console.log('workLog.selftest ok');
