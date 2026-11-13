/**
 * Run: npx --yes tsx src/lib/continuationReview.selftest.ts
 */
import assert from 'node:assert/strict';
import {
  CONTINUATION_REVIEW_SYSTEM,
  buildContinuationReviewPrompt,
  formatPreloadedTouchedFiles,
  parseFinalReview,
  parseNextStep,
  taskFixesWrittenFiles
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

// B-82: App.tsx is not app.ts
assert.equal(taskFixesWrittenFiles('fix the click handler in App.tsx', ['src/App.tsx']), true);
assert.equal(taskFixesWrittenFiles('fix the click handler in app.ts', ['src/App.tsx']), false);

// B-83: a negated decision is a question, not a continue or done
const nextDecision = (d: string) =>
  parseNextStep(
    '<next_step><decision>' + d + '</decision><task>fix the board rendering now</task></next_step>'
  )?.decision;
assert.equal(nextDecision('do not continue'), 'ask');
assert.equal(nextDecision('not complete'), 'ask');
assert.equal(nextDecision('continue'), 'continue');
assert.equal(nextDecision('done'), 'done');

// B-84: "not ok" and failure words in the notes are issues
const finalResult = (result: string, notes: string) =>
  parseFinalReview('<final_review><result>' + result + '</result><notes>' + notes + '</notes></final_review>')?.result;
assert.equal(finalResult('not ok', 'The login button is broken.'), 'issues');
assert.equal(finalResult('not ok', 'Looks fine.'), 'issues');
assert.equal(finalResult('pass', 'Tests failed on startup.'), 'issues');
assert.equal(finalResult('pass', 'Matches the plan.'), 'pass');

console.log('continuationReview.selftest ok');
