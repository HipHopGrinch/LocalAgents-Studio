/**
 * Run: npx --yes tsx src/lib/swarmContract.selftest.ts
 */
import assert from 'node:assert/strict';
import type { EndpointNode, HardwareProfile } from '../types';
import {
  buildCloudStrategistPrompt,
  buildContractRepairPrompt,
  buildLeadArchitectPrompt,
  buildRepairWorkerPrompt,
  buildSwarmWorkerPrompt,
  buildSwarmWorkerSystemStub,
  inferTaskDependsOn,
  orderStepDispatchTasks,
  partitionSwarmTasksIntoWaves,
  referencedDeclarationsForErrors,
  shouldSerializeStepTasks,
  type SwarmManifest,
  type SwarmTask,
  groupTscErrorsByFile,
  alreadyWrittenDeclarations,
  buildForcedWritePrompt,
  canForceWholeFile,
  numberedLines,
  pathsNamedInText,
  wholeFileCharLimit
} from './swarmContract';
import { pickExistingProjectExports } from './repoMap';

function task(partial: Partial<SwarmTask> & Pick<SwarmTask, 'filePath'>): SwarmTask {
  return {
    complexity: 'medium',
    preferredRole: '@coder',
    requiredExports: [],
    requiredImports: [],
    instructions: partial.filePath,
    ...partial
  };
}

const linked = inferTaskDependsOn([
  task({
    filePath: 'src/app.ts',
    requiredImports: ["import { util } from './util'", "import { no } from './missing'"],
    dependsOn: ['util.ts']
  }),
  task({ filePath: 'src/util.ts', requiredExports: ['export function util(): void'] }),
  task({ filePath: 'tests/util.ts', requiredExports: ['export function util(): void'] }),
  task({
    filePath: 'src/game/board.ts',
    requiredImports: ["import { util } from '../util'"]
  })
]);
const app = linked.find(t => t.filePath === 'src/app.ts');
assert.deepEqual(app?.dependsOn, ['src/util.ts']);
assert.deepEqual(linked.find(t => t.filePath === 'src/game/board.ts')?.dependsOn, ['src/util.ts']);
assert.deepEqual(linked.find(t => t.filePath === 'tests/util.ts')?.dependsOn, []);

const include = inferTaskDependsOn([
  task({
    filePath: 'Checkers.cpp',
    requiredImports: ['#include "Checkers.h"']
  }),
  task({ filePath: 'Checkers.h' })
]);
assert.deepEqual(include[0].dependsOn, ['Checkers.h']);

const a = task({ filePath: 'src/a.ts', dependsOn: ['src/b.ts'] });
const b = task({ filePath: 'src/b.ts', dependsOn: ['src/a.ts'] });
const cycle = partitionSwarmTasksIntoWaves([a, b]);
assert.equal(cycle.length, 2);
assert.equal(cycle[0].length, 1);
assert.equal(cycle[1].length, 1);
assert.notEqual(cycle[0][0].filePath, cycle[1][0].filePath);

const independent = partitionSwarmTasksIntoWaves([
  task({ filePath: 'src/a.ts' }),
  task({ filePath: 'src/b.ts' })
]);
assert.equal(independent.length, 1);
assert.equal(independent[0].length, 2);

const chain = partitionSwarmTasksIntoWaves([
  task({ filePath: 'src/c.ts', dependsOn: ['src/b.ts'] }),
  task({ filePath: 'src/a.ts' }),
  task({ filePath: 'src/b.ts', dependsOn: ['src/a.ts'] })
]);
assert.deepEqual(
  chain.map(w => w.map(t => t.filePath)),
  [['src/a.ts'], ['src/b.ts'], ['src/c.ts']]
);

const hw = (vramGB: number): HardwareProfile => ({
  cpu: 'cpu',
  gpu: 'gpu',
  vramGB,
  gpuBandwidthGBs: 400,
  ramGB: 32,
  ramBandwidthGBs: 40,
  reserveVramGB: 1,
  kvCacheType: 'f16'
});
const roster: EndpointNode[] = [
  {
    id: 'rig',
    name: '5070',
    url: 'http://127.0.0.1:11434',
    online: true,
    latency: 5,
    specialty: 'architect',
    hardware: hw(16),
    models: [{ name: 'gemma4:12b', size: 1 }],
    loaded: [],
    activeModel: 'gemma4:12b'
  }
];
const planSentence = 'PLAN_SENTENCE_UNIQUE follow the checkers rules exactly';
const cloud = buildCloudStrategistPrompt({
  userTask: `Build checkers.\n\n${planSentence}\n\n${planSentence}`,
  approvedPlanBrief: planSentence,
  nodes: roster,
  workspaceOverview: 'src/app.ts\n```\nfunction SECRET_CODE_BODY() { return 1 }\n```\n',
  existingSnippets: ['one', 'two', 'three', 'four']
    .map(name => `### src/${name}.ts\n${'x'.repeat(800)}`)
    .join('\n')
});
assert.equal(cloud.split('PLAN_SENTENCE_UNIQUE').length - 1, 1);
assert.doesNotMatch(cloud, /SECRET_CODE_BODY/);
assert.match(cloud, /src\/app.ts/);
assert.match(cloud, /rig \| 5070/);
assert.match(cloud, /src\/one.ts/);
assert.match(cloud, /src\/three.ts/);
assert.doesNotMatch(cloud, /src\/four.ts/);
assert.ok(cloud.length < 6500, `cloud prompt too long: ${cloud.length}`);

const snippets = ['one', 'two', 'three', 'four', 'five']
  .map(name => `### src/${name}.ts\n${'y'.repeat(2000)}`)
  .join('\n');
const local = buildLeadArchitectPrompt(
  `Implement the game.\n${planSentence}`,
  'src/app.ts',
  snippets,
  planSentence,
  null,
  null,
  roster
);
assert.equal(local.split('PLAN_SENTENCE_UNIQUE').length - 1, 1);
assert.match(local, /src\/one.ts/);
assert.doesNotMatch(local, /src\/four.ts/);
assert.match(local, /snippet truncated/);

const asCloud = buildLeadArchitectPrompt('task', 'tree', '', null, null, null, roster, {
  cloudStrategist: true
});
assert.match(asCloud, /Cloud Strategist/);
assert.doesNotMatch(asCloud, /Example \(native Win32\)/);

const stub = buildSwarmWorkerSystemStub('src/game.ts', 'typescript');
assert.ok(stub.length < 2000, `stub too long: ${stub.length}`);
assert.match(stub, /src\/game\.ts/);
assert.match(stub, /<edit_file/);
assert.doesNotMatch(stub, /Work log/);
assert.doesNotMatch(stub, /inferring on/);

const current = `HEAD\n${'z'.repeat(20000)}\nTAIL_MARKER`;
const worker = buildSwarmWorkerPrompt({
  task: task({
    filePath: 'src/board.ts',
    instructions: 'TASK_MARKER implement the board',
    dependsOn: ['src/a.ts'],
    requiredImports: ["import { a } from './a'"],
    requiredExports: ['export function board(): void']
  }),
  contractFile: 'src/types/swarm-contract.ts',
  contractCode: 'export interface Piece { id: string }\n',
  siblingSummary: `MIDDLE_SECRET ${'q'.repeat(20000)} END_SECRET`,
  currentFileContent: current,
  userPrompt: 'overall request',
  devHostSection: 'DEVELOPMENT HOST you are inferring on the laptop',
  stack: 'typescript',
  tier: 'tight',
  siblingFiles: [
    { path: 'src/a.ts', exports: ['aFn'], content: `export const a = 1\n${'a'.repeat(8000)}` },
    { path: 'src/b.ts', exports: ['bFn'], content: 'SECRET_B_BODY' }
  ]
});
assert.ok(worker.lastIndexOf('TASK_MARKER') > worker.indexOf('CURRENT FILE'));
assert.ok(worker.lastIndexOf('TASK_MARKER') > worker.indexOf('SIBLINGS'));
assert.doesNotMatch(worker, /DEVELOPMENT HOST/);
assert.doesNotMatch(worker, /inferring on/);
assert.doesNotMatch(worker, /SECRET_B_BODY/);
assert.match(worker, /exports: bFn/);
assert.match(worker, /export const a = 1/);
assert.match(worker, /truncated/);
assert.match(worker, /HEAD/);
assert.match(worker, /TAIL_MARKER/);
assert.doesNotMatch(worker, /z{8000}/);

const legacySiblings = buildSwarmWorkerPrompt({
  task: task({ filePath: 'src/board.ts', instructions: 'do it' }),
  contractFile: 'SWARM.md',
  contractCode: 'notes',
  siblingSummary: `START_KEEP ${'m'.repeat(5000)} MIDDLE_SECRET ${'m'.repeat(5000)} END_KEEP`,
  userPrompt: 'brief',
  stack: 'python',
  tier: 'tight'
});
assert.match(legacySiblings, /START_KEEP/);
assert.doesNotMatch(legacySiblings, /MIDDLE_SECRET/);

const manifest: SwarmManifest = {
  contractFile: 'src/types/swarm-contract.ts',
  contractCode: `export interface Piece { id: string }\nexport function hidden() {\n  const SECRET_BODY_LINE = 1;\n  return SECRET_BODY_LINE;\n}\n`,
  stack: 'typescript',
  tasks: [
    task({
      filePath: 'src/board.ts',
      requiredExports: ['export function board(): void'],
      instructions: 'A'.repeat(3000)
    })
  ]
};
const errors = Array.from({ length: 50 }, (_, i) => `src/board.ts(${100 + i},1): error TS2322: bad ${i}`).join(
  '\n'
);
const contractRepair = buildContractRepairPrompt('fix types', manifest, errors, { tier: 'tight' });
assert.match(contractRepair, /export interface Piece/);
assert.match(contractRepair, /export function hidden/);
assert.doesNotMatch(contractRepair, /SECRET_BODY_LINE/);
assert.doesNotMatch(contractRepair, /A{500}/);
assert.match(contractRepair, /more lines omitted/);
assert.match(contractRepair, /Tight context/);

const fileLines = Array.from({ length: 200 }, (_, i) =>
  i === 0 ? 'ONLY_FIRST_LINE' : i === 99 ? 'ONLY_ERROR_LINE' : `l${i}${'.'.repeat(30)}`
);
const fileRepair = buildRepairWorkerPrompt({
  task: task({ filePath: 'src/board.ts', requiredExports: ['export function board(): void'] }),
  contractFile: manifest.contractFile,
  contractCode: manifest.contractCode,
  currentFileContent: fileLines.join('\n'),
  tscErrors: 'src/board.ts(100,1): error TS2322: nope',
  devHostSection: 'DEVELOPMENT HOST inferring on laptop',
  tier: 'tight'
});
assert.match(fileRepair, /ONLY_ERROR_LINE/);
assert.doesNotMatch(fileRepair, /ONLY_FIRST_LINE/);
assert.doesNotMatch(fileRepair, /SECRET_BODY_LINE/);
assert.doesNotMatch(fileRepair, /DEVELOPMENT HOST/);
assert.match(fileRepair, /<edit_file/);
assert.match(fileRepair, /Do not rewrite the whole file/);

// B-27: a sibling folder sharing the root's name prefix is not stripped
const siblingErrors = groupTscErrorsByFile('D:/work/app2/src/a.ts(1,1): error TS2322: x', 'D:/work/app');
assert.deepEqual([...siblingErrors.keys()], ['D:/work/app2/src/a.ts']);
const insideErrors = groupTscErrorsByFile('D:\\work\\app\\src\\a.ts(1,1): error TS2322: x', 'D:/work/app');
assert.deepEqual([...insideErrors.keys()], ['src/a.ts']);

// B-28: unknown VRAM (0) is not described as 1 GB
const noVramPrompt = buildLeadArchitectPrompt('task', 'tree', '', null, null, null, [
  { ...roster[0], id: 'novram', hardware: hw(0) }
]);
assert.match(noVramPrompt, /15GB usable VRAM/);
assert.doesNotMatch(noVramPrompt, / 1GB usable VRAM/);

// Item D: multi-file plan steps get shared files first and consumers after them
const waveFiles = (tasks: SwarmTask[]) => partitionSwarmTasksIntoWaves(tasks).map(w => w.map(t => t.filePath));
const ordered = (paths: string[]) => orderStepDispatchTasks(paths.map(filePath => task({ filePath })));

const connect4 = ordered(['src/game/aiOpponent.ts', 'src/game/gameLogic.ts', 'src/game/types.ts']);
assert.deepEqual(
  connect4.map(t => t.filePath),
  ['src/game/types.ts', 'src/game/gameLogic.ts', 'src/game/aiOpponent.ts']
);
assert.deepEqual(waveFiles(connect4), [['src/game/types.ts'], ['src/game/gameLogic.ts'], ['src/game/aiOpponent.ts']]);
assert.deepEqual(connect4[0].dependsOn ?? [], []);
assert.deepEqual(connect4[1].dependsOn, ['src/game/types.ts']);
assert.deepEqual(connect4[2].dependsOn, ['src/game/types.ts', 'src/game/gameLogic.ts']);

const threeSet = ordered([
  'src/App.tsx',
  'src/components/Board3D.tsx',
  'src/game/ai.ts',
  'src/game/logic.ts',
  'src/game/types.ts'
]);
assert.deepEqual(waveFiles(threeSet), [
  ['src/game/types.ts'],
  ['src/game/logic.ts'],
  ['src/components/Board3D.tsx', 'src/game/ai.ts'],
  ['src/App.tsx']
]);
const appTask = threeSet.find(t => t.filePath === 'src/App.tsx');
assert.equal(appTask?.dependsOn?.length, 4);
assert.equal(appTask?.dependsOn?.[0], 'src/game/types.ts');

// Non-code files stay free (wave 0) and never block or wait
const withConfig = ordered(['src/main.tsx', 'package.json', 'index.html', 'vite.config.ts', 'src/types.ts', 'src/game.ts']);
assert.deepEqual(withConfig.slice(0, 4).map(t => t.filePath).sort(), ['index.html', 'package.json', 'src/types.ts', 'vite.config.ts']);
for (const f of ['package.json', 'index.html', 'vite.config.ts']) {
  assert.deepEqual(withConfig.find(t => t.filePath === f)?.dependsOn ?? [], [], f);
}
assert.deepEqual(withConfig.find(t => t.filePath === 'src/main.tsx')?.dependsOn, ['src/types.ts', 'src/game.ts']);
// `*Panel.tsx` with "config" in its name is a component, not shared config
assert.deepEqual(
  ordered(['src/GameConfigPanel.tsx', 'src/game.ts']).map(t => t.filePath),
  ['src/game.ts', 'src/GameConfigPanel.tsx']
);
// d.ts, constants, utils
assert.deepEqual(
  ordered(['src/logic.ts', 'src/utils.ts', 'src/constants.ts', 'src/global.d.ts']).map(t => t.filePath),
  ['src/constants.ts', 'src/global.d.ts', 'src/utils.ts', 'src/logic.ts']
);

// Single-file steps and single-layer sets are returned as given
const single = [task({ filePath: 'src/App.tsx' })];
assert.equal(orderStepDispatchTasks(single), single);
const flat = [task({ filePath: 'src/a.ts' }), task({ filePath: 'src/b.ts' })];
assert.equal(orderStepDispatchTasks(flat), flat);
assert.deepEqual(orderStepDispatchTasks([]), []);

// Deterministic, input not mutated, no cycles, declared edges kept
const input = [
  task({ filePath: 'src/types.ts', dependsOn: ['src/logic.ts'] }),
  task({ filePath: 'src/logic.ts' }),
  task({ filePath: 'src/App.tsx' })
];
const snapshot = JSON.stringify(input);
const first = orderStepDispatchTasks(input);
assert.equal(JSON.stringify(input), snapshot);
assert.deepEqual(first, orderStepDispatchTasks(input));
const cyclic = waveFiles(first).flat();
assert.equal(cyclic.length, 3);
assert.deepEqual(first.find(t => t.filePath === 'src/types.ts')?.dependsOn, ['src/logic.ts']);
assert.ok(!first.find(t => t.filePath === 'src/logic.ts')?.dependsOn?.includes('src/types.ts'), 'no cycle added');
assert.deepEqual(first.find(t => t.filePath === 'src/App.tsx')?.dependsOn, ['src/types.ts', 'src/logic.ts']);

// Item E: the file the worker owns is shown whole when it fits, else patch-only
const ownedBody = `import x from 'x'\n${'const line = 1\n'.repeat(300)}// BUG_IN_MIDDLE\n${'const tail = 2\n'.repeat(300)}END_OF_FILE`;
assert.ok(ownedBody.length > 8000 && ownedBody.length < 12000);
const ownedPrompt = buildSwarmWorkerPrompt({
  task: task({ filePath: 'src/App.tsx', instructions: 'fix the bug' }),
  contractFile: 'SWARM.md',
  contractCode: '',
  siblingSummary: '',
  currentFileContent: ownedBody,
  userPrompt: 'brief',
  stack: 'typescript',
  tier: 'tight'
});
assert.ok(ownedPrompt.includes('BUG_IN_MIDDLE'), 'owned file is not cut by the sibling cap');
assert.ok(ownedPrompt.includes('END_OF_FILE'));
assert.doesNotMatch(ownedPrompt, /truncated/);
assert.doesNotMatch(ownedPrompt, /Partial view/);
assert.match(ownedPrompt, /one <edit_file path="src\/App.tsx"> hunk if the current file is shown/);
const hugeOwned = `HEAD_MARK\n${'x'.repeat(30000)}\nTAIL_MARK`;
const hugePrompt = buildSwarmWorkerPrompt({
  task: task({ filePath: 'src/App.tsx', instructions: 'fix the bug' }),
  contractFile: 'SWARM.md',
  contractCode: '',
  siblingSummary: '',
  currentFileContent: hugeOwned,
  userPrompt: 'brief',
  stack: 'typescript',
  tier: 'tight'
});
assert.match(hugePrompt, /Partial view/);
assert.match(hugePrompt, /Do NOT rewrite the whole file/);
assert.match(hugePrompt, /<read_file path="src\/App.tsx"\/>/);
assert.match(hugePrompt, /hunks only/);
assert.match(hugePrompt, /HEAD_MARK/);
assert.match(hugePrompt, /TAIL_MARK/);
assert.doesNotMatch(hugePrompt, /x{12000}/);
const customCap = buildSwarmWorkerPrompt({
  task: task({ filePath: 'src/App.tsx', instructions: 'fix the bug' }),
  contractFile: 'SWARM.md',
  contractCode: '',
  siblingSummary: '',
  currentFileContent: ownedBody,
  userPrompt: 'brief',
  stack: 'typescript',
  tier: 'tight',
  ownedFileMaxChars: 5000
});
assert.match(customCap, /Partial view/);
assert.doesNotMatch(customCap, /BUG_IN_MIDDLE/);

// Item D wiring: a dependency's real file is inlined for its consumer
const depPrompt = buildSwarmWorkerPrompt({
  task: task({ filePath: 'src/game/gameLogic.ts', dependsOn: ['src/game/types.ts'], instructions: 'logic' }),
  contractFile: 'SWARM.md',
  contractCode: '',
  siblingSummary: '',
  userPrompt: 'brief',
  stack: 'typescript',
  tier: 'tight',
  siblingFiles: [
    {
      path: 'src/game/types.ts',
      exports: ['export type Player = 1 | 2'],
      content: `export type Player = 1 | 2\n${'// pad\n'.repeat(300)}export type LAST_TYPE = string`
    }
  ]
});
assert.match(depPrompt, /DIRECT DEPENDENCIES/);
assert.match(depPrompt, /export type Player = 1 \| 2/);
assert.match(depPrompt, /LAST_TYPE/, 'a ~2 KB types file is inlined whole');
assert.match(depPrompt, /never redeclare their types/);

// Repair worker: partial windows never invite a whole-file rewrite
const longFile = Array.from({ length: 400 }, (_, i) => `line${i}${'x'.repeat(200)}`).join('\n');
const repairPartial = buildRepairWorkerPrompt({
  task: task({ filePath: 'src/App.tsx' }),
  contractFile: 'SWARM.md',
  contractCode: '',
  currentFileContent: longFile,
  tscErrors: 'src/App.tsx(200,1): error TS2322: nope',
  tier: 'wide'
});
assert.match(repairPartial, /Do not rewrite the whole file — only 81 of its 400 lines/);
const repairWhole = buildRepairWorkerPrompt({
  task: task({ filePath: 'src/App.tsx' }),
  contractFile: 'SWARM.md',
  contractCode: '',
  currentFileContent: 'a\nb\nc',
  tscErrors: 'src/App.tsx(2,1): error TS2322: nope',
  tier: 'wide'
});
assert.match(repairWhole, /write_file/);
assert.doesNotMatch(repairWhole, /Do not rewrite/);

// Leaf components are written before the containers that render them
const pieceBoard = ordered(['src/components/Board3D.tsx', 'src/components/Piece3D.tsx']);
assert.deepEqual(
  pieceBoard.map(t => t.filePath),
  ['src/components/Piece3D.tsx', 'src/components/Board3D.tsx']
);
assert.deepEqual(waveFiles(pieceBoard), [['src/components/Piece3D.tsx'], ['src/components/Board3D.tsx']]);
assert.deepEqual(pieceBoard[1].dependsOn, ['src/components/Piece3D.tsx']);
assert.deepEqual(pieceBoard[0].dependsOn ?? [], []);
// Two leaves (or two containers) have nothing to order: returned as given
const leaves = [task({ filePath: 'src/components/Piece3D.tsx' }), task({ filePath: 'src/components/HUD.tsx' })];
assert.equal(orderStepDispatchTasks(leaves), leaves);
// Reverse input order, the leaf still comes first
assert.deepEqual(
  ordered(['src/components/Piece3D.tsx', 'src/components/Board3D.tsx']).map(t => t.filePath),
  ['src/components/Piece3D.tsx', 'src/components/Board3D.tsx']
);

const connect4Step = [
  'src/game/gameLogic.ts',
  'src/components/Board3D.tsx',
  'src/components/Piece3D.tsx',
  'src/components/HUD.tsx',
  'src/App.tsx'
];
const connect4Parallel = ordered(connect4Step);
assert.deepEqual(waveFiles(connect4Parallel), [
  ['src/game/gameLogic.ts'],
  ['src/components/Piece3D.tsx', 'src/components/HUD.tsx'],
  ['src/components/Board3D.tsx'],
  ['src/App.tsx']
]);
const connect4Serial = orderStepDispatchTasks(
  connect4Step.map(filePath => task({ filePath })),
  { serial: true }
);
const serialPaths = connect4Serial.map(t => t.filePath);
assert.deepEqual(serialPaths, [
  'src/game/gameLogic.ts',
  'src/components/Piece3D.tsx',
  'src/components/HUD.tsx',
  'src/components/Board3D.tsx',
  'src/App.tsx'
]);
assert.deepEqual(waveFiles(connect4Serial), serialPaths.map(p => [p]));
connect4Serial.forEach((t, i) => assert.deepEqual(t.dependsOn ?? [], serialPaths.slice(0, i), t.filePath));
assert.deepEqual(
  orderStepDispatchTasks(connect4Step.map(filePath => task({ filePath })), { serial: true }),
  connect4Serial,
  'deterministic'
);

// Serial: flat sets chain in input order; config files lead; forward declared deps cannot cycle
const flatSerial = orderStepDispatchTasks([task({ filePath: 'src/a.ts' }), task({ filePath: 'src/b.ts' })], { serial: true });
assert.deepEqual(flatSerial.map(t => t.filePath), ['src/a.ts', 'src/b.ts']);
assert.deepEqual(flatSerial[1].dependsOn, ['src/a.ts']);
const cfgSerial = orderStepDispatchTasks(
  [task({ filePath: 'src/App.tsx' }), task({ filePath: 'package.json' }), task({ filePath: 'src/types.ts' })],
  { serial: true }
);
assert.deepEqual(cfgSerial.map(t => t.filePath), ['package.json', 'src/types.ts', 'src/App.tsx']);
const cycleSerial = orderStepDispatchTasks(
  [task({ filePath: 'src/a.ts', dependsOn: ['src/b.ts'] }), task({ filePath: 'src/b.ts', dependsOn: ['src/a.ts'] })],
  { serial: true }
);
assert.deepEqual(waveFiles(cycleSerial).flat().length, 2);
assert.equal(waveFiles(cycleSerial).length, 2);
const declaredSerial = orderStepDispatchTasks(
  [task({ filePath: 'src/a.ts', dependsOn: ['src/b.ts', 'external.ts'] }), task({ filePath: 'src/b.ts' })],
  { serial: true }
);
assert.deepEqual(declaredSerial.map(t => t.filePath), ['src/b.ts', 'src/a.ts']);
assert.deepEqual(declaredSerial[1].dependsOn, ['src/b.ts', 'external.ts']);
const oneSerial = [task({ filePath: 'src/a.ts' })];
assert.equal(orderStepDispatchTasks(oneSerial, { serial: true }), oneSerial);

assert.equal(shouldSerializeStepTasks(1, 3), true);
assert.equal(shouldSerializeStepTasks(0, 2), true);
assert.equal(shouldSerializeStepTasks(2, 3), false);
assert.equal(shouldSerializeStepTasks(2, 3, 'tight'), true);
assert.equal(shouldSerializeStepTasks(2, 3, 'wide'), false);
assert.equal(shouldSerializeStepTasks(1, 1), false);

// Repair packets carry the declarations the errors refer to
const piece3dFile = {
  path: 'src/components/Piece3D.tsx',
  content: `import { useRef } from 'react';\n\nexport interface Piece3DProps {\n  column: number;\n  row: number;\n  player: 1 | 2;\n}\n\nexport function Piece3D({ column, row, player }: Piece3DProps) {\n  const BODY_SECRET = useRef(1);\n  return null;\n}\n`
};
const board3dFile = {
  path: 'src/components/Board3D.tsx',
  content: `import { Piece3D } from './Piece3D';\nexport function Board3D() {\n  return <Piece3D position={[0, 0, 0]} player={1} />;\n}\n`
};
const gameLogicFile = {
  path: 'src/game/gameLogic.ts',
  content: `export type Cell = 0 | 1 | 2;\nexport function dropPieceAt(board: Cell[][], col: number): Cell[][] {\n  return board;\n}\n`
};
const projectFiles3 = [board3dFile, piece3dFile, gameLogicFile];
const ts2322 =
  "src/components/Board3D.tsx(3,18): error TS2322: Type '{ position: number[]; player: number; }' is not assignable to type 'IntrinsicAttributes & Piece3DProps'.\n  Property 'position' does not exist on type 'IntrinsicAttributes & Piece3DProps'.";
const refs2322 = referencedDeclarationsForErrors(ts2322, projectFiles3, { excludePaths: ['src/components/Board3D.tsx'] });
assert.deepEqual(refs2322.map(r => r.path), ['src/components/Piece3D.tsx']);
assert.match(refs2322[0].excerpt, /export interface Piece3DProps \{\n  column: number;/);
assert.match(refs2322[0].excerpt, /export function Piece3D\(\{ column, row, player \}: Piece3DProps\) \{ … \}/);
assert.doesNotMatch(refs2322[0].excerpt, /BODY_SECRET/);
// A file that declares nothing the errors name is not returned
assert.ok(!referencedDeclarationsForErrors(ts2322, [board3dFile], {}).length);
// Non-exported props interface is found by name
const hiddenProps = referencedDeclarationsForErrors(
  ts2322,
  [{ path: 'src/components/Piece3D.tsx', content: 'interface Piece3DProps {\n  player: number;\n}\nexport function Piece3D(p: Piece3DProps) {\n  return null;\n}\n' }],
  { excludePaths: ['src/components/Board3D.tsx'] }
);
assert.match(hiddenProps[0].excerpt, /interface Piece3DProps \{\n  player: number;/);

const ts2614 =
  "src/components/Board3D.tsx(1,10): error TS2614: Module '\"./Piece3D\"' has no exported member 'Piece3D'. Did you mean to use 'import Piece3D from \"./Piece3D\"' instead?";
const defaultPiece = {
  path: 'src/components/Piece3D.tsx',
  content: 'type Props = { player: number };\nexport default function Piece3D({ player }: Props) {\n  return null;\n}\n'
};
const refs2614 = referencedDeclarationsForErrors(ts2614, [board3dFile, defaultPiece, gameLogicFile], {
  excludePaths: ['src/components/Board3D.tsx']
});
assert.deepEqual(refs2614.map(r => r.path), ['src/components/Piece3D.tsx']);
assert.match(refs2614[0].excerpt, /export default function Piece3D\(\{ player \}: Props\) \{ … \}/);
assert.match(refs2614[0].excerpt, /type Props = \{ player: number \};/);

const ts2613 =
  "src/App.tsx(3,8): error TS2613: Module '\"D:/ws/src/components/Board3D\"' has no default export. Did you mean to use 'import { Board3D } from \"D:/ws/src/components/Board3D\"' instead?";
const refs2613 = referencedDeclarationsForErrors(ts2613, [piece3dFile, board3dFile, gameLogicFile], {
  excludePaths: ['src/App.tsx']
});
assert.equal(refs2613[0].path, 'src/components/Board3D.tsx');
assert.match(refs2613[0].excerpt, /export function Board3D\(\) \{ … \}/);
assert.ok(!refs2613.some(r => r.path === 'src/game/gameLogic.ts'));
const refs2613Win = referencedDeclarationsForErrors(
  "src/App.tsx(3,8): error TS2613: Module '\"D:\\ws\\src\\components\\Board3D\"' has no default export.",
  [{ ...board3dFile, path: 'src\\components\\Board3D.tsx' }, gameLogicFile]
);
assert.deepEqual(refs2613Win.map(r => r.path), ['src/components/Board3D.tsx']);

const ts2305 = "src/App.tsx(2,10): error TS2305: Module '\"./game/gameLogic\"' has no exported member 'dropPiece'.";
const refs2305 = referencedDeclarationsForErrors(ts2305, projectFiles3);
assert.deepEqual(refs2305.map(r => r.path), ['src/game/gameLogic.ts']);
assert.match(refs2305[0].excerpt, /export function dropPieceAt\(board: Cell\[\]\[\], col: number\): Cell\[\]\[\] \{ … \}/);
assert.match(refs2305[0].excerpt, /export type Cell = 0 \| 1 \| 2;/);

// Budget and no-match behaviour
assert.deepEqual(referencedDeclarationsForErrors('src/a.ts(1,1): error TS2322: x', projectFiles3), []);
assert.deepEqual(referencedDeclarationsForErrors('', projectFiles3), []);
const tinyRefs = referencedDeclarationsForErrors(ts2322, [piece3dFile], { maxChars: 120 });
assert.ok(tinyRefs.length === 1 && tinyRefs[0].excerpt.length + tinyRefs[0].path.length <= 120);

const repairRelated = buildRepairWorkerPrompt({
  task: task({ filePath: 'src/components/Board3D.tsx' }),
  contractFile: 'SWARM.md',
  contractCode: '',
  currentFileContent: Array.from({ length: 300 }, (_, i) => `line${i}${'x'.repeat(20)}`).join('\n'),
  tscErrors: 'src/components/Board3D.tsx(200,1): error TS2322: nope',
  tier: 'tight',
  relatedDeclarations: refs2322
});
assert.match(repairRelated, /### RELATED DECLARATIONS/);
assert.match(repairRelated, /#### src\/components\/Piece3D\.tsx/);
assert.match(repairRelated, /export interface Piece3DProps/);
assert.match(repairRelated, /Do not call read_file; everything needed is below\. Reply with edit_file hunks now\./);
assert.doesNotMatch(repairRelated, /<read_file/);
assert.ok(repairRelated.indexOf('RELATED DECLARATIONS') < repairRelated.indexOf('### WINDOWS'));
assert.doesNotMatch(repairPartial, /RELATED DECLARATIONS/);
assert.match(repairPartial, /<read_file path="src\/App\.tsx"\/> first/);
const repairHuge = buildRepairWorkerPrompt({
  task: task({ filePath: 'src/components/Board3D.tsx' }),
  contractFile: 'SWARM.md',
  contractCode: '',
  currentFileContent: 'a\nb',
  tscErrors: 'src/components/Board3D.tsx(1,1): error TS2322: nope',
  tier: 'tight',
  relatedDeclarations: [{ path: 'src/big.ts', excerpt: `export type Big = ${'x'.repeat(30000)};` }]
});
assert.ok(repairHuge.length < 12000, `repair packet ${repairHuge.length}`);

// Existing project modules reach the worker prompt (entry file integrates earlier steps)
const earlier = [
  { path: 'src/game/gameLogic.ts', content: 'export type Cell = 0 | 1 | 2;\nexport function dropPieceAt(b: Cell[][], c: number): Cell[][] {\n  return b;\n}\n' },
  { path: 'src/game/aiWorker.ts', content: 'export function bestMove(b: number[][]): number {\n  return 3;\n}\n' },
  { path: 'src/components/Board3D.tsx', content: 'export interface Board3DProps { board: number[][] }\nexport function Board3D(p: Board3DProps) {\n  return null;\n}\n' },
  { path: 'src/components/HUD.tsx', content: 'export function HUD() {\n  return null;\n}\n' }
];
const appExports = pickExistingProjectExports({
  taskPath: 'src/App.tsx',
  brief: 'Wire the 3D connect 4 game together',
  files: earlier,
  excludePaths: ['src/components/HUD.tsx'],
  maxChars: 3000
});
const appWorker = buildSwarmWorkerPrompt({
  task: task({ filePath: 'src/App.tsx', instructions: 'APP_TASK compose the game' }),
  contractFile: 'SWARM.md',
  contractCode: '',
  siblingSummary: '',
  userPrompt: 'brief',
  stack: 'typescript',
  tier: 'tight',
  siblingFiles: [{ path: 'src/components/HUD.tsx', exports: ['HUD'] }],
  existingProjectExports: [...appExports, { path: 'src/components/HUD.tsx', summary: 'export function HUD() { … }' }]
});
assert.match(appWorker, /### EXISTING PROJECT MODULES/);
assert.match(appWorker, /Import and use these modules\. Do not re-implement/);
assert.match(appWorker, /#### src\/game\/gameLogic\.ts/);
assert.match(appWorker, /export function dropPieceAt/);
assert.match(appWorker, /#### src\/components\/Board3D\.tsx/);
assert.match(appWorker, /export interface Board3DProps/);
assert.equal(appWorker.split('#### src/components/HUD.tsx').length - 1, 0, 'listed siblings are not repeated');
assert.ok(appWorker.indexOf('EXISTING PROJECT MODULES') < appWorker.indexOf('APP_TASK'));
assert.doesNotMatch(
  buildSwarmWorkerPrompt({
    task: task({ filePath: 'src/App.tsx' }),
    contractFile: 'SWARM.md',
    contractCode: '',
    siblingSummary: '',
    userPrompt: 'brief',
    existingProjectExports: [{ path: 'src/App.tsx', summary: 'own file' }, { path: 'a.ts', summary: '   ' }]
  }),
  /EXISTING PROJECT MODULES/
);

// Repair packets show the whole file when the tier's cap allows it, and never send the worker off to read
const boardBody = Array.from({ length: 438 }, (_, i) => `  const row${i} = ${i}; // ${'pad'.repeat(10)}`).join('\n');
assert.ok(boardBody.length > 8000 && boardBody.length < wholeFileCharLimit('standard'), 'fits standard only as a whole file');
const repairBoard = buildRepairWorkerPrompt({
  task: task({ filePath: 'src/components/Board3D.tsx' }),
  contractFile: 'SWARM.md',
  contractCode: '',
  currentFileContent: boardBody,
  tscErrors: 'src/components/Board3D.tsx(200,1): error TS2322: nope',
  tier: 'standard'
});
assert.match(repairBoard, /### CURRENT FILE \(complete, 438 lines/);
assert.match(repairBoard, /^1\|  const row0 = 0;/m);
assert.match(repairBoard, /^438\|/m);
assert.doesNotMatch(repairBoard, /read_file|### WINDOWS/);
assert.match(repairBoard, /edit_file/);
assert.doesNotMatch(repairBoard, /write_file/, 'a 400-line file is not rewritten whole');
const repairBoardRelated = buildRepairWorkerPrompt({
  task: task({ filePath: 'src/components/Board3D.tsx' }),
  contractFile: 'SWARM.md',
  contractCode: '',
  currentFileContent: boardBody,
  tscErrors: 'src/components/Board3D.tsx(200,1): error TS2322: nope',
  tier: 'standard',
  relatedDeclarations: refs2322
});
assert.match(repairBoardRelated, /### RELATED DECLARATIONS/);
assert.doesNotMatch(repairBoardRelated, /read_file/);
// A file beyond the tier cap keeps the windows
const hugeBody = Array.from({ length: 2000 }, (_, i) => `const v${i} = '${'y'.repeat(30)}';`).join('\n');
assert.ok(hugeBody.length > wholeFileCharLimit('standard'));
const repairHugeFile = buildRepairWorkerPrompt({
  task: task({ filePath: 'src/App.tsx' }),
  contractFile: 'SWARM.md',
  contractCode: '',
  currentFileContent: hugeBody,
  tscErrors: 'src/App.tsx(1000,1): error TS2322: nope',
  tier: 'standard'
});
assert.match(repairHugeFile, /### WINDOWS/);
assert.match(repairHugeFile, /Do not rewrite the whole file/);
// A small whole file may be rewritten with write_file
const repairSmallWhole = buildRepairWorkerPrompt({
  task: task({ filePath: 'src/App.tsx' }),
  contractFile: 'SWARM.md',
  contractCode: '',
  currentFileContent: Array.from({ length: 66 }, (_, i) => `line ${i}`).join('\n'),
  tscErrors: 'src/App.tsx(3,1): error TS2322: nope',
  tier: 'standard'
});
assert.match(repairSmallWhole, /complete <write_file path="src\/App\.tsx">/);
assert.doesNotMatch(repairSmallWhole, /read_file/);
assert.equal(numberedLines('a\r\nb\n'), '1|a\n2|b');

// Last-chance write packet
assert.ok(canForceWholeFile(boardBody, 'standard'));
assert.ok(!canForceWholeFile(hugeBody, 'standard'));
assert.ok(!canForceWholeFile(Array.from({ length: 700 }, () => 'x').join('\n'), 'wide'), 'over 600 lines');
const forced = buildForcedWritePrompt({
  filePath: 'src/components/Board3D.tsx',
  currentFileContent: 'export function Board3D() {\n  return null;\n}\n',
  tscErrors: 'src/components/Board3D.tsx(1,1): error TS2322: nope',
  tier: 'standard',
  relatedDeclarations: refs2322
});
assert.match(forced, /1\|export function Board3D\(\) \{/);
assert.match(forced, /### RELATED DECLARATIONS/);
assert.match(forced, /export interface Piece3DProps/);
assert.match(forced, /<edit_file path="src\/components\/Board3D\.tsx">/);
assert.match(forced, /<write_file path="src\/components\/Board3D\.tsx">/);
assert.doesNotMatch(forced, /<read_file/);
// Logic heal: the Reviewer note replaces the compiler errors and is not filtered as diagnostics.
const forcedLogic = buildForcedWritePrompt({
  filePath: 'src/components/Board3D.tsx',
  currentFileContent: 'export function Board3D() {\n  return null;\n}\n',
  tscErrors: '',
  reviewerNote: '1. Board3D never renders the pieces.\n2. onCellClick is not wired.',
  tier: 'standard'
});
assert.match(forcedLogic, /### REVIEWER NOTE/);
assert.match(forcedLogic, /2\. onCellClick is not wired\./);
assert.doesNotMatch(forcedLogic, /### ERRORS/);
assert.match(forcedLogic, /1\|export function Board3D\(\) \{/);
assert.doesNotMatch(forcedLogic, /<read_file/);

assert.deepEqual(
  pathsNamedInText("src/App.tsx(3,8): error TS2322: Property 'x' of Board3D; see src/types.ts", [
    'src/components/Board3D.tsx',
    'src/types.ts',
    'src/components/HUD.tsx',
    'a.ts'
  ]),
  ['src/components/Board3D.tsx', 'src/types.ts']
);

// Later waves see the signatures the earlier waves just wrote
const wavedBoard = {
  path: 'src/components/Board3D.tsx',
  content:
    "import { Piece3D } from './Piece3D';\nexport interface Board3DProps {\n  onCellClick: (col: number, layer: number) => void;\n}\nexport function Board3D({ onCellClick }: Board3DProps) {\n  const BODY_SECRET = 1;\n  return null;\n}\n"
};
const wavedUI = {
  path: 'src/components/GameUI.tsx',
  content: 'export interface GameUIProps {\n  score: number;\n}\nexport function GameUI(p: GameUIProps) {\n  return null;\n}\n'
};
const wavedAppTask = task({
  filePath: 'src/App.tsx',
  instructions: 'Compose the game.',
  requiredImports: ["import { Board3D } from './components/Board3D'"]
});
const appImports = alreadyWrittenDeclarations({
  task: wavedAppTask,
  currentFileContent: "import { Board3D } from './components/Board3D';\nexport default function App() {\n  return null;\n}\n",
  written: [wavedUI, wavedBoard, { path: 'src/App.tsx', content: 'export const SELF = 1;' }],
  tier: 'standard'
});
assert.deepEqual(appImports.map(d => d.path), ['src/components/Board3D.tsx'], 'only imported, never itself');
assert.match(appImports[0].excerpt, /onCellClick: \(col: number, layer: number\) => void;/);
assert.doesNotMatch(appImports[0].excerpt, /BODY_SECRET/);
// A new file is matched by what its task names
const appNew = alreadyWrittenDeclarations({
  task: wavedAppTask,
  written: [wavedUI, wavedBoard],
  tier: 'standard'
});
assert.deepEqual(appNew.map(d => d.path), ['src/components/Board3D.tsx']);
const appByText = alreadyWrittenDeclarations({
  task: task({ filePath: 'src/App.tsx', instructions: 'Render GameUI above the board.' }),
  written: [wavedUI, wavedBoard]
});
assert.deepEqual(appByText.map(d => d.path), ['src/components/GameUI.tsx']);
// Alias imports and a tiny tier budget
assert.deepEqual(
  alreadyWrittenDeclarations({
    task: task({ filePath: 'src/App.tsx' }),
    currentFileContent: "import { GameUI } from '@/components/GameUI';",
    written: [wavedUI, wavedBoard]
  }).map(d => d.path),
  ['src/components/GameUI.tsx']
);
assert.deepEqual(alreadyWrittenDeclarations({ task: wavedAppTask, written: [] }), []);
assert.deepEqual(alreadyWrittenDeclarations({ task: wavedAppTask, written: [wavedBoard], maxChars: 40 }), []);
const workerWithWritten = buildSwarmWorkerPrompt({
  task: wavedAppTask,
  contractFile: 'SWARM.md',
  contractCode: '',
  siblingSummary: '',
  userPrompt: 'brief',
  stack: 'typescript',
  tier: 'standard',
  alreadyWritten: appImports
});
assert.match(workerWithWritten, /### ALREADY WRITTEN THIS STEP \(match these signatures exactly\)/);
assert.match(workerWithWritten, /#### src\/components\/Board3D\.tsx/);
assert.match(workerWithWritten, /onCellClick: \(col: number, layer: number\) => void;/);
assert.doesNotMatch(
  buildSwarmWorkerPrompt({
    task: wavedAppTask,
    contractFile: 'SWARM.md',
    contractCode: '',
    siblingSummary: '',
    userPrompt: 'brief',
    alreadyWritten: []
  }),
  /ALREADY WRITTEN THIS STEP/
);

console.log('swarmContract.selftest ok');
