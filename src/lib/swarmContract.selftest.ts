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
  partitionSwarmTasksIntoWaves,
  type SwarmManifest,
  type SwarmTask,
  groupTscErrorsByFile
} from './swarmContract';

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
  i === 0 ? 'ONLY_FIRST_LINE' : i === 99 ? 'ONLY_ERROR_LINE' : `l${i}`
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

console.log('swarmContract.selftest ok');
