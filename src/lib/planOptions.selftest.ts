/**
 * Run: npx --yes tsx src/lib/planOptions.selftest.ts
 */
import assert from 'node:assert/strict';
import { parseReviewDelta, parseStepVerdict } from './planOptions';

const prose = 'Looks good to me. No bugs. Ship it.';
assert.equal(parseStepVerdict(prose), null);
const missing = parseStepVerdict(prose, { allowMissing: true });
assert.equal(missing.result, 'missing');
assert.notEqual(missing.result, 'yay');

const yay = parseStepVerdict(
  '<step_verdict step_id="2"><result>yay</result><notes>Tasks are in the files.</notes></step_verdict>'
);
assert.equal(yay?.result, 'yay');
assert.equal(yay?.stepId, '2');

const nay = parseStepVerdict(
  '<step_verdict step_id="2"><result>nay</result><notes>src/app.ts is missing the handler.</notes></step_verdict>',
  { allowMissing: true }
);
assert.equal(nay.result, 'nay');
assert.equal(nay.stepId, '2');

const emptyTag = parseStepVerdict('<step_verdict step_id="4"></step_verdict>', { allowMissing: true });
assert.equal(emptyTag.result, 'missing');
assert.equal(emptyTag.stepId, '4');
assert.equal(parseStepVerdict('<step_verdict step_id="4"></step_verdict>'), null);

// B-46: negated verdicts are nay / failed, and any nay word beats yay
const stepResult = (r: string) =>
  parseStepVerdict('<step_verdict step_id="1"><result>' + r + '</result></step_verdict>')?.result;
for (const r of ['do not approve', 'not ok', 'no good', "don't approve", 'nay', 'approved but wrong']) {
  assert.equal(stepResult(r), 'nay', r);
}
for (const r of ['yay', 'approve', 'ok', 'approved']) {
  assert.equal(stepResult(r), 'yay', r);
}
const deltaVerdict = (v: string, notes = 'x') =>
  parseReviewDelta(
    '<review_delta task_id="1"><verdict>' + v + '</verdict><notes>' + notes + '</notes></review_delta>'
  )?.verdict;
assert.equal(deltaVerdict('not done', 'still broken'), 'failed');
assert.equal(deltaVerdict('failed'), 'failed');
assert.equal(deltaVerdict('done'), 'completed');
assert.equal(deltaVerdict('completed'), 'completed');

console.log('planOptions.selftest ok');
