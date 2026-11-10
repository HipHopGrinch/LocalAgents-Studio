/**
 * Run: npx --yes tsx src/lib/cursorClass.selftest.ts
 */
import assert from 'node:assert/strict';
import { continuePastFailedStep } from './plannerPlan';
import { emptyProjectBrain, formatProjectBrainForPrompt } from './projectBrain';
import { extractSymbols, formatRepoMap, symbolHitsForQuery, type RepoMap } from './repoMap';
import { isDestructiveCommand } from './agentLoop';
import type { PlannerPlan } from '../types';

const symbols = extractSymbols(
  'src/App.tsx',
  'export function App() { return null }\nexport const Board = 1\nfunction helper() {}\n'
);
assert.ok(symbols.some(s => s.name === 'App' && s.file === 'src/App.tsx'));
assert.ok(symbols.some(s => s.name === 'Board'));

const map: RepoMap = {
  files: ['src/App.tsx', 'src/game/Board.tsx', 'package.json'],
  symbols: [
    { file: 'src/App.tsx', name: 'App' },
    { file: 'src/game/Board.tsx', name: 'Board' }
  ],
  builtAt: 1
};
const tight = formatRepoMap(map, 'tight', 'wire App.tsx to the board');
assert.match(tight, /src\/App\.tsx/);
assert.match(tight, /App/);
assert.doesNotMatch(tight, /package\.json/);
const wide = formatRepoMap(map, 'wide', '');
assert.match(wide, /package\.json/);
assert.match(wide, /Board/);
const hits = symbolHitsForQuery(map, 'Board');
assert.match(hits, /SYMBOL HITS/);
assert.match(hits, /src\/game\/Board\.tsx/);

const plan: PlannerPlan = {
  id: 'p',
  summary: 'demo',
  status: 'active',
  updatedAt: 1,
  blockedReason: 'would duplicate work',
  healAttempts: 3,
  activeStepId: '3',
  steps: [
    { id: '3', title: 'logic', status: 'in_progress', tasks: [] },
    { id: '4', title: 'ui', status: 'pending', tasks: [] },
    { id: '5', title: 'wire', status: 'pending', tasks: [] }
  ]
};
const next = continuePastFailedStep(plan, '3', 'TS2488 iterator');
assert.equal(next.blockedReason, undefined);
assert.equal(next.status, 'active');
assert.equal(next.activeStepId, '4');
assert.equal(next.steps.find(s => s.id === '3')?.status, 'failed');
assert.match(next.steps.find(s => s.id === '3')?.reviewNote || '', /TS2488/);
assert.equal(next.steps.find(s => s.id === '4')?.status, 'in_progress');
assert.equal(next.healAttempts, 0);

const last = continuePastFailedStep(
  { ...plan, steps: [{ id: '5', title: 'wire', status: 'in_progress', tasks: [] }] },
  '5',
  'still broken'
);
assert.equal(last.status, 'completed');
assert.equal(last.blockedReason, undefined);

const brain = emptyProjectBrain();
const rules = 'never add a second Board component. ' + 'x'.repeat(8000);
const tightRules = formatProjectBrainForPrompt(brain, rules, 4000);
const wideRules = formatProjectBrainForPrompt(brain, rules, 16000);
assert.ok(tightRules.includes('never add a second Board component'));
assert.ok(wideRules.length > tightRules.length);
assert.ok(wideRules.includes('never add a second Board component'));

assert.equal(isDestructiveCommand('git push --force origin main'), true);
assert.equal(isDestructiveCommand('git push origin main'), false);
assert.equal(isDestructiveCommand('git commit -m "ok"'), false);
assert.equal(isDestructiveCommand('Remove-Item -Force -Recurse ./tmp'), true);
assert.equal(isDestructiveCommand('git reset --hard'), true);
assert.equal(isDestructiveCommand('del /q /s junk'), true);

console.log('cursorClass.selftest ok');
