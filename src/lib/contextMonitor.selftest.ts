/**
 * Run: npx --yes tsx src/lib/contextMonitor.selftest.ts
 */
import assert from 'node:assert/strict';
import {
  contextWasExhausted,
  estimatePromptTokens,
  fitPromptToContext,
  outputCapWasHit,
  promptFillsContext,
  shrinkUserPacket
} from './contextMonitor';
import { estimateTextTokens } from './contextSize';

function fence(lines: string[], lang = ''): string {
  return `\`\`\`${lang}\n${lines.join('\n')}\n\`\`\``;
}

function swarmPacket(): string {
  const current = Array.from({ length: 150 }, (_, i) =>
    i === 0 ? 'SMALL_HEAD' : i === 100 ? 'SMALL_MIDDLE' : i === 149 ? 'SMALL_TAIL' : `s${i}`
  );
  const contract = [
    'export type Marker = string;',
    ...Array.from({ length: 20 }, () => 'export type Pad = number;'),
    'export type CONTRACT_SECRET = string;',
    ...Array.from({ length: 20 }, () => 'export type Pad2 = number;')
  ];
  return [
    '### MODEL FIT',
    'Tier: tight.',
    '',
    'REPO MAP (tight — relevant files):',
    'REPO_MAP_SECRET',
    ...Array.from({ length: 2500 }, () => 'src/noise.ts'),
    '',
    'You are an autonomous GPU Worker in a distributed Conductor Swarm.',
    '### DEVELOPMENT HOST',
    'Workspace files, package installs, and run_command execute on the Dev PC.',
    '### STRICT TYPESCRIPT CONTRACT',
    '1. Import shared types as specified.',
    fence(contract, 'typescript'),
    '4. Do NOT redefine types from the contract file.',
    '',
    '### SIBLING / PREREQUISITE CONTEXT',
    '## Already written (do not rewrite)',
    '### src/prev.ts (already written)',
    fence(['SIBLING_SECRET', 'export const prev = 1;']),
    '## This wave',
    '- src/app.ts (wave 1): implement run',
    '',
    '### CURRENT FILE CONTENT',
    fence(current),
    '',
    '### TASK INSTRUCTIONS',
    'Implement TASK_SECRET in run() and do not drop this section.',
    '',
    '### OVERALL REQUEST (brief — do not paste this into the file)',
    'USER_REQUEST_SECRET build the swarm worker file.',
    '',
    'Output the complete file using:',
    '<write_file path="src/app.ts">',
    '...complete source...',
    '</write_file>'
  ].join('\n');
}

function plannerPacket(): string {
  const pad = 'y'.repeat(80);
  const active = Array.from({ length: 250 }, (_, i) =>
    i === 0 ? `ACTIVE_HEAD ${pad}` : i === 125 ? `ACTIVE_MIDDLE ${pad}` : i === 249 ? `ACTIVE_TAIL ${pad}` : `c${i} ${pad}`
  );
  return [
    '### MODEL FIT',
    'Tier: tight.',
    '',
    'REPO MAP:',
    'REPO_MAP_SECRET',
    ...Array.from({ length: 2000 }, () => 'noise/file.ts'),
    '',
    '[Active File: src/App.tsx]',
    fence(active, 'typescript'),
    '',
    'User Task / Request:',
    'PLANNER_USER_SECRET please wire the board and keep this sentence.',
    '',
    '[PLANNER DIRECTIVE: Analyze intent, propose a concrete plan, and end with 2–4 options in a <plan_options> block. Do NOT write deliverable files yet.]'
  ].join('\n');
}

function assertSurvives(label: string, text: string) {
  assert.match(text, /CONTRACT_SECRET/, `${label} dropped the contract`);
  assert.match(text, /TASK_SECRET/, `${label} dropped task instructions`);
  assert.match(text, /USER_REQUEST_SECRET/, `${label} dropped the user request`);
  assert.doesNotMatch(text, /REPO_MAP_SECRET/, `${label} kept the repo map`);
  assert.doesNotMatch(text, /SIBLING_SECRET/, `${label} kept a sibling body`);
  assert.match(text, /SMALL_HEAD/);
  assert.match(text, /SMALL_TAIL/);
  assert.doesNotMatch(text, /SMALL_MIDDLE/, `${label} kept the middle of the current file`);
}

function liveSwarmPacket(): string {
  const current = Array.from({ length: 150 }, (_, i) =>
    i === 0 ? 'NEW_HEAD' : i === 100 ? 'NEW_MIDDLE' : i === 149 ? 'NEW_TAIL' : `n${i}`
  );
  return [
    '### MODEL FIT',
    'Tier: tight.',
    '',
    'REPO MAP (tight — relevant files):',
    'REPO_MAP_SECRET',
    ...Array.from({ length: 800 }, () => 'src/noise.ts'),
    '',
    'Implement ONLY `src/app.ts` (stack: typescript).',
    '### CONTRACT (`src/types/swarm-contract.ts`) — read-only',
    'Imports:',
    '- import type { Run } from "./types/swarm-contract"',
    '```typescript',
    'export type CONTRACT_SECRET = string;',
    'export function run(): void;',
    '```',
    'Do not redefine types from the contract file.',
    '',
    '### CURRENT FILE',
    ...current,
    '',
    '### SIBLINGS (path + exports)',
    '- src/prev.ts — exports: prev',
    '## Already written (do not rewrite)',
    '### src/prev.ts (already written)',
    fence(['SIBLING_SECRET', 'export const prev = 1;']),
    '## This wave',
    '- src/app.ts (wave 1): implement run',
    '',
    '### DIRECT DEPENDENCIES',
    '#### src/dep.ts',
    fence(['DEPENDENCY_SECRET']),
    '',
    '### BRIEF',
    'USER_REQUEST_SECRET build the swarm worker file.',
    '',
    '### TASK',
    'Implement TASK_SECRET in run() and do not drop this section.'
  ].join('\n');
}

const live = shrinkUserPacket(liveSwarmPacket(), 2);
assert.match(live, /CONTRACT_SECRET/);
assert.match(live, /TASK_SECRET/);
assert.match(live, /USER_REQUEST_SECRET/);
assert.match(live, /NEW_HEAD/);
assert.match(live, /NEW_TAIL/);
assert.match(live, /exports: prev/);
assert.doesNotMatch(live, /REPO_MAP_SECRET/);
assert.doesNotMatch(live, /SIBLING_SECRET/);
assert.doesNotMatch(live, /DEPENDENCY_SECRET/);
assert.doesNotMatch(live, /NEW_MIDDLE/);
const liveFit = fitPromptToContext({
  system: 'worker stub',
  userContent: liveSwarmPacket(),
  history: [],
  maxCtx: 2048
});
assert.match(liveFit.userContent, /CONTRACT_SECRET/);
assert.match(liveFit.userContent, /TASK_SECRET/);
assert.match(liveFit.userContent, /USER_REQUEST_SECRET/);
assert.doesNotMatch(liveFit.userContent, /NEW_MIDDLE/);
assert.doesNotMatch(liveFit.userContent, /SIBLING_SECRET/);

const swarm = swarmPacket();
assertSurvives('shrink', shrinkUserPacket(swarm, 2));
const swarmFit = fitPromptToContext({
  system: 'worker system',
  userContent: swarm,
  history: [
    { role: 'user', content: 'old' },
    { role: 'assistant', content: 'older' }
  ],
  maxCtx: 4096
});
assert.ok(swarmFit.shrinks > 0);
assertSurvives('fit', swarmFit.userContent);

const planner = plannerPacket();
const plannerShrunk = shrinkUserPacket(planner, 2);
assert.match(plannerShrunk, /PLANNER_USER_SECRET/);
assert.match(plannerShrunk, /\[PLANNER DIRECTIVE/);
assert.doesNotMatch(plannerShrunk, /REPO_MAP_SECRET/);
assert.doesNotMatch(plannerShrunk, /ACTIVE_MIDDLE/);
const plannerFit = fitPromptToContext({
  system: 'planner system',
  userContent: planner,
  history: [],
  maxCtx: 8192
});
assert.match(plannerFit.userContent, /PLANNER_USER_SECRET/);
assert.match(plannerFit.userContent, /\[PLANNER DIRECTIVE/);
assert.doesNotMatch(plannerFit.userContent, /ACTIVE_MIDDLE/);

const exec = `REPO MAP\n${'f.ts\n'.repeat(5000)}\n[EXECUTION DIRECTIVE: change only src/a.ts and keep EXEC_SECRET]\n`;
const execShrunk = shrinkUserPacket(exec, 2);
assert.match(execShrunk, /EXEC_SECRET/);
assert.match(execShrunk, /\[EXECUTION DIRECTIVE/);
assert.doesNotMatch(execShrunk, /f\.ts\nf\.ts/);

const review = `REPO MAP\n${'g.ts\n'.repeat(3000)}\nUser Task / Request:\nREVIEW_USER keep me\n\n[REVIEWER DIRECTIVE: Report findings and end with a review_plan. REVIEW_DIRECTIVE_SECRET]`;
const reviewShrunk = shrinkUserPacket(review, 2);
assert.match(reviewShrunk, /REVIEW_USER/);
assert.match(reviewShrunk, /REVIEW_DIRECTIVE_SECRET/);
assert.match(reviewShrunk, /\[REVIEWER DIRECTIVE/);

const shared = `### SHARED NOTES (\`notes.md\`) — read-only context\nSHARED_CONTRACT_SECRET\n### TASK INSTRUCTIONS\nDo the thing.`;
assert.match(shrinkUserPacket(`${'REPO MAP\n' + 'z.ts\n'.repeat(1000)}\n${shared}`, 2), /SHARED_CONTRACT_SECRET/);

const budgetFit = fitPromptToContext({
  system: '',
  userContent: `REPO MAP\n${'z\n'.repeat(8000)}\nUser Task / Request:\nBUDGET_TASK`,
  history: [],
  maxCtx: 32000,
  promptBudget: 400
});
assert.match(budgetFit.userContent, /BUDGET_TASK/);
assert.ok(budgetFit.shrinks > 0);
assert.doesNotMatch(budgetFit.userContent, /z\nz\nz/);

const imageFit = fitPromptToContext({
  system: 's',
  userContent: 'User Task / Request:\nIMAGE_TASK keep me',
  history: [{ role: 'user', content: 'earlier question', images: ['img-history'] }],
  images: ['img-a', 'img-b'],
  maxCtx: 2048
});
assert.match(imageFit.userContent, /IMAGE_TASK/);
assert.equal(imageFit.images?.length || 0, 0);
assert.ok((imageFit.droppedImages || 0) >= 2);
assert.equal(imageFit.history.length, 0);

const frontier = fitPromptToContext({
  system: 's',
  userContent: 'User Task / Request:\nkeep',
  history: [{ role: 'user', content: 'h' }],
  images: ['only'],
  maxCtx: 1024,
  frontier: true
});
assert.equal(frontier.shrinks, 0);
assert.deepEqual(frontier.images, ['only']);

assert.equal(contextWasExhausted({ doneReason: 'length', evalCount: 10 }, 32768, 8192), true);
assert.equal(
  contextWasExhausted({ promptEvalCount: 7000, evalCount: 1100, doneReason: 'stop' }, 32768, 8192),
  true
);
assert.equal(
  contextWasExhausted({ promptEvalCount: 7000, evalCount: 1100, doneReason: 'stop' }, 32768),
  false
);
assert.equal(
  contextWasExhausted({ promptEvalCount: 2000, evalCount: 500, doneReason: 'stop' }, 32768, 8192),
  false
);
assert.equal(
  contextWasExhausted({ promptEvalCount: 3000, evalCount: 5000, doneReason: 'stop' }, 32768, 8192),
  false
);
assert.equal(contextWasExhausted({ doneReason: 'length', evalCount: 10 }, 16384), true);
assert.equal(contextWasExhausted({ promptEvalCount: 15000, evalCount: 10 }, 16384), true);
assert.equal(contextWasExhausted({ promptEvalCount: 1000, evalCount: 400, doneReason: 'stop' }, 16384), false);

// Real log: coder stopped at its 6144 output cap with a 928-token prompt in a 16K window.
const capStop = { promptEvalCount: 928, evalCount: 6144, doneReason: 'length' };
assert.equal(contextWasExhausted(capStop, 16384, 16384), false);
assert.equal(outputCapWasHit(capStop, 16384), true);
assert.equal(outputCapWasHit(capStop, 16384, 6144), true);
assert.equal(outputCapWasHit(capStop, 16384, 8192), false);
// length with a nearly full window is still context exhaustion
const fullStop = { promptEvalCount: 12000, evalCount: 3000, doneReason: 'length' };
assert.equal(contextWasExhausted(fullStop, 16384, 16384), true);
assert.equal(outputCapWasHit(fullStop, 16384), false);
const bigPrompt = { promptEvalCount: 14500, evalCount: 40, doneReason: 'length' };
assert.equal(contextWasExhausted(bigPrompt, 16384, 16384), true);
assert.equal(outputCapWasHit(bigPrompt, 16384), false);
assert.equal(contextWasExhausted({ doneReason: 'context', evalCount: 5 }, 16384), true);
// no prompt count: can't prove the window had room
assert.equal(outputCapWasHit({ doneReason: 'length', evalCount: 6144 }, 16384), false);
assert.equal(outputCapWasHit({ promptEvalCount: 900, evalCount: 300, doneReason: 'stop' }, 16384), false);
assert.equal(outputCapWasHit(undefined, 16384), false);

const fat = `REPO MAP\n${'file.ts\n'.repeat(4000)}\n## Task\n${'x'.repeat(20000)}`;
const fatShrunk = shrinkUserPacket(fat, 2);
assert.ok(fatShrunk.length < fat.length);
assert.match(fatShrunk, /Context monitor/);
const fatFit = fitPromptToContext({
  system: 'sys',
  userContent: fat,
  history: [
    { role: 'user', content: 'a'.repeat(8000) },
    { role: 'assistant', content: 'b'.repeat(8000) }
  ],
  maxCtx: 4096
});
assert.ok(fatFit.shrinks > 0);
assert.equal(fatFit.history.length, 0);
assert.equal(promptFillsContext(100, 4096), false);
assert.equal(estimatePromptTokens(['aaaa']), estimateTextTokens('aaaa'));

const stepBehindFile = `${'### src/big.ts\n' + 'FILE_BODY_SECRET '.repeat(4000)}\n## PLANNER STEP (implement now — this step only)\nPlan: KEEP_STEP_SECRET\n### Tasks\n- TASK_SECRET do the thing\n### Reviewer Nay notes (fix these)\nNAY_SECRET\n`;
const stepShrunk = shrinkUserPacket(stepBehindFile, 2);
assert.match(stepShrunk, /KEEP_STEP_SECRET/);
assert.match(stepShrunk, /TASK_SECRET/);
assert.match(stepShrunk, /NAY_SECRET/);
const stepAt = stepShrunk.indexOf('KEEP_STEP_SECRET');
const fileAt = stepShrunk.indexOf('FILE_BODY_SECRET');
assert.ok(stepAt >= 0);
assert.ok(fileAt === -1 || stepAt < fileAt);

// B-51: a "#### file.ext" heading inside the user request is an instruction, not a written-file body
const userRequestPacket =
  '### USER REQUEST\nBuild the game\n\n#### notes.md\nKeep the score in the corner and do not remove the collision code.';
assert.match(
  shrinkUserPacket(userRequestPacket, 1, { cap: false }),
  /do not remove the collision code/
);
const writtenPacket = '## Already written\n#### a.ts\nconst ALREADY_ON_DISK = 1;\n';
assert.doesNotMatch(shrinkUserPacket(writtenPacket, 1, { cap: false }), /ALREADY_ON_DISK/);

console.log('contextMonitor.selftest ok');
