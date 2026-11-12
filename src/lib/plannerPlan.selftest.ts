/**
 * Run: npx --yes tsx src/lib/plannerPlan.selftest.ts
 */
import assert from 'node:assert/strict';
import type { PlannerPlan, PlannerStep } from '../types';
import { continuePastFailedStep, pickHealStep, retryFailedStep } from './plannerPlan';

function step(partial: Partial<PlannerStep> & Pick<PlannerStep, 'id' | 'title' | 'status'>): PlannerStep {
  return { tasks: [], ...partial };
}

function plan(partial: Partial<PlannerPlan> = {}): PlannerPlan {
  return {
    id: 'p',
    summary: 'demo',
    status: 'active',
    updatedAt: 1,
    activeStepId: '1',
    healAttempts: 3,
    steps: [
      step({ id: '1', title: 'Core', status: 'in_progress' }),
      step({ id: '2', title: 'UI', status: 'pending' })
    ],
    ...partial
  };
}

const moved = continuePastFailedStep(plan(), '1', 'TS2322 still failing');
assert.equal(moved.healAttempts, 3);
assert.equal(moved.steps.find(s => s.id === '1')?.healExhausted, true);
assert.equal(moved.steps.find(s => s.id === '1')?.status, 'failed');
assert.equal(moved.activeStepId, '2');
assert.equal(pickHealStep(moved)?.id, '2');
assert.notEqual(pickHealStep(moved)?.id, '1');

const only = continuePastFailedStep(
  plan({
    steps: [step({ id: '1', title: 'Core', status: 'in_progress' })]
  }),
  '1',
  'still broken'
);
assert.equal(only.healAttempts, 3);
assert.equal(only.activeStepId, null);
assert.equal(only.steps[0]?.healExhausted, true);
assert.equal(pickHealStep(only), undefined);

const retried = retryFailedStep(only, '1');
assert.equal(retried.healAttempts, 0);
assert.equal(retried.steps[0]?.healExhausted, false);
assert.equal(retried.steps[0]?.status, 'in_progress');
assert.equal(pickHealStep(retried)?.id, '1');

console.log('plannerPlan.selftest ok');
