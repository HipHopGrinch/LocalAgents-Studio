/**
 * Run: npx --yes tsx src/lib/reviewTurn.selftest.ts
 */
import assert from 'node:assert/strict';
import type { ToolCall } from '../types';
import { fitBudgetForPinnedCtx } from './contextSize';
import {
  MISSING_REVIEW_VERDICT_NOTICE,
  MISSING_REVIEW_VERDICT_WAIT_NOTICE,
  REVIEW_FOLLOWUP_MAX_TOOL_CHARS,
  REVIEW_PRELOAD_CHARS_PER_TOKEN,
  REVIEW_PRELOAD_FILE_SHARE,
  REVIEW_PRELOAD_MAX_CHARS_PER_FILE,
  REVIEW_PRELOAD_MAX_TOTAL_CHARS,
  REVIEW_VERDICT_NOW_INSTRUCTION,
  boundReviewContinuation,
  hasStructuredReviewResult,
  isStaleCompilerNay,
  nayCitesCompilerErrors,
  needsReviewVerdictTurn,
  nonPlanReviewLacksMarkup,
  reviewFollowUpBudget,
  reviewPreloadCaps,
  reviewVerdictNowInstruction,
  staleNayReaskPrompt,
  verifyPassedStatement
} from './reviewTurn';

const readTool = {
  id: 'r1',
  name: 'read_file',
  args: { path: 'src/Board3D.tsx' },
  status: 'done',
  result: 'export function Board() { return null; }'
} as ToolCall;

const base = {
  reviewMode: true,
  tools: [readTool],
  raw: '<read_file path="src/Board3D.tsx"></read_file>',
  readOnlyContinues: 1,
  maxReadOnlyContinues: 1
};

assert.equal(
  REVIEW_VERDICT_NOW_INSTRUCTION,
  'You have used your file reads. Do not call any tools. Reply now with your <review_plan> (or <review_delta task_id=...>) based on what you have.'
);
assert.equal(reviewVerdictNowInstruction(), REVIEW_VERDICT_NOW_INSTRUCTION);
assert.match(reviewVerdictNowInstruction({ stepVerdictMode: true }), /<step_verdict/);
assert.doesNotMatch(reviewVerdictNowInstruction({ stepVerdictMode: true }), /<review_plan>/);
assert.match(reviewVerdictNowInstruction({ finalSourceReview: true }), /<final_review>/);
assert.doesNotMatch(reviewVerdictNowInstruction({ finalSourceReview: true }), /<review_plan>/);
assert.equal(MISSING_REVIEW_VERDICT_NOTICE, 'Reviewer gave no verdict — continuing');
assert.equal(
  MISSING_REVIEW_VERDICT_WAIT_NOTICE,
  'Reviewer gave no verdict — click Looks good / Continue'
);

assert.equal(needsReviewVerdictTurn(base), true);
assert.equal(needsReviewVerdictTurn({ ...base, readOnlyContinues: 0 }), false);
assert.equal(needsReviewVerdictTurn({ ...base, reviewMode: false }), false);
assert.equal(
  needsReviewVerdictTurn({
    ...base,
    tools: [
      {
        id: 'w1',
        name: 'write_file',
        args: { path: 'src/App.tsx' },
        status: 'done',
        result: 'wrote'
      } as ToolCall
    ]
  }),
  false
);
assert.equal(
  needsReviewVerdictTurn({
    ...base,
    tools: [
      {
        id: 't1',
        name: 'read_terminal',
        args: {},
        status: 'done',
        result: 'ok'
      } as ToolCall
    ]
  }),
  false
);

const cleanPlan = '<review_plan><summary>No issues.</summary></review_plan>';
assert.equal(nonPlanReviewLacksMarkup(cleanPlan), false);
assert.equal(hasStructuredReviewResult(cleanPlan), true);
assert.equal(needsReviewVerdictTurn({ ...base, raw: cleanPlan }), false);

const delta = '<review_delta task_id="2"><verdict>completed</verdict><notes>Wired.</notes></review_delta>';
assert.equal(nonPlanReviewLacksMarkup(delta), false);
assert.equal(needsReviewVerdictTurn({ ...base, raw: delta }), false);

assert.equal(nonPlanReviewLacksMarkup(base.raw), true);
assert.equal(nonPlanReviewLacksMarkup('<think><review_plan><summary>x</summary></review_plan></think>'), true);

const unclosedPlan =
  '<review_plan><summary>Missing handler.</summary><task id="1">Wire the click.</task>';
assert.equal(nonPlanReviewLacksMarkup(unclosedPlan), false);
assert.equal(hasStructuredReviewResult(unclosedPlan), true);
const unclosedDelta = '<review_delta task_id="2"><verdict>failed</verdict><notes>Broken wiring.</notes>';
assert.equal(nonPlanReviewLacksMarkup(unclosedDelta), false);
assert.equal(hasStructuredReviewResult(unclosedDelta), true);

const stepTag =
  '<step_verdict step_id="4"><result>nay</result><notes>Handler is missing.</notes></step_verdict>';
assert.equal(
  needsReviewVerdictTurn({
    ...base,
    stepVerdictMode: true,
    raw: stepTag,
    activeStepId: '4'
  }),
  false
);
assert.equal(
  needsReviewVerdictTurn({
    ...base,
    stepVerdictMode: true,
    raw: stepTag,
    activeStepId: '9'
  }),
  true
);
assert.equal(
  needsReviewVerdictTurn({
    ...base,
    stepVerdictMode: true,
    raw: cleanPlan,
    activeStepId: '4'
  }),
  true
);
assert.equal(
  needsReviewVerdictTurn({
    ...base,
    stepVerdictMode: true,
    raw: '<think><step_verdict><result>yay</result><notes>hidden</notes></step_verdict></think>',
    activeStepId: '4'
  }),
  true
);

const finalTag = '<final_review><result>pass</result><notes>Page shows the board.</notes></final_review>';
assert.equal(hasStructuredReviewResult(finalTag, { finalSourceReview: true }), true);
assert.equal(hasStructuredReviewResult(cleanPlan, { finalSourceReview: true }), false);
assert.equal(hasStructuredReviewResult(delta, { finalSourceReview: true }), false);
assert.equal(
  needsReviewVerdictTurn({ ...base, finalSourceReview: true, raw: finalTag }),
  false
);
assert.equal(
  needsReviewVerdictTurn({ ...base, finalSourceReview: true, raw: cleanPlan }),
  true
);
assert.equal(needsReviewVerdictTurn({ ...base, finalSourceReview: true, raw: base.raw }), true);

function fileShareChars(pinnedCtx: number): number {
  const fit = fitBudgetForPinnedCtx({ pinnedCtx, role: 'reviewer' });
  const tokens = Math.max(1, Math.floor(fit.promptBudget * REVIEW_PRELOAD_FILE_SHARE));
  return Math.max(1, Math.floor(tokens * REVIEW_PRELOAD_CHARS_PER_TOKEN));
}

const tiny = reviewPreloadCaps(4096);
assert.equal(tiny.maxTotalChars, 3152);
assert.equal(tiny.maxCharsPerFile, 1050);
assert.ok(tiny.maxTotalChars <= fileShareChars(4096));

const small = reviewPreloadCaps(8192);
assert.equal(small.maxFiles, 8);
assert.equal(small.maxTotalChars, 10361);
assert.equal(small.maxCharsPerFile, 5000);
assert.ok(small.maxTotalChars <= fileShareChars(8192));
assert.ok(small.maxTotalChars < 20000);

const local = reviewPreloadCaps(16384);
assert.equal(local.maxTotalChars, 24780);
assert.equal(local.maxCharsPerFile, 8260);
assert.ok(local.maxCharsPerFile >= 5568);
assert.ok(local.maxTotalChars >= 5568 + 5446);
assert.ok(local.maxTotalChars > small.maxTotalChars);

const wide = reviewPreloadCaps(32768);
assert.equal(wide.maxTotalChars, REVIEW_PRELOAD_MAX_TOTAL_CHARS);
assert.equal(wide.maxCharsPerFile, REVIEW_PRELOAD_MAX_CHARS_PER_FILE);

const frontier = reviewPreloadCaps(262144);
assert.equal(frontier.maxTotalChars, REVIEW_PRELOAD_MAX_TOTAL_CHARS);
assert.equal(frontier.maxCharsPerFile, REVIEW_PRELOAD_MAX_CHARS_PER_FILE);

const tightFiles = reviewPreloadCaps(16384, 4);
assert.equal(tightFiles.maxFiles, 4);
assert.equal(tightFiles.maxCharsPerFile, local.maxCharsPerFile);

// A frontier window pastes whole step files, but one follow-up stays under 400K characters.
assert.equal(reviewFollowUpBudget(262144, 'reviewer').toolChars, REVIEW_FOLLOWUP_MAX_TOOL_CHARS);
assert.equal(reviewFollowUpBudget(1048576, 'reviewer').toolChars, REVIEW_FOLLOWUP_MAX_TOOL_CHARS);
assert.ok(reviewFollowUpBudget(131072, 'reviewer').toolChars > 60000 * 3);
assert.ok(reviewFollowUpBudget(16384, 'reviewer').toolChars < 30000);

const eightBudget = reviewFollowUpBudget(8192, 'reviewer');
assert.equal(eightBudget.toolChars, fileShareChars(8192));
const fat = `${'x'.repeat(20000)}\n\nReply now with your <review_plan>.`;
const bounded = boundReviewContinuation(fat, eightBudget.toolChars);
assert.ok(bounded.length <= eightBudget.toolChars);
assert.match(bounded, /review_plan/);
assert.match(bounded, /tool results truncated/);

// Stale compiler Nay: the quoted errors came from an earlier failed verify, tsc has passed since.
const staleNotes =
  'Type mismatch between App.tsx and Board3D.tsx causing compilation errors: src/App.tsx(56,30): error TS2322: Type X is not assignable. src/components/Board3D.tsx(207,22): error TS2345: Argument of type Y.';
assert.equal(isStaleCompilerNay(staleNotes, { ok: true, output: 'Exit code: 0' }), true);
assert.equal(isStaleCompilerNay(staleNotes, { ok: true, output: '' }), true);
// Red verify, or no verify result: never stale.
assert.equal(
  isStaleCompilerNay(staleNotes, { ok: false, output: 'src/App.tsx(56,30): error TS2322: Type X.' }),
  false
);
assert.equal(isStaleCompilerNay(staleNotes, null), false);
// A Nay with no compiler errors is a real review finding.
assert.equal(
  isStaleCompilerNay('Board3D is a stub: the click handler does nothing.', { ok: true, output: '' }),
  false
);
// One cited pair still reported (same file and code, other line) means the Nay is not stale.
assert.equal(
  isStaleCompilerNay(staleNotes, {
    ok: true,
    output: 'D:/proj/src/components/Board3D.tsx(210,3): error TS2345: Argument of type Y.'
  }),
  false
);
// A different code in the same file does not match.
assert.equal(
  isStaleCompilerNay(staleNotes, { ok: true, output: 'src/App.tsx(56,30): error TS9999: other.' }),
  true
);
assert.equal(nayCitesCompilerErrors(staleNotes), true);
assert.equal(nayCitesCompilerErrors('The click handler does nothing.'), false);
assert.match(verifyPassedStatement('tsc exit 0'), /PASSED just now \(tsc exit 0\)/);
assert.match(verifyPassedStatement(), /do not Nay for them/);
assert.match(staleNayReaskPrompt(verifyPassedStatement()), /<step_verdict>/);
assert.match(staleNayReaskPrompt(verifyPassedStatement()), /Project verify: PASSED/);

console.log('reviewTurn.selftest ok');
