/**
 * Run: npx --yes tsx src/lib/conductor.selftest.ts
 */
import assert from 'node:assert/strict';
import type { PlannerPlan, PlannerStep } from '../types';
import {
  appendPlannerPlan,
  canHealAdvanceOnGreenVerify,
  markPlanFinalReview,
  pickNextPendingStep,
  planHasDebt,
  planReadyForRelease,
  activateNextStep,
  stepLooksLikeFixStep,
  writePlannerPlan
} from './plannerPlan';
import {
  createConductorSession,
  decideConductorEnter,
  leftFailedNotice,
  MAX_LOGIC_HEAL_ROUNDS,
  MAX_REVIEW_FIX_ROUNDS,
  reopenActiveStepForRework,
  reviewFixesOwnTheTurn,
  reviewFixKey,
  takeReviewFixRound,
  transition
} from './conductor';

function step(partial: Partial<PlannerStep> & Pick<PlannerStep, 'id' | 'title' | 'status'>): PlannerStep {
  return { tasks: [], ...partial };
}

function demo(partial: Partial<PlannerPlan> = {}): PlannerPlan {
  return {
    id: 'p',
    summary: 'demo',
    status: 'active',
    updatedAt: 1,
    activeStepId: '1',
    resumePhase: 'coder',
    steps: [
      step({ id: '1', title: 'Core', status: 'in_progress' }),
      step({ id: '2', title: 'UI', status: 'pending' })
    ],
    ...partial
  };
}

assert.equal(stepLooksLikeFixStep('Fix the layout'), false);
assert.equal(stepLooksLikeFixStep('Rework the board'), false);
assert.equal(stepLooksLikeFixStep('Repair the rendering'), false);
assert.equal(stepLooksLikeFixStep('Fix: layout'), true);
assert.equal(stepLooksLikeFixStep('Fix: Fix: tsc in App.tsx'), true);
assert.equal(stepLooksLikeFixStep('Repair tsc errors in App.tsx'), true);
assert.equal(stepLooksLikeFixStep('Heal compiler errors'), true);
assert.equal(stepLooksLikeFixStep('Fix verify failure in index.ts'), true);

const logic = transition(demo(), {
  type: 'VERDICT',
  stepId: '1',
  result: 'nay',
  notes: 'The button does not toggle.'
});
assert.equal(logic.effect, 'verdict-nay');
assert.equal(logic.plan.steps[0].status, 'failed');
assert.equal(logic.plan.steps[0].blockerKind, 'review');
assert.equal(canHealAdvanceOnGreenVerify(logic.plan, '1'), false);
const held = transition(logic.plan, { type: 'VERIFY', ok: true, fingerprint: 'none', stepId: '1' });
assert.equal(held.effect, 'verify-held');
assert.equal(held.plan.steps.find(s => s.id === '1')?.status, 'failed');
assert.notEqual(held.plan.resumePhase, 'final-review');

const titled = demo({
  steps: [
    step({ id: '1', title: 'Fix: layout', status: 'failed', blockerKind: 'review' }),
    step({ id: '2', title: 'UI', status: 'pending' })
  ]
});
assert.equal(canHealAdvanceOnGreenVerify(titled, '1'), false);
assert.equal(
  transition(titled, { type: 'VERIFY', ok: true, fingerprint: 'e1_1', stepId: '1' }).effect,
  'verify-held'
);

const compiler = transition(demo(), {
  type: 'VERDICT',
  stepId: '1',
  result: 'nay',
  notes: 'Verify failed — error TS2322 in src/App.tsx'
});
assert.equal(compiler.plan.steps[0].blockerKind, 'compiler');
assert.equal(canHealAdvanceOnGreenVerify(compiler.plan, '1'), true);
const advanced = transition(compiler.plan, {
  type: 'VERIFY',
  ok: true,
  fingerprint: 'eok_0',
  stepId: '1',
  note: 'tsc clean'
});
assert.equal(advanced.effect, 'verify-advanced');
assert.equal(advanced.plan.steps.find(s => s.title === 'Core')?.status, 'completed');
assert.equal(advanced.plan.steps.find(s => s.title === 'UI')?.status, 'in_progress');
assert.equal(advanced.plan.resumePhase, 'coder');
assert.notEqual(pickNextPendingStep(advanced.plan)?.status, 'failed');

const onlyCompiler = transition(
  demo({
    steps: [step({ id: '1', title: 'Core', status: 'failed', blockerKind: 'compiler' })],
    activeStepId: '1'
  }),
  { type: 'VERIFY', ok: true, fingerprint: 'none', stepId: '1' }
);
assert.equal(onlyCompiler.effect, 'verify-advanced');
assert.equal(onlyCompiler.plan.resumePhase, 'final-review');
assert.equal(planReadyForRelease(onlyCompiler.plan), true);

const failedFirst = demo({
  activeStepId: '1',
  steps: [
    step({ id: '1', title: 'Core', status: 'failed' }),
    step({ id: '2', title: 'UI', status: 'pending' }),
    step({ id: '3', title: 'Wire', status: 'pending' })
  ]
});
assert.equal(pickNextPendingStep(failedFirst)?.id, '2');
assert.notEqual(pickNextPendingStep(failedFirst)?.status, 'failed');
const moved = activateNextStep(failedFirst);
assert.equal(moved.activeStepId, '2');
assert.equal(moved.steps[0].status, 'failed');
assert.equal(moved.steps[1].status, 'in_progress');
const retried = transition(moved, { type: 'RETRY_STEP', stepId: '1' });
assert.equal(retried.effect, 'retried');
assert.equal(retried.plan.steps[0].status, 'in_progress');
assert.equal(retried.plan.steps[1].status, 'pending');
assert.equal(retried.plan.activeStepId, '1');
assert.equal(retried.plan.resumePhase, 'coder');
assert.equal(pickNextPendingStep(retried.plan)?.id, '2');
assert.equal(transition(demo(), { type: 'RETRY_STEP', stepId: '2' }).effect, 'noop');

const exhausted = transition(failedFirst, {
  type: 'HEAL_EXHAUSTED',
  stepId: '1',
  note: 'Heal budget used'
});
assert.equal(exhausted.effect, 'heal-deferred');
assert.equal(exhausted.plan.steps[0].status, 'failed');
assert.equal(exhausted.plan.activeStepId, '2');
assert.equal(pickNextPendingStep(exhausted.plan)?.id, '3');

const debtOnly = activateNextStep(
  demo({
    steps: [step({ id: '1', title: 'Core', status: 'failed' })],
    activeStepId: '1'
  })
);
assert.equal(debtOnly.status, 'active');
assert.equal(debtOnly.activeStepId, null);
assert.equal(planHasDebt(debtOnly), true);
assert.equal(planReadyForRelease(debtOnly), false);

const prior = demo({
  steps: [
    step({ id: '1', title: 'Still open', status: 'pending' }),
    step({ id: '2', title: 'Halfway', status: 'in_progress' }),
    step({ id: '3', title: 'Done already', status: 'completed' }),
    step({ id: '4', title: 'Broke', status: 'failed' })
  ]
});
const incoming = demo({
  id: 'p2',
  summary: 'next lock',
  steps: [
    step({ id: '1', title: 'New A', status: 'pending' }),
    step({ id: '2', title: 'New B', status: 'pending' })
  ]
});
const appended = appendPlannerPlan(prior, incoming);
assert.equal(appended.steps.find(s => s.title === 'Still open')?.status, 'abandoned');
assert.equal(appended.steps.find(s => s.title === 'Halfway')?.status, 'abandoned');
assert.equal(appended.steps.find(s => s.title === 'Done already')?.status, 'completed');
assert.equal(appended.steps.find(s => s.title === 'Broke')?.status, 'failed');
assert.equal(appended.steps.find(s => s.title === 'New A')?.status, 'in_progress');
assert.equal(planHasDebt(appended), true);
assert.equal(planReadyForRelease(appended), false);
assert.equal(markPlanFinalReview(appended), appended);
assert.notEqual(appended.resumePhase, 'final-review');

const clean = demo({
  status: 'active',
  activeStepId: null,
  steps: [
    step({ id: '1', title: 'Core', status: 'completed' }),
    step({ id: '2', title: 'UI', status: 'completed' })
  ]
});
assert.equal(planHasDebt(clean), false);
assert.equal(planReadyForRelease(clean), true);
const shipped = markPlanFinalReview(clean);
assert.equal(shipped.resumePhase, 'final-review');
assert.equal(shipped.status, 'completed');

const skipped = transition(demo(), { type: 'SKIP_STEP', stepId: '1', note: 'not now' });
assert.equal(skipped.effect, 'skipped');
assert.equal(skipped.plan.steps.find(s => s.title === 'Core')?.status, 'abandoned');
assert.equal(skipped.plan.steps.find(s => s.title === 'UI')?.status, 'in_progress');
assert.equal(planReadyForRelease(skipped.plan), false);

const withTask = demo({
  steps: [
    step({
      id: '1',
      title: 'Core',
      status: 'in_progress',
      tasks: [{ id: '1a', title: 'old', description: 'd', status: 'pending' }]
    })
  ]
});
const edited = transition(withTask, {
  type: 'EDIT_STEP_TASK',
  stepId: '1',
  taskId: '1a',
  title: 'renamed',
  file: 'src/a.ts'
});
assert.equal(edited.effect, 'edited');
assert.equal(edited.plan.steps[0].tasks[0].title, 'renamed');
assert.equal(edited.plan.steps[0].tasks[0].file, 'src/a.ts');
assert.equal(edited.plan.steps[0].status, 'in_progress');

const coded = transition(withTask, { type: 'CODER_DONE', stepId: '1' });
assert.equal(coded.effect, 'coder-to-review');
assert.equal(coded.plan.resumePhase, 'review');
assert.equal(coded.plan.steps[0].tasks[0].status, 'pending');
assert.notEqual(coded.plan.steps[0].status, 'completed');

const missing = transition(demo(), { type: 'VERDICT', result: 'missing', notes: '' });
assert.equal(missing.effect, 'verdict-missing');
assert.equal(missing.plan.resumePhase, 'verdict');
assert.equal(missing.plan.steps[0].status, 'in_progress');

const phase = demo({ resumePhase: 'review' });
const stopped = transition(phase, { type: 'STOP' });
assert.equal(stopped.paused, true);
assert.equal(stopped.effect, 'stopped');
assert.equal(stopped.plan.resumePhase, 'review');
assert.equal(transition(stopped.plan, { type: 'RESUME' }).paused, false);

const failedVerify = transition(demo(), {
  type: 'VERIFY',
  ok: false,
  fingerprint: 'ebad_1',
  stepId: '1'
});
assert.equal(failedVerify.effect, 'verify-failed');
assert.equal(failedVerify.plan.steps[0].blockerKind, 'compiler');
assert.equal(failedVerify.plan.lastErrorFingerprint, 'ebad_1');
assert.equal(failedVerify.plan.lastVerifyOk, false);
const reviewHeld = transition(logic.plan, { type: 'VERIFY', ok: false, fingerprint: 'ebad_2', stepId: '1' });
assert.equal(reviewHeld.effect, 'verify-failed');
assert.equal(reviewHeld.plan.steps[0].blockerKind, 'review');

let writes = 0;
void writePlannerPlan('D:/ws', 'conv 1', demo(), async (abs, content) => {
  writes += 1;
  assert.match(abs, /\.localagents[\\/]plans[\\/]/);
  assert.match(content, /"summary": "demo"/);
}).then(saved => {
  assert.equal(writes, 1);
  assert.ok(saved.updatedAt >= 1);
  console.log('conductor.selftest ok');
}).catch(err => {
  console.error(err);
  process.exit(1);
});

const session = createConductorSession();
const firstSignal = session.signal;
const token = session.begin();
assert.equal(firstSignal.aborted, true);
assert.equal(session.isCurrent(token), true);
assert.equal(session.signal.aborted, false);
assert.equal(session.tryLock(), true);
assert.equal(session.tryLock(), false);
const order: string[] = [];
session.registerAbort(() => order.push('a'));
session.registerAbort(() => {
  order.push('b');
  throw new Error('listener failed');
});
session.registerAbort(() => order.push('c'));
const live = session.signal;
session.stop();
assert.deepEqual(order, ['a', 'b', 'c']);
assert.equal(session.isCurrent(token), false);
assert.equal(live.aborted, true);
assert.equal(session.tryLock(), true);
session.unlock();
session.stop();
assert.deepEqual(order, ['a', 'b', 'c']);
const nextToken = session.begin();
assert.notEqual(nextToken, token);
assert.equal(session.isCurrent(nextToken), true);
assert.equal(session.isCurrent(token), false);
assert.equal(session.signal.aborted, false);

const raced = createConductorSession();
assert.equal(raced.tryLock(), true);
const stale = raced.begin();
raced.stop();
assert.equal(raced.releaseIfCurrent(stale), false);
assert.equal(raced.tryLock(), true);
const fresh = raced.begin();
assert.equal(raced.holdsLock(), true);
assert.equal(raced.releaseIfCurrent(stale), false);
assert.equal(raced.tryLock(), false);
assert.equal(raced.releaseIfCurrent(fresh), true);
assert.equal(raced.holdsLock(), false);
assert.equal(raced.tryLock(), true);
raced.unlock();

assert.deepEqual(
  decideConductorEnter({
    stopLatched: true,
    clearStop: false,
    parentToken: null,
    parentCurrent: false,
    heldToken: 2,
    heldCurrent: true,
    locked: false
  }),
  { action: 'refuse' }
);
assert.deepEqual(
  decideConductorEnter({
    stopLatched: true,
    clearStop: true,
    parentToken: null,
    parentCurrent: false,
    heldToken: null,
    heldCurrent: false,
    locked: false
  }),
  { action: 'begin' }
);
assert.deepEqual(
  decideConductorEnter({
    stopLatched: false,
    clearStop: false,
    parentToken: 4,
    parentCurrent: false,
    heldToken: 9,
    heldCurrent: true,
    locked: true
  }),
  { action: 'refuse' }
);
assert.deepEqual(
  decideConductorEnter({
    stopLatched: false,
    clearStop: false,
    parentToken: 4,
    parentCurrent: true,
    heldToken: 9,
    heldCurrent: true,
    locked: true
  }),
  { action: 'join', token: 4 }
);
assert.deepEqual(
  decideConductorEnter({
    stopLatched: false,
    clearStop: false,
    parentToken: null,
    parentCurrent: false,
    heldToken: 9,
    heldCurrent: true,
    locked: true
  }),
  { action: 'join', token: 9 }
);
assert.deepEqual(
  decideConductorEnter({
    stopLatched: false,
    clearStop: true,
    parentToken: null,
    parentCurrent: false,
    heldToken: 9,
    heldCurrent: true,
    locked: true
  }),
  { action: 'refuse' }
);

// A Reviewer Nay must rework the SAME step, not skip to the next one.
const nayed = transition(demo(), {
  type: 'VERDICT',
  stepId: '1',
  result: 'nay',
  notes: 'The button does not toggle.'
}).plan;
assert.equal(nayed.steps[0].status, 'failed');
assert.equal(nayed.activeStepId, '1');
// What dispatchActiveStep did before the fix: the failed active step is skipped.
assert.equal(activateNextStep(nayed).activeStepId, '2');
const reworked = reopenActiveStepForRework({ ...nayed, healAttempts: 2 });
assert.equal(reworked.activeStepId, '1');
assert.equal(reworked.steps[0].status, 'in_progress');
assert.equal(reworked.steps[1].status, 'pending');
assert.equal(reworked.steps[0].reworkCount, 1);
assert.equal(reworked.steps[0].reviewNote, 'The button does not toggle.');
assert.equal(reworked.healAttempts, 2);
// After the reopen, activateNextStep keeps the step in progress.
assert.equal(activateNextStep(reworked).activeStepId, '1');
// Nothing to reopen: unchanged plan, same reference.
const inProgressPlan = demo();
assert.equal(reopenActiveStepForRework(inProgressPlan), inProgressPlan);
// A step past its heal budget is debt: it is not reopened.
const spent = demo({
  steps: [
    step({ id: '1', title: 'Core', status: 'failed', healExhausted: true }),
    step({ id: '2', title: 'UI', status: 'pending' })
  ]
});
assert.equal(reopenActiveStepForRework(spent), spent);
const abandonedPlan = demo({
  steps: [
    step({ id: '1', title: 'Core', status: 'abandoned' }),
    step({ id: '2', title: 'UI', status: 'pending' })
  ]
});
assert.equal(reopenActiveStepForRework(abandonedPlan), abandonedPlan);
assert.match(leftFailedNotice('1', '2', 'UI'), /left FAILED/);
assert.match(leftFailedNotice('1', '2', 'UI'), /step #2: UI/);
assert.doesNotMatch(leftFailedNotice('1', '2', 'UI'), /logic/);
assert.match(leftFailedNotice('1', '2', 'UI', { logicIssue: true }), /logic issue/);
assert.match(leftFailedNotice('1', '2', 'UI', { logicIssue: true }), /step #2: UI/);
assert.equal(MAX_LOGIC_HEAL_ROUNDS, 2);

// Review-fix loop cap: three Coder rounds per task, then capped without drifting.
const fixKey = reviewFixKey('1', ' Fix  the Board ');
assert.equal(fixKey, reviewFixKey('1', 'fix the board'));
assert.notEqual(fixKey, reviewFixKey('2', 'fix the board'));
let fixRounds: Record<string, number> = {};
for (let i = 1; i <= MAX_REVIEW_FIX_ROUNDS; i += 1) {
  const taken = takeReviewFixRound(fixRounds, fixKey);
  assert.equal(taken.capped, false);
  assert.equal(taken.round, i);
  fixRounds = taken.rounds;
}
const overCap = takeReviewFixRound(fixRounds, fixKey);
assert.equal(overCap.capped, true);
assert.equal(overCap.rounds, fixRounds);
assert.equal(takeReviewFixRound(fixRounds, reviewFixKey('9', 'other')).capped, false);
// An escalation resets one task to cap-1: exactly one more round, then capped again.
const afterEscalation = { ...fixRounds, [fixKey]: MAX_REVIEW_FIX_ROUNDS - 1 };
const lastRound = takeReviewFixRound(afterEscalation, fixKey);
assert.equal(lastRound.capped, false);
assert.equal(takeReviewFixRound(lastRound.rounds, fixKey).capped, true);

// Open review-fix tasks outrank the mirrored review-fixes plan.
assert.equal(reviewFixesOwnTheTurn({ openTasks: true, activeStepId: 'review-fixes' }), true);
assert.equal(reviewFixesOwnTheTurn({ openTasks: true, planId: 'plan-review-abc' }), true);
assert.equal(reviewFixesOwnTheTurn({ openTasks: false, activeStepId: 'review-fixes' }), false);
assert.equal(reviewFixesOwnTheTurn({ openTasks: true, activeStepId: '3', planId: 'plan-1' }), false);

console.log('conductor.selftest ok');