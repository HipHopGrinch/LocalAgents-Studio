/**
 * Run: npx --yes tsx src/lib/plannerPlan.selftest.ts
 */
import assert from 'node:assert/strict';
import type { PlannerPlan, PlannerStep } from '../types';
import {
  collectStepContextPaths,
  collectStepFilePaths,
  continuePastFailedStep,
  filePathsInText,
  filesImplicatedByFailure,
  reworkTargetFiles,
  pickHealStep,
  planEndMessage,
  resolveBareTaskFiles,
  resolveContextPaths,
  retryFailedStep
} from './plannerPlan';

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
// Step 2 starts with its own heal budget (the connect4 run starved step 5 of heals).
assert.equal(moved.healAttempts, 0);
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

function task(title: string, description = '', file?: string): PlannerStep['tasks'][number] {
  return { id: 't', title, description, status: 'pending', ...(file ? { file } : {}) };
}
function paths(s: Partial<PlannerStep> & { tasks: PlannerStep['tasks'] }): string[] {
  return collectStepFilePaths(step({ id: '1', title: s.title || 'Step', status: 'pending', ...s }));
}

// Real log 1: `src/App.tsx` must not also yield a bare App.tsx
assert.deepEqual(
  paths({ tasks: [task('Wire the app', 'Edit `src/App.tsx` to render the board.')] }),
  ['src/App.tsx']
);
assert.deepEqual(paths({ tasks: [task('Wire the app', 'Edit src/App.tsx to render the board.')] }), [
  'src/App.tsx'
]);
assert.deepEqual(paths({ tasks: [task('Wire the app', '(see src/App.tsx)', 'src/App.tsx')] }), ['src/App.tsx']);
// A prose bare mention of the tail of a trusted file is the same file
assert.deepEqual(paths({ tasks: [task('Update App.tsx', 'Fix App.tsx imports', 'src/App.tsx')] }), ['src/App.tsx']);
assert.deepEqual(paths({ tasks: [task('Use ./src/main.tsx', '')] }), ['src/main.tsx']);

// Real log 2: library names in prose are not files
assert.deepEqual(paths({ tasks: [task('Build a 3D game', 'A React + Three.js scene with an AI opponent.')] }), []);
for (const lib of ['Three.js', 'Node.js', 'Vue.js', 'Next.js', 'D3.js', 'Chart.js', 'Express.js', 'three.js', 'node.js']) {
  assert.deepEqual(paths({ tasks: [task('Stack', `Built with ${lib} and Vite.`)] }), [], lib);
  assert.deepEqual(paths({ tasks: [task('Stack', `Built with (${lib}), Vite.`)] }), [], `(${lib})`);
}
assert.deepEqual(paths({ tasks: [task('Stack', 'Uses `Three.js` and `Node.js`.')] }), []);
assert.deepEqual(paths({ tasks: [task('Stack', 'Uses Socket.io for chat, see https://threejs.org/docs/index.html and example.com')] }), []);
assert.deepEqual(paths({ tasks: [task('Deps', 'Install three@0.160.0, node v18.0.0, version 1.2.3, localhost:5173/app.js')] }), []);
// URL paths never leak
assert.deepEqual(paths({ tasks: [task('Docs', 'Read https://example.com/docs/guide.md first')] }), []);
// Member access in backticks is not a file
assert.deepEqual(paths({ tasks: [task('Mesh', 'Call `THREE.Mesh` and `Math.random` and `console.log`')] }), []);
// A vendored lowercase path is still a path
assert.deepEqual(paths({ tasks: [task('Vendor', 'Load `vendor/three.js` locally.')] }), ['vendor/three.js']);
assert.deepEqual(paths({ tasks: [task('Bad', 'See ../secret.ts and node_modules/x/y.js and /etc/a.js')] }), []);

// Real files keep working
assert.deepEqual(
  paths({
    tasks: [
      task('Entry', 'Create `index.html` that loads `src/main.tsx`.'),
      task('Config', 'Add vite.config.ts and package.json with scripts.'),
      task('AI', 'Write src/game/ai.ts with minimax.'),
      task('Style', 'Put the layout in styles.css.')
    ]
  }),
  ['index.html', 'src/main.tsx', 'vite.config.ts', 'package.json', 'src/game/ai.ts', 'styles.css']
);
// Case-insensitive dedupe on normalised path, task.file first
assert.deepEqual(
  paths({ tasks: [task('A', 'Edit `SRC/App.tsx` and `./src/app.tsx`', 'src/App.tsx')] }),
  ['src/App.tsx']
);
assert.deepEqual(paths({ tasks: [task('A', '', 'src\\game\\ai.ts'), task('B', 'See `src/game/ai.ts`.')] }), [
  'src/game/ai.ts'
]);
// Step-level text is scanned too
assert.deepEqual(paths({ title: 'Update `src/App.tsx`', description: 'Mention Three.js', tasks: [] }), ['src/App.tsx']);
// Trusted task.file entries are never dropped as tails
assert.deepEqual(paths({ tasks: [task('A', '', 'index.html'), task('B', '', 'public/index.html')] }), [
  'index.html',
  'public/index.html'
]);

// Connect 4 log: dependency mentions in descriptions are context, not write targets
const step4 = step({
  id: '4',
  title: 'UI and wiring',
  status: 'pending',
  tasks: [
    task('Styles', '', 'src/styles.css'),
    task('HUD', 'Depends on game/types.ts and utils/sound.ts.', 'src/components/HUD.tsx'),
    task(
      'App',
      'Depends on game/types.ts, game/board.ts, utils/sound.ts, scene/GameScene.tsx, and components/HUD.tsx.',
      'src/App.tsx'
    ),
    task('Entry', 'Mounts App from types.ts.', 'src/main.tsx')
  ]
});
assert.deepEqual(collectStepFilePaths(step4), [
  'src/styles.css',
  'src/components/HUD.tsx',
  'src/App.tsx',
  'src/main.tsx'
]);
assert.deepEqual(collectStepContextPaths(step4), [
  'game/types.ts',
  'utils/sound.ts',
  'game/board.ts',
  'scene/GameScene.tsx'
]);
const step3 = step({
  id: '3',
  title: 'Scene',
  status: 'pending',
  tasks: [
    task('Constants', '', 'src/scene/constants.ts'),
    task('Disc', 'Depends on types.ts and scene/constants.ts.', 'src/scene/Disc3D.tsx')
  ]
});
assert.deepEqual(collectStepFilePaths(step3), ['src/scene/constants.ts', 'src/scene/Disc3D.tsx']);
assert.deepEqual(collectStepContextPaths(step3), ['types.ts']);
assert.deepEqual(
  resolveContextPaths(collectStepContextPaths(step4), [
    'src/game/types.ts',
    'src/game/board.ts',
    'src/utils/sound.ts',
    'src/scene/GameScene.tsx',
    'src/other/types.ts'
  ]),
  ['src/game/types.ts', 'src/utils/sound.ts', 'src/game/board.ts', 'src/scene/GameScene.tsx']
);
assert.deepEqual(resolveContextPaths(['missing/file.ts', 'src/App.tsx'], ['src/App.tsx']), ['src/App.tsx']);
// Text-only (legacy) step: scanned paths stay write targets, minus suffix duplicates
const legacy = step({
  id: '5',
  title: 'Legacy',
  status: 'pending',
  tasks: [task('Scene', 'Write src/scene/constants.ts, then scene/constants.ts and components/HUD.tsx and src/components/HUD.tsx.')]
});
assert.deepEqual(collectStepFilePaths(legacy), ['src/scene/constants.ts', 'src/components/HUD.tsx']);
assert.deepEqual(collectStepContextPaths(legacy), []);

// Rework only the files a failure names
const step3Files = [
  'src/game/gameLogic.ts',
  'src/components/Board3D.tsx',
  'src/components/Piece3D.tsx',
  'src/components/HUD.tsx'
];
assert.deepEqual(
  filesImplicatedByFailure(step3Files, {
    nayNote:
      'src/components/Board3D.tsx imports and uses `<Piece3D position={...} player={...} />`, but `src/components/Piece3D.tsx` exports a component that takes no props.'
  }),
  ['src/components/Board3D.tsx', 'src/components/Piece3D.tsx']
);
// tsc error paths (relative, absolute, backslashes) and the declaring module
assert.deepEqual(
  filesImplicatedByFailure(step3Files, {
    tscErrors:
      "src/components/Board3D.tsx(34,12): error TS2322: Type '{ position: number[]; }' is not assignable to type 'IntrinsicAttributes & Piece3DProps'.\n  Property 'position' does not exist on type 'IntrinsicAttributes & Piece3DProps'."
  }),
  ['src/components/Board3D.tsx', 'src/components/Piece3D.tsx']
);
assert.deepEqual(
  filesImplicatedByFailure(step3Files, {
    tscErrors:
      "D:\\ws\\src\\components\\Board3D.tsx(9,10): error TS2614: Module '\"./Piece3D\"' has no exported member 'Piece3D'. Did you mean to use 'import Piece3D from \"./Piece3D\"' instead?"
  }),
  ['src/components/Board3D.tsx', 'src/components/Piece3D.tsx']
);
assert.deepEqual(
  filesImplicatedByFailure(step3Files, { tscErrors: 'SRC/GAME/GAMELOGIC.TS(3,1): error TS2322: x' }),
  ['src/game/gameLogic.ts']
);
// Basename only, case-insensitive; a longer name is not a match
assert.deepEqual(filesImplicatedByFailure(step3Files, { nayNote: 'hud.tsx never shows the score.' }), [
  'src/components/HUD.tsx'
]);
assert.deepEqual(
  filesImplicatedByFailure(['src/App.tsx', 'src/components/Cell.tsx'], { nayNote: 'MyApp.tsx is wrong' }),
  ['src/App.tsx', 'src/components/Cell.tsx']
);
// Reviewer's missing list counts; nothing named (or nothing in the step) → all files
assert.deepEqual(
  filesImplicatedByFailure(step3Files, { reviewerMissing: ['HUD.tsx does not show whose turn it is'] }),
  ['src/components/HUD.tsx']
);
assert.deepEqual(filesImplicatedByFailure(step3Files, { nayNote: 'The game does not work.' }), step3Files);
assert.deepEqual(filesImplicatedByFailure(step3Files, { tscErrors: 'src/other.ts(1,1): error TS2322: x' }), step3Files);
assert.deepEqual(filesImplicatedByFailure(step3Files, {}), step3Files);
assert.deepEqual(filesImplicatedByFailure(['src/a.ts'], { nayNote: 'nothing' }), ['src/a.ts']);
assert.deepEqual(filesImplicatedByFailure([], { nayNote: 'x' }), []);

// A failure in files outside the step is fixed there, not by regenerating the step's own files.
const logicFiles = ['src/game/logic.ts', 'src/game/ai.ts'];
assert.deepEqual(
  reworkTargetFiles(logicFiles, { tscErrors: 'index.html(1,1): error TS9001: blank' }, ['index.html']),
  ['index.html']
);
assert.deepEqual(
  reworkTargetFiles(
    ['package.json', 'vite.config.ts', 'src/types.ts'],
    { tscErrors: "src/game/logic.ts(108,3): error TS2322: Type 'number' is not assignable to type 'Cell[]'." },
    ['src/game/logic.ts']
  ),
  ['src/game/logic.ts']
);
assert.deepEqual(
  reworkTargetFiles(
    logicFiles,
    { tscErrors: 'src/game/ai.ts(3,1): error TS2322: x\nsrc/types.ts(1,1): error TS2300: y' },
    ['src/game/ai.ts', 'src/types.ts']
  ),
  ['src/game/ai.ts', 'src/types.ts']
);
assert.deepEqual(reworkTargetFiles(logicFiles, { nayNote: 'The AI never blocks.' }, []), logicFiles);
assert.deepEqual(reworkTargetFiles(['src/a.ts'], { nayNote: 'x' }, ['../escape.ts', 'node_modules/x/y.ts']), ['src/a.ts']);
assert.deepEqual(filePathsInText('Fix `src/game/logic.ts` and src/Game/Logic.ts, see index.html'), [
  'src/game/logic.ts',
  'index.html'
]);

// The end-of-plan message is honest about failed and skipped steps.
const debtPlan = plan({
  activeStepId: null,
  steps: [
    step({ id: '3', title: 'Board', status: 'failed' }),
    step({ id: '4', title: 'UI', status: 'completed' }),
    step({ id: '5', title: 'Docs', status: 'abandoned' })
  ]
});
assert.match(planEndMessage(debtPlan, 'Run `npm run dev`.'), /^Plan ended with 1 failed step \(#3\), so the project may not work yet\./);
assert.match(planEndMessage(debtPlan, 'Run `npm run dev`.'), /1 more step skipped \(#5\)/);
assert.match(planEndMessage(debtPlan, 'Run `npm run dev`.'), /Run `npm run dev`\.$/);
assert.doesNotMatch(planEndMessage(debtPlan), /complete/i);
assert.match(
  planEndMessage(plan({ steps: [step({ id: '2', title: 'x', status: 'abandoned' })] })),
  /^Plan ended with 1 skipped step \(#2\)/
);
assert.equal(
  planEndMessage(plan({ steps: [step({ id: '1', title: 'x', status: 'completed' })] }), 'Hint.'),
  'Plan finished. Hint.'
);

// Bare task file names resolve to the one existing file with that basename.
const wsFiles = [
  'package.json',
  'src/App.tsx',
  'src/index.css',
  'src/main.tsx',
  'src/game/types.ts',
  'src/game/engine.ts',
  'src/components/Scene3D.tsx',
  'src/components/Board/index.ts',
  'src/ui/Board/index.ts',
  'src/game/util.ts',
  'src/render/util.ts',
  'node_modules/pkg/types.ts',
  'dist/types.ts'
];
function bareTask(id: string, file: string, description = '', title = 'Task'): PlannerStep['tasks'][number] {
  return { id, title, description, status: 'pending', file };
}
function bareFiles(p: PlannerPlan): string[] {
  return p.steps.flatMap(s => s.tasks.map(t => t.file || ''));
}
const barePlan = plan({
  steps: [
    step({
      id: '1',
      title: 'Game',
      status: 'pending',
      tasks: [
        bareTask('1a', 'types.ts'),
        bareTask('1b', 'index.css'),
        bareTask('1c', 'Scene3D.tsx'),
        bareTask('1d', 'src/game/engine.ts'),
        bareTask('1e', 'vite.config.ts'),
        bareTask('1f', 'index.html'),
        bareTask('1g', 'index.ts'),
        bareTask('1h', 'util.ts')
      ]
    })
  ]
});
const resolvedBare = resolveBareTaskFiles(barePlan, wsFiles);
assert.deepEqual(bareFiles(resolvedBare.plan), [
  'src/game/types.ts', // unique match (node_modules / dist copies do not count)
  'src/index.css',
  'src/components/Scene3D.tsx',
  'src/game/engine.ts', // already pathed: untouched
  'vite.config.ts', // no match: a new root file
  'index.html',
  'index.ts', // two matches, nothing names one: left alone
  'util.ts'
]);
assert.deepEqual(resolvedBare.renames, [
  { from: 'types.ts', to: 'src/game/types.ts' },
  { from: 'index.css', to: 'src/index.css' },
  { from: 'Scene3D.tsx', to: 'src/components/Scene3D.tsx' }
]);
assert.deepEqual(resolvedBare.ambiguous, ['index.ts', 'util.ts']);
assert.equal(resolveBareTaskFiles(resolvedBare.plan, wsFiles).plan, resolvedBare.plan, 'second pass is a no-op');
assert.equal(resolveBareTaskFiles(resolvedBare.plan, wsFiles).renames.length, 0);

// Two matches: the task's own description names one.
const ownMention = resolveBareTaskFiles(
  plan({
    steps: [
      step({
        id: '1',
        title: 'Utils',
        status: 'pending',
        tasks: [bareTask('1a', 'util.ts', 'Add helpers next to the renderer in `src/render/util.ts`.')]
      })
    ]
  }),
  wsFiles
);
assert.deepEqual(bareFiles(ownMention.plan), ['src/render/util.ts']);
assert.deepEqual(ownMention.renames, [{ from: 'util.ts', to: 'src/render/util.ts' }]);

// Two matches: another task of the plan names one by its full path (even by a folder-tail path).
const otherMention = resolveBareTaskFiles(
  plan({
    steps: [
      step({
        id: '1',
        title: 'Board',
        status: 'pending',
        tasks: [bareTask('1a', 'index.ts', 'Re-export the board.'), bareTask('1b', 'ui/Board/index.ts', 'Barrel for the UI')]
      })
    ]
  }),
  wsFiles
);
// The folder-tail spelling `ui/Board/index.ts` is the same file, so the two tasks become one worker.
assert.deepEqual(bareFiles(otherMention.plan), ['src/ui/Board/index.ts']);
assert.deepEqual(otherMention.merged, [{ file: 'src/ui/Board/index.ts', tasks: 2 }]);
assert.match(otherMention.plan.steps[0].tasks[0].description, /Re-export the board\.\s+Barrel for the UI/);

// A mention of both candidates is still ambiguous; a root file that exists already is left alone.
const both = resolveBareTaskFiles(
  plan({
    steps: [
      step({
        id: '1',
        title: 'Utils',
        status: 'pending',
        tasks: [bareTask('1a', 'util.ts', 'Compare `src/game/util.ts` with `src/render/util.ts`.')]
      })
    ]
  }),
  wsFiles
);
assert.deepEqual(bareFiles(both.plan), ['util.ts']);
assert.equal(
  bareFiles(
    resolveBareTaskFiles(
      plan({ steps: [step({ id: '1', title: 'A', status: 'pending', tasks: [bareTask('1a', 'types.ts')] })] }),
      ['types.ts', 'src/game/types.ts']
    ).plan
  )[0],
  'types.ts'
);

// `stepId` rewrites one step; finished steps are never rewritten.
const twoSteps = plan({
  steps: [
    step({ id: '1', title: 'Done', status: 'completed', tasks: [bareTask('1a', 'types.ts')] }),
    step({ id: '2', title: 'Now', status: 'in_progress', tasks: [bareTask('2a', 'engine.ts')] }),
    step({ id: '3', title: 'Later', status: 'pending', tasks: [bareTask('3a', 'engine.ts')] })
  ]
});
assert.deepEqual(bareFiles(resolveBareTaskFiles(twoSteps, wsFiles, { stepId: '2' }).plan), [
  'types.ts',
  'src/game/engine.ts',
  'engine.ts'
]);
assert.deepEqual(bareFiles(resolveBareTaskFiles(twoSteps, wsFiles).plan), ['types.ts', 'src/game/engine.ts', 'src/game/engine.ts']);
// Windows separators and a ./ prefix in the workspace list or the task name resolve the same way.
assert.deepEqual(
  bareFiles(
    resolveBareTaskFiles(
      plan({ steps: [step({ id: '1', title: 'A', status: 'pending', tasks: [bareTask('1a', './types.ts')] })] }),
      ['src\\game\\types.ts']
    ).plan
  ),
  ['src/game/types.ts']
);

console.log('plannerPlan.selftest ok');
