import assert from 'node:assert/strict';
import type { PlannerPlan, PlannerStep, ToolCall } from '../types';
import { executeTool } from './agentLoop';
import { anchorWritePath } from './tools';
import { collectStepContextPaths, collectStepFilePaths, resolveBareTaskFiles } from './plannerPlan';
import {
  assignedTwinPath,
  canonicalizePath,
  canonicalizePaths,
  canonicalizeTextMentions,
  createPathResolver,
  isRootProjectFile,
  normalizePathText,
  ownedTailTwin,
  scanTextForFilePaths
} from './workspacePaths';

const ws = [
  'package.json',
  'index.html',
  'src/main.tsx',
  'src/App.tsx',
  'src/index.css',
  'src/game/types.ts',
  'src/game/board.ts',
  'src/components/HUD.tsx',
  'src/components/Board/index.ts',
  'src/ui/Board/index.ts',
  'src/game/util.ts',
  'src/render/util.ts',
  'node_modules/pkg/types.ts',
  'dist/types.ts'
];

// --- normalisation -------------------------------------------------------------------------
assert.equal(normalizePathText('  `.\\src\\game\\types.ts`  '), 'src/game/types.ts');
assert.equal(normalizePathText('"./src//game/./types.ts"'), 'src/game/types.ts');
assert.equal(normalizePathText('src/game/'), 'src/game');
assert.equal(normalizePathText('.'), '');
assert.equal(isRootProjectFile('./package.json'), true);
assert.equal(isRootProjectFile('src/package.json'), false);

// --- canonicalizePath ----------------------------------------------------------------------
const ctx = { workspaceFiles: ws };
assert.equal(canonicalizePath('src/game/types.ts', ctx), 'src/game/types.ts', 'exact');
assert.equal(canonicalizePath('SRC/Game/Types.ts', ctx), 'src/game/types.ts', 'case -> canonical casing');
assert.equal(canonicalizePath('.\\src\\components\\hud.tsx', ctx), 'src/components/HUD.tsx', 'Windows slashes + case');
assert.equal(canonicalizePath('game/types.ts', ctx), 'src/game/types.ts', 'dir-suffix');
assert.equal(canonicalizePath('types.ts', ctx), 'src/game/types.ts', 'unique basename (node_modules/dist ignored)');
assert.equal(canonicalizePath('components/HUD.tsx', ctx), 'src/components/HUD.tsx');
assert.equal(canonicalizePath('"`index.css`"', ctx), 'src/index.css');
// A new file nothing matches keeps its (normalised) name.
assert.equal(canonicalizePath('./src/game/engine.ts', ctx), 'src/game/engine.ts');
assert.equal(canonicalizePath('vite.config.ts', ctx), 'vite.config.ts');
// Root project files are never mapped into sub-folders.
assert.equal(canonicalizePath('index.html', { workspaceFiles: ['src/index.html'] }), 'index.html');
assert.equal(canonicalizePath('package.json', { workspaceFiles: ['packages/a/package.json'] }), 'package.json');
assert.equal(canonicalizePath('tsconfig.json', { workspaceFiles: ['app/tsconfig.json'] }), 'tsconfig.json');
assert.equal(canonicalizePath('.gitignore', { workspaceFiles: ['config/.gitignore'] }), '.gitignore');
assert.equal(canonicalizePath('.env.local', { workspaceFiles: ['app/.env.local'] }), '.env.local');
assert.equal(canonicalizePath('vite.config.ts', { workspaceFiles: ['app/vite.config.ts'] }), 'vite.config.ts');
// ...but a pathed spelling still maps (`app/tsconfig.json` is not a bare root file).
assert.equal(canonicalizePath('app/tsconfig.json', { workspaceFiles: ['web/app/tsconfig.json'] }), 'web/app/tsconfig.json');
// Ambiguity: unchanged and reported; `shortest` opts into a pick.
const amb = createPathResolver(ctx).resolve('util.ts');
assert.equal(amb.kind, 'ambiguous');
assert.equal(amb.path, 'util.ts');
assert.deepEqual([...amb.candidates].sort(), ['src/game/util.ts', 'src/render/util.ts']);
assert.equal(canonicalizePath('index.ts', ctx), 'index.ts');
assert.equal(canonicalizePath('util.ts', { ...ctx, onAmbiguous: 'shortest' }), 'src/game/util.ts');
// Hint text names the intended one by folder path.
assert.equal(
  createPathResolver(ctx).resolve('util.ts', { hintTexts: ['no folder here', () => 'next to `render/util.ts`'] }).path,
  'src/render/util.ts'
);
// `..` escapes and outside absolute paths are rejected; inside-root absolute paths become relative.
assert.equal(canonicalizePath('../secret.ts', ctx), null);
assert.equal(canonicalizePath('src/../../x.ts', ctx), null);
assert.equal(canonicalizePath('C:\\Windows\\x.ts', ctx), null);
assert.equal(canonicalizePath('/etc/passwd', ctx), null);
assert.equal(canonicalizePath('', ctx), null);
assert.equal(canonicalizePath('D:\\ws\\src\\game\\types.ts', { ...ctx, workspaceRoot: 'D:/ws' }), 'src/game/types.ts');
assert.equal(canonicalizePath('D:\\other\\types.ts', { ...ctx, workspaceRoot: 'D:/ws' }), null);
// Known (plan) files beat existing ones; a planned partial is a spelling of the longer path.
assert.equal(
  canonicalizePath('util.ts', { workspaceFiles: ws, knownFiles: ['src/render/util.ts'] }),
  'src/render/util.ts',
  'known tier wins over an equally matching existing file'
);
assert.equal(
  canonicalizePath('scene/constants.ts', { workspaceFiles: [], knownFiles: ['src/scene/constants.ts'] }),
  'src/scene/constants.ts',
  'another plan task targets it'
);
assert.equal(
  canonicalizePath('scene/constants.ts', { knownFiles: ['scene/constants.ts', 'src/scene/constants.ts'] }),
  'src/scene/constants.ts',
  'a planned partial collapses into the planned full path'
);

// --- canonicalizePaths ---------------------------------------------------------------------
assert.deepEqual(
  canonicalizePaths(
    ['src/game/types.ts', 'game/types.ts', 'types.ts', './SRC/GAME/TYPES.TS', 'src\\game\\types.ts', '../x.ts', '', 'src/App.tsx'],
    ctx
  ),
  ['src/game/types.ts', 'src/App.tsx']
);

// --- canonicalizeTextMentions --------------------------------------------------------------
const mentionCtx = { workspaceFiles: ws, knownFiles: ['src/scene/constants.ts'] };
assert.equal(
  canonicalizeTextMentions('Depends on types.ts, scene/constants.ts and `game/board.ts` (see components\\HUD.tsx).', mentionCtx),
  'Depends on src/game/types.ts, src/scene/constants.ts and `src/game/board.ts` (see components\\HUD.tsx).',
  'prose + backticks; a backslash path in prose is not a token'
);
assert.equal(
  canonicalizeTextMentions('Use `components\\HUD.tsx` and ./game/types.ts.', mentionCtx),
  'Use `src/components/HUD.tsx` and src/game/types.ts.'
);
// Not inside URLs, not for library names, not when ambiguous or unknown.
assert.equal(
  canonicalizeTextMentions('See https://example.com/game/types.ts and Three.js and util.ts and other.ts.', mentionCtx),
  'See https://example.com/game/types.ts and Three.js and util.ts and other.ts.'
);
// Already canonical text is returned untouched (same string).
const clean = 'Edit src/game/types.ts and `src/App.tsx`.';
assert.equal(canonicalizeTextMentions(clean, mentionCtx), clean);
assert.deepEqual(scanTextForFilePaths('Edit `src/App.tsx` now'), ['src/App.tsx', 'src/App.tsx']);

// --- assigned twins / owned tails ----------------------------------------------------------
assert.equal(assignedTwinPath(['src/game/types.ts'], 'game/types.ts'), 'src/game/types.ts');
assert.equal(assignedTwinPath(['src/game/types.ts'], 'Types.ts'), 'src/game/types.ts');
assert.equal(assignedTwinPath(['src/game/types.ts'], 'src/game/types.ts'), null, 'same spelling');
assert.equal(assignedTwinPath(['src/game/types.ts'], 'src/ui/types.ts'), null, 'different file');
assert.equal(assignedTwinPath(['src/index.html'], 'index.html'), null, 'root file stays a root file');
assert.equal(assignedTwinPath(['src/a/index.ts', 'src/b/index.ts'], 'index.ts'), null, 'ambiguous');
assert.equal(ownedTailTwin(['src/game/types.ts'], 'game/types.ts'), 'src/game/types.ts');
assert.equal(ownedTailTwin(['src/game/types.ts'], 'src/game/types.ts'), null);
assert.equal(ownedTailTwin(['src/game/types.ts'], 'src/game/Types.ts'), null, 'case-only twin is the same file');

// --- plan canonicalization: the real Connect 4 shapes ---------------------------------------
function mkTask(id: string, file: string | undefined, title: string, description: string): PlannerStep['tasks'][number] {
  return { id, title, description, status: 'pending', ...(file ? { file } : {}) };
}
function mkPlan(steps: PlannerStep[]): PlannerPlan {
  return { id: 'p', summary: 'Connect 4', status: 'active', updatedAt: 1, activeStepId: '3', healAttempts: 0, steps };
}
const c4Files = [
  'package.json',
  'index.html',
  'src/main.tsx',
  'src/App.tsx',
  'src/game/types.ts',
  'src/game/board.ts',
  'src/components/HUD.tsx'
];
const c4 = mkPlan([
  {
    id: '1',
    title: 'Game core',
    status: 'completed',
    tasks: [
      { ...mkTask('1a', 'src/game/types.ts', 'Types', 'Define types.ts'), status: 'completed' }
    ]
  },
  {
    id: '3',
    title: 'Scene',
    description: 'Builds on scene/constants.ts',
    status: 'in_progress',
    tasks: [
      mkTask('3a', 'src/scene/constants.ts', 'Constants', 'Depends on types.ts. Export board sizes.'),
      mkTask('3b', 'src/scene/Disc3D.tsx', 'Disc', 'Depends on game/types.ts, scene/constants.ts and `types.ts`.'),
      mkTask('3c', 'src/scene/Board3D.tsx', 'Board', 'Uses scene/constants.ts and game/board.ts; see components/HUD.tsx.'),
      mkTask('3d', 'src/scene/GameScene.tsx', 'Scene', 'Renders Board3D; HUD overlay lives in components/HUD.tsx.'),
      mkTask('3e', 'src/utils/sound.ts', 'Sound', 'No deps.')
    ]
  }
]);
const c4Resolved = resolveBareTaskFiles(c4, c4Files, { stepId: '3' });
const c4Step = c4Resolved.plan.steps[1];
assert.deepEqual(
  c4Step.tasks.map(t => t.file),
  ['src/scene/constants.ts', 'src/scene/Disc3D.tsx', 'src/scene/Board3D.tsx', 'src/scene/GameScene.tsx', 'src/utils/sound.ts']
);
assert.equal(c4Step.description, 'Builds on src/scene/constants.ts', 'step description rewritten');
assert.equal(c4Step.tasks[0].description, 'Depends on src/game/types.ts. Export board sizes.');
assert.equal(c4Step.tasks[1].description, 'Depends on src/game/types.ts, src/scene/constants.ts and `src/game/types.ts`.');
assert.equal(
  c4Step.tasks[2].description,
  'Uses src/scene/constants.ts and src/game/board.ts; see src/components/HUD.tsx.'
);
assert.equal(c4Step.tasks[3].description, 'Renders Board3D; HUD overlay lives in src/components/HUD.tsx.');
assert.equal(c4Resolved.plan.steps[0], c4.steps[0], 'finished steps are untouched');
// Mentions are now full paths, so they are dependencies and never write targets.
assert.deepEqual(collectStepFilePaths(c4Step), c4Step.tasks.map(t => t.file));
assert.deepEqual(collectStepContextPaths(c4Step), ['src/game/types.ts', 'src/game/board.ts', 'src/components/HUD.tsx']);
assert.equal(c4Resolved.mentions.some(m => m.from === 'game/types.ts' && m.to === 'src/game/types.ts'), true);
assert.equal(c4Resolved.mentions.some(m => m.from === 'types.ts' && m.to === 'src/game/types.ts'), true);
// A second pass changes nothing.
assert.equal(resolveBareTaskFiles(c4Resolved.plan, c4Files, { stepId: '3' }).plan, c4Resolved.plan);

// Task files given as partial paths resolve to the plan's full path or the workspace file.
const partial = resolveBareTaskFiles(
  mkPlan([
    {
      id: '1',
      title: 'Scene',
      status: 'pending',
      tasks: [
        mkTask('1a', 'scene/constants.ts', 'Constants', 'Sizes.'),
        mkTask('1b', 'src/scene/Disc3D.tsx', 'Disc', 'Uses constants.'),
        mkTask('1c', 'game/types.ts', 'Types', 'Add a Player type.'),
        mkTask('1d', 'Scene/Constants.ts', 'More', 'Colours.')
      ]
    },
    {
      id: '2',
      title: 'Later',
      status: 'pending',
      tasks: [mkTask('2a', 'src/scene/constants.ts', 'Tune', 'Tune sizes.')]
    }
  ]),
  c4Files
);
// 1a and 1d are both `src/scene/constants.ts` (another task of the plan targets it): one worker.
assert.deepEqual(
  partial.plan.steps[0].tasks.map(t => t.file),
  ['src/scene/constants.ts', 'src/scene/Disc3D.tsx', 'src/game/types.ts']
);
assert.deepEqual(partial.merged, [{ file: 'src/scene/constants.ts', tasks: 2 }]);
const mergedTask = partial.plan.steps[0].tasks[0];
assert.equal(mergedTask.id, '1a');
assert.equal(mergedTask.description, 'Sizes.\n\nMore: Colours.');
assert.equal(partial.plan.steps[1].tasks[0].file, 'src/scene/constants.ts');
assert.deepEqual(
  partial.renames.map(r => `${r.from} -> ${r.to}`).sort(),
  ['Scene/Constants.ts -> src/scene/constants.ts', 'game/types.ts -> src/game/types.ts', 'scene/constants.ts -> src/scene/constants.ts']
);

// Two bare tasks for one file that the workspace holds twice stay put and are reported.
const dup = resolveBareTaskFiles(
  mkPlan([
    { id: '1', title: 'A', status: 'pending', tasks: [mkTask('1a', 'util.ts', 'U', 'Helpers.')] }
  ]),
  ws
);
assert.deepEqual(dup.ambiguous, ['util.ts']);
assert.equal(dup.plan.steps[0].tasks[0].file, 'util.ts');

// Completed tasks are never merged away.
const doneTwins = resolveBareTaskFiles(
  mkPlan([
    {
      id: '1',
      title: 'A',
      status: 'in_progress',
      tasks: [
        { ...mkTask('1a', 'src/App.tsx', 'App', 'Shell.'), status: 'completed' },
        mkTask('1b', 'App.tsx', 'App again', 'Add HUD.')
      ]
    }
  ]),
  c4Files
);
assert.deepEqual(doneTwins.plan.steps[0].tasks.map(t => [t.id, t.file, t.status]), [
  ['1a', 'src/App.tsx', 'completed'],
  ['1b', 'src/App.tsx', 'pending']
]);

// --- write-time redirect (agentLoop) ---------------------------------------------------------
void (async () => {
  const disk: Record<string, string> = {};
  const writes: string[] = [];
  (globalThis as any).window = { electronAPI: { execTool: async () => ({ error: 'missing' }) } };
  const deps = {
    workspacePath: 'D:/ws',
    onExecuteToolCommand: async () => '',
    onApplyFileWrite: async (p: string, c: string) => {
      disk[p] = c;
      writes.push(p);
      return true;
    },
    getOwnedFiles: () => ['src/game/types.ts', 'src/scene/constants.ts'],
    getAssignedFiles: () => ['src/game/types.ts']
  };
  const write = (path: string, id = 'w'): ToolCall =>
    ({ id, name: 'write_file', args: { path }, body: `export type Player = 1 | 2; // ${id}\n`, status: 'pending' }) as ToolCall;

  // An assigned twin is redirected and still written.
  const redirected = await executeTool(write('game/types.ts'), deps);
  assert.equal(redirected.status, 'done');
  assert.equal(redirected.args.path, 'src/game/types.ts');
  assert.equal(redirected.result, 'Wrote file src/game/types.ts (redirected from game/types.ts)');
  assert.deepEqual(writes, ['src/game/types.ts']);

  // A bare basename of the assigned file too.
  const bare = await executeTool(write('types.ts', 'w2'), deps);
  assert.equal(bare.status, 'done');
  assert.equal(bare.args.path, 'src/game/types.ts');

  // The assigned file itself: no note.
  const same = await executeTool(write('src/game/types.ts', 'w3'), { ...deps, editProgress: undefined });
  assert.equal(same.status, 'done');
  assert.equal(same.result?.includes('redirected'), false);

  // A twin of an owned file that was NOT assigned to this worker keeps the rejection.
  const unassigned = await executeTool(write('scene/constants.ts', 'w4'), deps);
  assert.equal(unassigned.status, 'error');
  assert.match(unassigned.result || '', /already exists as src\/scene\/constants\.ts/);
  assert.equal(writes.includes('scene/constants.ts'), false);
  assert.equal(writes.includes('src/scene/constants.ts'), false);

  // Without an assignment the old rejection applies to the very same path.
  const noAssign = await executeTool(write('game/types.ts', 'w5'), { ...deps, getAssignedFiles: undefined });
  assert.equal(noAssign.status, 'error');
  assert.match(noAssign.result || '', /already exists as src\/game\/types\.ts/);

  // edit_file is redirected before the read, so the assigned file is the one patched.
  const reads: string[] = [];
  disk['src/game/types.ts'] = 'export const a = 1;\n';
  (globalThis as any).window = {
    electronAPI: {
      execTool: async (_root: string, name: string, args: { path: string }) => {
        reads.push(args.path);
        return name === 'read_file' && args.path in disk ? { content: disk[args.path] } : { error: `missing ${args.path}` };
      }
    }
  };
  const edit = await executeTool(
    {
      id: 'e1',
      name: 'edit_file',
      args: { path: 'game/types.ts' },
      body: '<<<<<<< SEARCH\nexport const a = 1;\n=======\nexport const a = 2;\n>>>>>>> REPLACE\n',
      status: 'pending'
    } as ToolCall,
    deps
  );
  assert.equal(edit.status, 'done');
  assert.equal(edit.args.path, 'src/game/types.ts');
  assert.equal(edit.result, 'Applied diff to src/game/types.ts (redirected from game/types.ts)');
  assert.deepEqual(reads, ['src/game/types.ts']);
  assert.equal(disk['src/game/types.ts'], 'export const a = 2;\n');
  delete (globalThis as any).window;

  // Swarm workers: the parsed write is anchored to the worker's own file.
  const anchored = anchorWritePath(
    { id: 'a', name: 'write_file', args: { path: 'game/types.ts' }, body: 'x', status: 'pending' } as ToolCall,
    'src/game/types.ts'
  );
  assert.equal(anchored.args.path, 'src/game/types.ts');
  assert.equal(anchored.args.redirectedFrom, 'game/types.ts');
  const other = anchorWritePath(
    { id: 'b', name: 'write_file', args: { path: 'game/board.ts' }, body: 'x', status: 'pending' } as ToolCall,
    'src/game/types.ts'
  );
  assert.equal(other.args.path, 'game/board.ts', 'a different file is left alone');
  const caseOnly = anchorWritePath(
    { id: 'c', name: 'write_file', args: { path: './src/Game/Types.ts' }, body: 'x', status: 'pending' } as ToolCall,
    'src/game/types.ts'
  );
  assert.equal(caseOnly.args.path, 'src/game/types.ts');
  assert.equal(caseOnly.args.redirectedFrom, undefined, 'a respelling is not worth a note');

  console.log('workspacePaths.selftest ok');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
