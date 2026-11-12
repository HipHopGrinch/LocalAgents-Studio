/**
 * Run: npx --yes tsx src/lib/continuationReview.selftest.ts
 */
import assert from 'node:assert/strict';
import {
  CONTINUATION_REVIEW_SYSTEM,
  buildContinuationReviewPrompt,
  formatPreloadedTouchedFiles
} from './continuationReview';

assert.doesNotMatch(CONTINUATION_REVIEW_SYSTEM, /<read_file/);
assert.doesNotMatch(CONTINUATION_REVIEW_SYSTEM, /<list_dir/);
assert.doesNotMatch(CONTINUATION_REVIEW_SYSTEM, /<search /);
assert.match(CONTINUATION_REVIEW_SYSTEM, /<next_step>/);
assert.match(CONTINUATION_REVIEW_SYSTEM, /Do not call read/);

const formatted = formatPreloadedTouchedFiles(
  [
    { path: 'src/a.ts', content: `export const A = 1;\n${'a'.repeat(20000)}` },
    { path: 'src/b.ts', content: 'export const B = 2;\n' }
  ],
  'tight'
);
assert.match(formatted, /src\/a.ts/);
assert.match(formatted, /export const A/);
assert.match(formatted, /truncated/);
assert.ok(formatted.length < 14000);

const prompt = buildContinuationReviewPrompt({
  approvedPlanText: 'Ship the board',
  recentTranscript: 'User: the click handler is missing',
  workspaceOverview: 'src/',
  workLog: 'Done: drew the grid',
  writtenPaths: ['src/a.ts'],
  preloadedFiles: [{ path: 'src/a.ts', content: 'export const A = 1;\n' }]
});
assert.match(prompt, /export const A = 1/);
assert.match(prompt, /do not call read_file/i);
assert.doesNotMatch(prompt, /read these, then patch/);
assert.match(prompt, /Ship the board/);

const bare = buildContinuationReviewPrompt({
  recentTranscript: 'User: hi',
  workspaceOverview: '',
  writtenPaths: ['src/a.ts']
});
assert.match(bare, /src\/a.ts/);
assert.match(bare, /do not call tools/i);
assert.doesNotMatch(bare, /<read_file/);

console.log('continuationReview.selftest ok');
