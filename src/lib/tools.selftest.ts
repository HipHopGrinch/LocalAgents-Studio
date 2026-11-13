/**
 * Run: npx --yes tsx src/lib/tools.selftest.ts
 */
import assert from 'node:assert/strict';
import type { AgentPersona, ApprovedPlan, BenchmarkResult, EndpointNode, HardwareProfile, ToolCall } from '../types';
import { isFullGpuFit } from './modelFit';
import {
  applyEdits,
  buildSystemPrompt,
  buildVolatileContextBlock,
  formatToolResult,
  parseEditBlocks,
  continuationClosedWrite,
  parseResponse,
  pickBestModelForComplexity,
  pickFailoverTarget,
  rankModelsForWeight,
  routingActiveParamsB,
  truncatedWriteToolCall,
  hasUnclosedWrite,
  selectBestEndpointForTask
} from './tools';

const agent = (partial: Partial<AgentPersona> = {}): AgentPersona => ({
  id: 'planner',
  handle: 'planner',
  name: 'Planner',
  role: 'Planner',
  endpointId: 'dev',
  model: 'qwen2.5:32b',
  systemPrompt: 'You are the planner persona.',
  temperature: 0.2,
  numCtx: 8192,
  toolsEnabled: true,
  autoApproveWrites: true,
  autoApproveCommands: false,
  ...partial
});

const hw = (vramGB: number): HardwareProfile => ({
  cpu: 'cpu',
  gpu: 'gpu',
  vramGB,
  gpuBandwidthGBs: 400,
  ramGB: 64,
  ramBandwidthGBs: 50,
  reserveVramGB: 1,
  kvCacheType: 'f16'
});

function node(partial: Partial<EndpointNode> & Pick<EndpointNode, 'id' | 'name'>): EndpointNode {
  return {
    url: 'http://127.0.0.1:11434',
    hardware: hw(16),
    online: true,
    latency: 10,
    models: [],
    loaded: [],
    ...partial
  };
}

function bench(
  model: string,
  nodeId: string,
  evalTokPerSec: number,
  extra: Partial<BenchmarkResult> = {}
): BenchmarkResult {
  return {
    model,
    nodeId,
    evalTokens: 64,
    evalTokPerSec,
    promptTokens: 16,
    promptTokPerSec: extra.promptTokPerSec ?? evalTokPerSec,
    loadMs: 10,
    totalMs: 100,
    ...extra
  };
}

const dev = node({
  id: 'dev',
  name: 'Studio',
  isDevNode: true,
  url: 'http://127.0.0.1:11434'
});
const remote = node({
  id: 'remote',
  name: '1080 Ti',
  url: 'http://10.0.0.8:11434',
  activeModel: 'gemma4:e4b',
  models: [{ name: 'gemma4:e4b', size: 1, details: { parameter_size: '4B', family: 'gemma' } }],
  loaded: [{ name: 'gemma4:e4b', size: 1, sizeVram: 1 }]
});

const stableA = buildSystemPrompt(agent(), 'D:/proj', 'OVERVIEW-A', {
  stablePrefix: true,
  progressLog: 'log-a',
  nodes: [dev, remote],
  inferenceNodeId: 'remote',
  inferenceModel: 'qwen2.5:32b',
  projectContext: 'RULE never use var',
  planMode: true
});
const stableB = buildSystemPrompt(agent(), 'D:/proj', 'OVERVIEW-B', {
  stablePrefix: true,
  progressLog: 'log-b',
  nodes: [dev, remote],
  inferenceNodeId: 'dev',
  inferenceModel: 'qwen2.5:32b',
  projectContext: 'RULE never use var',
  planMode: true
});
assert.equal(stableA, stableB);
assert.match(stableA, /D:\/proj/);
assert.match(stableA, /RULE never use var/);
assert.match(stableA, /You are the planner persona/);
assert.doesNotMatch(stableA, /OVERVIEW-A/);
assert.doesNotMatch(stableA, /Date:/);
assert.doesNotMatch(stableA, /inferring on/);
assert.doesNotMatch(stableA, /Work log/);
assert.doesNotMatch(stableA, /Cluster inventory/);

const legacy = buildSystemPrompt(agent(), 'D:/proj', 'TREE-LEGACY', {
  progressLog: 'did the thing',
  nodes: [dev, remote],
  inferenceNodeId: 'remote',
  planMode: true
});
assert.match(legacy, /TREE-LEGACY/);
assert.match(legacy, /Date:/);
assert.match(legacy, /Work log/);
assert.match(legacy, /did the thing/);
assert.match(legacy, /inferring on/);
assert.match(legacy, /Cluster inventory/);

const plan: ApprovedPlan = {
  summary: 'PLAN_LOCK_MARKER checkers',
  chosenOptionId: '1',
  chosenOptionTitle: 'Native',
  chosenOptionDescription: 'Win32',
  allOptions: [],
  originalUserRequest: 'checkers',
  approvedAt: 1
};
const coder = agent({ id: 'coder', handle: 'coder', model: 'qwen2.5:32b' });
const stableCoder = buildSystemPrompt(coder, 'D:/proj', 'tree', {
  stablePrefix: true,
  approvedPlan: plan,
  planMode: false,
  reviewMode: false
});
assert.doesNotMatch(stableCoder, /PLAN_LOCK_MARKER/);
const legacyCoder = buildSystemPrompt(coder, 'D:/proj', 'tree', {
  approvedPlan: plan,
  planMode: false,
  reviewMode: false
});
assert.match(legacyCoder, /PLAN_LOCK_MARKER/);

const volatile = buildVolatileContextBlock({
  nodes: [dev, remote],
  inferenceNodeId: 'remote',
  includeInventory: true,
  fallbackNumCtx: 8192,
  progressLog: 'next: paint the board',
  overview: 'src/app.ts',
  approvedPlan: plan,
  date: '2099-01-01'
});
assert.match(volatile, /2099-01-01/);
assert.match(volatile, /inferring on/);
assert.match(volatile, /next: paint the board/);
assert.match(volatile, /src\/app.ts/);
assert.match(volatile, /Cluster inventory/);
assert.match(volatile, /PLAN_LOCK_MARKER/);

const smallVerdict = buildSystemPrompt(agent({ model: 'qwen2.5:7b' }), 'D:/proj', '', {
  stepVerdictMode: true,
  reviewMode: true,
  inferenceModel: 'qwen2.5:7b',
  stablePrefix: true
});
assert.equal((smallVerdict.match(/<step_verdict/g) || []).length, 1);
assert.doesNotMatch(smallVerdict, /needs verification/);
assert.ok(smallVerdict.indexOf('<step_verdict') > smallVerdict.indexOf('<read_file'));
assert.match(smallVerdict, /Required output \(last\)/);

const smallPlan = buildSystemPrompt(agent({ model: 'gemma4:e4b' }), 'D:/proj', '', {
  planMode: true,
  inferenceModel: 'gemma4:e4b'
});
assert.equal((smallPlan.match(/<plan_options/g) || []).length, 1);
assert.doesNotMatch(smallPlan, /<!DOCTYPE html>/);

const largeVerdict = buildSystemPrompt(agent({ model: 'qwen2.5:32b' }), 'D:/proj', '', {
  stepVerdictMode: true,
  inferenceModel: 'qwen2.5:32b'
});
assert.ok((largeVerdict.match(/<step_verdict/g) || []).length >= 2);
assert.match(largeVerdict, /needs verification/);

const lines = Array.from({ length: 80 }, (_, i) => {
  if (i === 0) return 'HEAD_LINE';
  if (i === 30) return 'MID_ONLY';
  if (i === 40) return 'error TS2322 boom';
  if (i === 79) return 'TAIL_LINE';
  return `row ${i}`;
});
const call: ToolCall = {
  id: 't',
  name: 'read_file',
  args: { path: 'src/a.ts' },
  status: 'done',
  result: lines.join('\n')
};
const capped = formatToolResult(call, { tier: 'tight' });
assert.match(capped, /HEAD_LINE/);
assert.match(capped, /TAIL_LINE/);
assert.match(capped, /error TS2322/);
assert.doesNotMatch(capped, /MID_ONLY/);
assert.match(capped, /lines omitted/);

const closed = parseResponse('<write_file path="a.ts">\nexport const a = 1;\n</write_file>', 'c1', false);
assert.equal(closed.toolCalls[0]?.name, 'write_file');
assert.match(closed.toolCalls[0]?.body || '', /export const a/);

const partial = '<write_file path="a.ts">\nexport const a = 1;\nconst rest = true;\n';
const refused = parseResponse(partial, 'p1', false, { expectedFilePath: 'a.ts' });
assert.equal(refused.toolCalls.length, 0);
const salvaged = parseResponse(partial, 'p2', false, {
  expectedFilePath: 'a.ts',
  allowUnclosedSalvage: true
});
assert.equal(salvaged.toolCalls[0]?.name, 'write_file');
assert.match(salvaged.toolCalls[0]?.body || '', /export const a/);
const stillOpen = partial;
assert.equal(continuationClosedWrite(partial, stillOpen), false);
assert.equal(continuationClosedWrite(partial, `${partial}</write_file>`), true);
const truncated = truncatedWriteToolCall(stillOpen, 'm1', 'a.ts');
assert.equal(truncated?.status, 'error');
assert.equal(truncated?.name, 'write_file');
assert.equal(truncated?.result, 'output truncated; file not written');
assert.equal(truncated?.args.path, 'a.ts');

const plain = parseEditBlocks('SEARCH\nline2\n=======\nLINE2\nREPLACE\n');
assert.equal(plain.length, 1);
assert.equal(plain[0].search, 'line2');
assert.equal(plain[0].replace, 'LINE2');

const diff = parseEditBlocks(
  '@@ -1,3 +1,3 @@\n function hello() {\n-  console.log("old");\n+  console.log("new");\n }\n'
);
assert.equal(diff.length, 1);
assert.match(diff[0].search, /console\.log\("old"\)/);
assert.match(diff[0].replace, /console\.log\("new"\)/);

const crlf = applyEdits('line1\r\nline2\r\nline3\r\n', 'SEARCH\nline2\n=======\nLINE2\nREPLACE');
assert.equal(crlf.applied, 1);
assert.match(crlf.content || '', /LINE2/);
assert.match(crlf.content || '', /\r\n/);

const appliedDiff = applyEdits(
  'function hello() {\n  console.log("old");\n}\n',
  '@@ -1,3 +1,3 @@\n function hello() {\n-  console.log("old");\n+  console.log("new");\n }\n'
);
assert.equal(appliedDiff.applied, 1);
assert.match(appliedDiff.content || '', /console\.log\("new"\)/);

const missed = applyEdits(
  ['alpha', 'beta', 'gamma unique', 'delta', 'epsilon', 'zeta', 'eta', 'theta'].join('\n'),
  '<<<<<<< SEARCH\ngamma uniqe\n=======\nGAMMA\n>>>>>>> REPLACE'
);
assert.match(missed.error || '', /Nearest lines at offset/);
assert.match(missed.error || '', /gamma unique/);

const card = node({
  id: 'card',
  name: '5070',
  hardware: hw(12),
  modelPrefs: { 'gemma4:31b': { numCtx: 8192 }, 'gemma4:e2b': { numCtx: 8192 } },
  models: [
    { name: 'gemma4:31b', size: 20.39e9, details: { parameter_size: '31B', family: 'gemma' } },
    { name: 'gemma4:e2b', size: 2e9, details: { parameter_size: '2B', family: 'gemma' } }
  ]
});
assert.equal(isFullGpuFit(card, 'gemma4:31b'), false);
assert.equal(isFullGpuFit(card, 'gemma4:e2b'), true);
assert.equal(rankModelsForWeight([card], 'heavy', { role: 'coder' })?.model, 'gemma4:e2b');

const moe = node({
  id: 'moe',
  name: 'wide',
  hardware: hw(48),
  modelPrefs: { 'qwen3:30b': { numCtx: 4096 }, 'qwen2.5-coder:14b': { numCtx: 4096 } },
  models: [
    { name: 'qwen3:30b', size: 18.56e9, details: { parameter_size: '30B' } },
    { name: 'qwen2.5-coder:14b', size: 8.99e9, details: { parameter_size: '14.8B' } }
  ]
});
assert.equal(routingActiveParamsB(moe, 'qwen3:30b'), 3.3);
assert.ok(routingActiveParamsB(moe, 'qwen2.5-coder:14b') > 10);
assert.equal(isFullGpuFit(moe, 'qwen3:30b'), true);
assert.equal(isFullGpuFit(moe, 'qwen2.5-coder:14b'), true);
assert.equal(rankModelsForWeight([moe], 'heavy', { role: 'coder' })?.model, 'qwen2.5-coder:14b');

const measured = node({
  id: 'measured',
  name: 'measured',
  hardware: hw(24),
  benchmarks: { 'gemma4:12b': bench('gemma4:12b', 'measured', 20, { promptTokPerSec: 10 }) },
  models: [{ name: 'gemma4:12b', size: 8.02e9, details: { parameter_size: '12B' } }]
});
const guessed = node({
  id: 'guessed',
  name: 'guessed',
  hardware: { ...hw(24), gpuBandwidthGBs: 2000 },
  benchmarks: {
    'gemma4:12b': bench('gemma4:12b', 'guessed', 400, { provisional: true, promptTokPerSec: 400 })
  },
  models: [{ name: 'gemma4:12b', size: 8.02e9, details: { parameter_size: '12B' } }]
});
assert.equal(rankModelsForWeight([guessed, measured], 'heavy', { role: 'coder' })?.node.id, 'measured');

const prefillSlow = node({
  id: 'prefill-slow',
  name: 'slow prefill',
  benchmarks: { 'gemma4:12b': bench('gemma4:12b', 'prefill-slow', 20, { promptTokPerSec: 10 }) },
  models: [{ name: 'gemma4:12b', size: 1, details: { parameter_size: '12B' } }]
});
const prefillFast = node({
  id: 'prefill-fast',
  name: 'fast prefill',
  benchmarks: { 'gemma4:12b': bench('gemma4:12b', 'prefill-fast', 20, { promptTokPerSec: 90 }) },
  models: [{ name: 'gemma4:12b', size: 1, details: { parameter_size: '12B' } }]
});
assert.equal(
  rankModelsForWeight([prefillSlow, prefillFast], 'heavy', { role: 'planner' })?.node.id,
  'prefill-fast'
);
assert.equal(
  rankModelsForWeight([prefillSlow, prefillFast], 'heavy', { role: 'reviewer' })?.node.id,
  'prefill-fast'
);

const pinned = node({
  id: 'pinned',
  name: 'pinned',
  activeModel: 'gemma4:12b',
  benchmarks: {
    'gemma4:12b': bench('gemma4:12b', 'pinned', 12),
    'gemma4:e2b': bench('gemma4:e2b', 'pinned', 200)
  },
  models: [
    { name: 'gemma4:12b', size: 1, details: { parameter_size: '12B' } },
    { name: 'gemma4:e2b', size: 1, details: { parameter_size: '2B' } }
  ]
});
assert.equal(pickBestModelForComplexity(pinned, 'light'), 'gemma4:12b');
const resident = {
  ...pinned,
  loaded: [{ name: 'gemma4:e2b', size: 1, sizeVram: 1 }]
};
assert.equal(pickBestModelForComplexity(resident, 'light'), 'gemma4:12b');
const unpinnedResident = {
  ...resident,
  activeModel: undefined
};
assert.equal(pickBestModelForComplexity(unpinnedResident, 'light'), 'gemma4:e2b');

const moeLight = node({
  id: 'moe-light',
  name: 'wide',
  hardware: hw(48),
  modelPrefs: { 'qwen3:30b': { numCtx: 4096 }, 'qwen2.5-coder:7b': { numCtx: 4096 } },
  models: [
    { name: 'qwen3:30b', size: 18.56e9, details: { parameter_size: '30B' } },
    { name: 'qwen2.5-coder:7b', size: 4.68e9, details: { parameter_size: '7.6B' } }
  ]
});
assert.equal(pickBestModelForComplexity(moeLight, 'light'), 'qwen2.5-coder:7b');

const failed = node({ id: 'failed', name: 'down', online: false });
const warm = node({
  id: 'warm',
  name: 'warm',
  models: [{ name: 'gemma4:e2b', size: 2e9, details: { parameter_size: '2B' } }],
  loaded: [{ name: 'gemma4:e2b', size: 1, sizeVram: 1 }],
  benchmarks: { 'gemma4:e2b': bench('gemma4:e2b', 'warm', 30) }
});
const cold = node({
  id: 'cold',
  name: 'cold',
  models: [{ name: 'gemma4:e2b', size: 2e9, details: { parameter_size: '2B' } }],
  benchmarks: { 'gemma4:e2b': bench('gemma4:e2b', 'cold', 80) }
});
assert.equal(pickFailoverTarget([failed, cold, warm], 'failed', 'gemma4:e2b')?.node.id, 'warm');

const spill = node({
  id: 'spill',
  name: 'spill',
  hardware: hw(6),
  models: [{ name: 'gemma4:12b', size: 20e9, details: { parameter_size: '12B' } }],
  loaded: [{ name: 'gemma4:12b', size: 1, sizeVram: 1 }]
});
const fits = node({
  id: 'fits',
  name: 'fits',
  hardware: hw(24),
  models: [{ name: 'gemma4:12b', size: 8.02e9, details: { parameter_size: '12B' } }]
});
assert.equal(isFullGpuFit(spill, 'gemma4:12b'), false);
assert.equal(isFullGpuFit(fits, 'gemma4:12b'), true);
assert.equal(pickFailoverTarget([spill, fits], 'gone', 'gemma4:12b')?.node.id, 'fits');

const docsOnly = node({
  id: 'docs-only',
  name: 'docs',
  roles: ['docs'],
  hardware: hw(24),
  models: [{ name: 'gemma4:e2b', size: 2e9, details: { parameter_size: '2B' } }]
});
assert.equal(pickFailoverTarget([docsOnly], 'gone', 'gemma4:e2b', { role: 'coder' }), undefined);

const spillOnly = node({
  id: 'spill-only',
  name: 'spill-only',
  hardware: hw(6),
  models: [{ name: 'gemma4:12b', size: 20e9, details: { parameter_size: '12B' } }],
  loaded: [{ name: 'gemma4:12b', size: 1, sizeVram: 1 }]
});
const fitOther = node({
  id: 'fit-other',
  name: 'fit-other',
  hardware: hw(16),
  models: [{ name: 'gemma4:e2b', size: 2e9, details: { parameter_size: '2B' } }]
});
const avoidedSpill = pickFailoverTarget([spillOnly, fitOther], 'gone', 'gemma4:12b', { role: 'coder' });
assert.equal(avoidedSpill?.node.id, 'fit-other');
assert.equal(avoidedSpill?.model, 'gemma4:e2b');
const partialFit = pickFailoverTarget([spillOnly], 'gone', 'gemma4:12b');
assert.equal(partialFit?.node.id, 'spill-only');
assert.equal(partialFit?.model, 'gemma4:12b');

// B-22: routing uses the real size of dense qwen3 tags, not the MoE active params
const denseNode = node({
  id: 'dense',
  name: 'dense',
  hardware: hw(48),
  models: [
    { name: 'qwen3:32b', size: 20e9, details: { parameter_size: '32B' } },
    { name: 'qwen3:4b', size: 2.6e9, details: { parameter_size: '4B' } }
  ]
});
assert.ok(Math.abs(routingActiveParamsB(denseNode, 'qwen3:32b') - 32) < 0.5);
assert.ok(Math.abs(routingActiveParamsB(denseNode, 'qwen3:4b') - 4) < 0.5);
assert.equal(rankModelsForWeight([denseNode], 'heavy', { role: 'coder' })?.model, 'qwen3:32b');

// B-23: coder turns ignore the quick/css keyword shortcuts
const archNode = node({
  id: 'arch',
  name: 'arch',
  specialty: 'architect',
  hardware: hw(16),
  models: [{ name: 'qwen2.5-coder:14b', size: 9e9, details: { parameter_size: '14.8B' } }]
});
const scoutNode = node({
  id: 'scout',
  name: 'scout',
  specialty: 'scout',
  hardware: hw(8),
  models: [{ name: 'qwen2.5-coder:7b', size: 4.7e9, details: { parameter_size: '7.6B' } }]
});
assert.equal(selectBestEndpointForTask('quick fix the css color', 'coder', [archNode, scoutNode])?.id, 'arch');
assert.equal(selectBestEndpointForTask('quick fix the css color', '', [archNode, scoutNode])?.id, 'scout');

// B-24: tool tags are case-insensitive
const upperTag = parseResponse('<Write_file path="a.ts">x</Write_file>', 'm-upper');
assert.equal(upperTag.toolCalls.length, 1);
assert.equal(upperTag.toolCalls[0].name, 'write_file');
assert.equal(parseResponse('<RUN_COMMAND>npm test</RUN_COMMAND>', 'm-cmd').toolCalls[0]?.name, 'run_command');
assert.deepEqual(hasUnclosedWrite('<WRITE_FILE path="a.ts">partial'), { name: 'write_file', path: 'a.ts' });

// B-25: tags inside a closed body and self-closing tags are not truncation
const readmeBody = '<write_file path="README.md">\nUse <write_file path="a.ts"> to create files.\n</write_file>';
assert.equal(parseResponse(readmeBody, 'm-readme').toolCalls.length, 1);
assert.equal(hasUnclosedWrite(readmeBody), null);
assert.equal(hasUnclosedWrite('<write_file path="x"/>'), null);
assert.deepEqual(
  hasUnclosedWrite('<write_file path="a.ts">ok</write_file>\n<write_file path="b.ts">cut'),
  { name: 'write_file', path: 'b.ts' }
);

console.log('tools.selftest ok');
