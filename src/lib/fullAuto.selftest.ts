/**
 * Run: npx --yes tsx src/lib/fullAuto.selftest.ts
 */
import assert from 'node:assert/strict';
import { mergeSettings } from '../config/defaults';
import type { PlanOption } from '../types';
import { parseStepVerdict } from './planOptions';
import {
  chooseFullAutoPlanOption,
  CODER_WRITES_FAILED_NOTE,
  fullAutoPickNotice,
  messagesFromOrigin,
  MISSING_VERDICT_NOTE,
  nayNotesFromReviewerProse,
  nayNotesFromToolErrors,
  newestReviewerMessage,
  pendingPlanChoice,
  canCoderRedispatch,
  canReaskMissingVerdict,
  pickExplicitStepVerdict,
  rememberCoderRedispatch,
  releaseCoderRedispatch,
  rememberVerdictReask,
  takeCoderRedispatch,
  takeVerdictReask,
  VERDICT_REASK_PROMPT
} from './fullAuto';

assert.equal(mergeSettings(null).fullAuto, false);
assert.equal(mergeSettings({}).fullAuto, false);
assert.equal(mergeSettings({ fullAuto: true }).fullAuto, true);
assert.equal(mergeSettings({ fullAuto: false }).fullAuto, false);

assert.equal(
  VERDICT_REASK_PROMPT,
  'Reply with ONLY a <step_verdict> block: <step_verdict><result>yay|nay</result><notes>...</notes></step_verdict>'
);

const prose = '<think>secret verdict</think> <b>Handler is missing.</b>';
assert.equal(nayNotesFromReviewerProse(prose), 'Handler is missing.');
assert.equal(nayNotesFromReviewerProse(prose).includes('secret'), false);
assert.equal(nayNotesFromReviewerProse('<step_verdict></step_verdict>'), MISSING_VERDICT_NOTE);
assert.equal(nayNotesFromReviewerProse(''), MISSING_VERDICT_NOTE);
assert.equal(nayNotesFromReviewerProse('x'.repeat(800)).length, 600);

assert.equal(nayNotesFromToolErrors([]), CODER_WRITES_FAILED_NOTE);
assert.equal(
  nayNotesFromToolErrors(['<write_file> app.ts: disk full']),
  'app.ts: disk full'
);
assert.equal(nayNotesFromToolErrors(['y'.repeat(900)]).length, 600);

const paid: PlanOption = {
  id: '1',
  title: 'Use paid API',
  description: 'Call a frontier model',
  action: 'paid'
};
const web: PlanOption = {
  id: '2',
  title: 'Page',
  description: 'Opens in a tab',
  delivery: 'web',
  action: 'run'
};
const desktop: PlanOption = {
  id: '1',
  title: 'Desktop shell',
  description: 'Installable window',
  delivery: 'electron'
};
const python: PlanOption = {
  id: '2',
  title: 'Python tool',
  description: 'A pygame window',
  delivery: 'python'
};
const retry: PlanOption = {
  id: '1',
  title: 'Retry differently',
  description: 'Another local attempt',
  action: 'retry-local'
};
const localPlan: PlanOption = {
  id: '2',
  title: 'Keep the local plan',
  description: 'Stay on this machine',
  action: 'run'
};

assert.equal(chooseFullAutoPlanOption([web], 'build a site'), null);
assert.equal(chooseFullAutoPlanOption([], 'build a site'), null);
assert.equal(
  chooseFullAutoPlanOption(
    [paid, { id: '2', title: 'Stop', description: 'Halt', action: 'stop' }],
    'build a site'
  ),
  null
);
assert.equal(chooseFullAutoPlanOption([paid, web], 'Use paid API to finish')?.id, '2');
assert.equal(chooseFullAutoPlanOption([paid, web], 'Use paid API to finish')?.action, 'run');
assert.equal(chooseFullAutoPlanOption([desktop, web], 'ship a browser toy')?.id, '2');
assert.equal(chooseFullAutoPlanOption([desktop, python], 'go with the python tool')?.id, '2');
assert.equal(
  chooseFullAutoPlanOption(
    [
      { id: '1', title: 'Alpha plan', description: 'First', action: 'run' },
      { id: '2', title: 'Beta plan', description: 'Second', action: 'run' }
    ],
    'do the thing'
  )?.id,
  '1'
);
assert.equal(chooseFullAutoPlanOption([retry, localPlan], 'retry differently')?.id, '2');
assert.equal(
  chooseFullAutoPlanOption(
    [
      { id: '1', title: 'Copy solution', description: 'Clipboard', action: 'copy' },
      { id: '2', title: 'Stop here', description: 'Done', action: 'stop' }
    ],
    'copy the solution'
  ),
  null
);
const picked = chooseFullAutoPlanOption(
  [
    { id: '1', title: 'Static site', description: 'HTML in the browser', delivery: 'web' },
    desktop
  ],
  'please build a static site'
);
assert.equal(picked?.title, 'Static site');
assert.equal(fullAutoPickNotice(picked!), 'Full auto picked option 1: Static site');

const earlier = {
  id: 'old',
  role: 'assistant',
  personaHandle: 'reviewer',
  stepVerdict: { stepId: '1', result: 'yay' as const, notes: 'old pass' }
};
const origin = {
  id: 'origin',
  role: 'assistant',
  personaHandle: 'reviewer',
  raw: 'I read the files and I am still looking.'
};
const follow = {
  id: 'follow',
  role: 'assistant',
  personaHandle: 'reviewer',
  raw: '<step_verdict step_id="2"><result>nay</result><notes>Missing handler.</notes></step_verdict>'
};
const turn = messagesFromOrigin([earlier, origin, follow], 'origin');
assert.deepEqual(
  turn.map(message => message.id),
  ['origin', 'follow']
);
assert.equal(messagesFromOrigin([earlier], 'missing').length, 0);
const fromFollowUp = pickExplicitStepVerdict(turn);
assert.equal(fromFollowUp?.message.id, 'follow');
assert.equal(fromFollowUp?.parsed.result, 'nay');
assert.equal(fromFollowUp?.parsed.stepId, '2');
assert.match(fromFollowUp?.parsed.notes || '', /Missing handler/);

const storedFirst = pickExplicitStepVerdict([
  { ...origin, stepVerdict: { stepId: '2', result: 'yay', notes: 'Looks good.' } },
  { id: 'chatter', role: 'assistant', personaHandle: 'reviewer', raw: 'Still reading the tree.' }
]);
assert.equal(storedFirst?.message.id, 'origin');
assert.equal(storedFirst?.parsed.result, 'yay');

const newerStored = pickExplicitStepVerdict([
  { ...origin, stepVerdict: { stepId: '2', result: 'yay', notes: 'Looks good.' } },
  {
    id: 'follow2',
    role: 'assistant',
    personaHandle: 'reviewer',
    stepVerdict: { stepId: '2', result: 'nay', notes: 'Stub left behind.' }
  }
]);
assert.equal(newerStored?.parsed.result, 'nay');
assert.equal(newerStored?.message.id, 'follow2');

const proseOnly = [
  { id: 'p', role: 'assistant', personaHandle: 'reviewer', raw: 'Looks good to me. Ship it.' }
];
assert.equal(pickExplicitStepVerdict(proseOnly), null);
assert.equal(parseStepVerdict(proseOnly[0].raw, { allowMissing: true }).result, 'missing');
assert.equal(newestReviewerMessage(proseOnly)?.id, 'p');
assert.equal(
  newestReviewerMessage([{ id: 'u', role: 'user', raw: 'hi' }, ...proseOnly])?.id,
  'p'
);

const planOrigin = {
  id: 'plan',
  role: 'assistant',
  planOptions: [desktop, web]
};
const followUp = { id: 'tools', role: 'assistant', raw: 'read src/main.ts' };
assert.equal(pendingPlanChoice([planOrigin, followUp], 'plan')?.id, 'plan');
assert.equal(
  pendingPlanChoice([{ ...planOrigin, selectedPlanOptionId: '1' }, followUp], 'plan'),
  null
);
assert.equal(pendingPlanChoice([planOrigin], undefined), null);
const laterCard = {
  id: 'later',
  role: 'assistant',
  planOptions: [desktop, python]
};
assert.equal(pendingPlanChoice([planOrigin, laterCard], 'plan')?.id, 'later');

const gate = takeCoderRedispatch(null, '2');
assert.equal(gate.allowed, true);
assert.equal(takeCoderRedispatch(gate.gate, '2').allowed, false);
const asked = takeVerdictReask(gate.gate, '2');
assert.equal(asked.allowed, true);
assert.equal(asked.gate.coderRedispatched, true);
const secondAsk = takeVerdictReask(asked.gate, '2');
assert.equal(secondAsk.allowed, false);
const nextStep = takeCoderRedispatch(secondAsk.gate, '3');
assert.equal(nextStep.allowed, true);
assert.equal(nextStep.gate.verdictReasked, false);
assert.equal(nextStep.gate.coderRedispatched, true);

assert.equal(canReaskMissingVerdict(null, '2'), true);
assert.equal(canReaskMissingVerdict(rememberVerdictReask(null, '2'), '2'), false);
assert.equal(canReaskMissingVerdict(rememberVerdictReask(null, '2'), '3'), true);

const exampleThenReal = {
  id: 'both',
  role: 'assistant',
  personaHandle: 'reviewer',
  raw:
    '<step_verdict step_id="1"><result>yay</result><notes>Example.</notes></step_verdict>\n' +
    '<step_verdict step_id="4"><result>nay</result><notes>Real miss.</notes></step_verdict>',
  stepVerdict: { stepId: '1', result: 'yay' as const, notes: 'Example.' }
};
const forStep4 = pickExplicitStepVerdict([exampleThenReal], '4');
assert.equal(forStep4?.parsed.result, 'nay');
assert.equal(forStep4?.parsed.stepId, '4');
assert.match(forStep4?.parsed.notes || '', /Real miss/);
assert.equal(pickExplicitStepVerdict([exampleThenReal], '9'), null);
assert.equal(pickExplicitStepVerdict([exampleThenReal], '1'), null);

const blankId = {
  id: 'blank',
  role: 'assistant',
  personaHandle: 'reviewer',
  raw: '<step_verdict><result>yay</result><notes>Tasks are in the files.</notes></step_verdict>'
};
const forced = pickExplicitStepVerdict([blankId], '3');
assert.equal(forced?.parsed.result, 'yay');
assert.equal(forced?.parsed.stepId, '3');

const storedMismatch = {
  id: 'stored',
  role: 'assistant',
  personaHandle: 'reviewer',
  raw: 'No tag here, just prose.',
  stepVerdict: { stepId: '1', result: 'yay' as const, notes: 'Wrong step.' }
};
assert.equal(pickExplicitStepVerdict([storedMismatch], '2'), null);
assert.equal(pickExplicitStepVerdict([storedMismatch], '1')?.parsed.result, 'yay');

const wrongStep = {
  id: 'wrong',
  role: 'assistant',
  personaHandle: 'reviewer',
  raw:
    '<step_verdict step_id="1"><result>yay</result><notes>Example.</notes></step_verdict>' +
    '<step_verdict step_id="99"><result>nay</result><notes>Other step.</notes></step_verdict>'
};
assert.equal(pickExplicitStepVerdict([wrongStep], '4'), null);

const trailing = {
  id: 'trail',
  role: 'assistant',
  personaHandle: 'reviewer',
  raw:
    '<step_verdict step_id="4"><result>yay</result><notes>Example.</notes></step_verdict>\n' +
    '<step_verdict step_id="4"><result>nay</result><notes>Real.</notes>'
};
assert.equal(pickExplicitStepVerdict([trailing], '4')?.parsed.result, 'nay');
assert.match(pickExplicitStepVerdict([trailing], '4')?.parsed.notes || '', /Real/);

const unclosedOnly = {
  id: 'open',
  role: 'assistant',
  personaHandle: 'reviewer',
  raw: '<step_verdict step_id="4"><result>nay</result><notes>Open.</notes>'
};
assert.equal(pickExplicitStepVerdict([unclosedOnly], '4')?.parsed.result, 'nay');

const blankStep = {
  id: 'blank-step',
  role: 'assistant',
  personaHandle: 'reviewer',
  raw: '<step_verdict><result>yay</result><notes>ok</notes></step_verdict>'
};
assert.equal(pickExplicitStepVerdict([blankStep], '4')?.parsed.result, 'yay');
assert.equal(pickExplicitStepVerdict([blankStep], '4')?.parsed.stepId, '4');

assert.equal(canCoderRedispatch(null, '2'), true);
const spent = rememberCoderRedispatch(null, '2');
assert.equal(canCoderRedispatch(spent, '2'), false);
assert.equal(canCoderRedispatch(spent, '3'), true);

// B-64: a spent re-dispatch is returned only to the step that spent it.
const spentOnTwo = takeCoderRedispatch(null, '2');
assert.equal(canCoderRedispatch(spentOnTwo.gate, '2'), false);
const released = releaseCoderRedispatch(spentOnTwo.gate, '2');
assert.equal(canCoderRedispatch(released, '2'), true);
const stepThreeGate = takeVerdictReask(spentOnTwo.gate, '3').gate;
assert.equal(stepThreeGate.stepId, '3');
assert.equal(releaseCoderRedispatch(stepThreeGate, '2'), stepThreeGate);
assert.equal(stepThreeGate.verdictReasked, true);
assert.equal(releaseCoderRedispatch(null, '2'), null);

console.log('fullAuto.selftest ok');
