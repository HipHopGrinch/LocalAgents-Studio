/**
 * Run: npx --yes tsx src/lib/plannerRoute.selftest.ts
 */
import assert from 'node:assert/strict';
import { liveRoutePin, parseFinalReview, pickCapableReviewTarget, pickFinalSourceReviewTarget, reviewModelSizeB } from './continuationReview';
import { assignSwarmTasksToCluster, findLeadArchitect, type SwarmTask } from './swarmContract';
import { findFastestConductor, pickBestModelForComplexity, pickFailoverTarget, selectBestEndpointForTask } from './tools';
import { mergeSettings, MIN_CHAT_WIDTH } from '../config/defaults';
import type { BenchmarkResult, EndpointNode, HardwareProfile } from '../types';

const hw = (vramGB: number): HardwareProfile => ({
  cpu: 'cpu',
  gpu: 'gpu',
  vramGB,
  gpuBandwidthGBs: 400,
  ramGB: 32,
  ramBandwidthGBs: 50,
  reserveVramGB: 1,
  kvCacheType: 'f16'
});

function node(partial: Partial<EndpointNode> & Pick<EndpointNode, 'id' | 'name'>): EndpointNode {
  return {
    url: 'http://127.0.0.1:11434',
    hardware: hw(8),
    online: true,
    latency: 10,
    models: [],
    loaded: [],
    ...partial
  };
}

assert.equal(reviewModelSizeB('gemma4:12b'), 12);
assert.equal(reviewModelSizeB('gemma4:e4b'), 4);
assert.equal(reviewModelSizeB('gemma4:e2b'), 2);
assert.equal(reviewModelSizeB('weird-tag', '12B'), 12);

const big = node({
  id: 'rig',
  name: '5070',
  hardware: hw(8),
  modelPrefs: { 'gemma4:12b': { numCtx: 16384 } },
  models: [{ name: 'gemma4:12b', size: 1, details: { parameter_size: '12B', family: 'gemma' } }]
});
const mid = node({
  id: '1080',
  name: '1080ti',
  hardware: hw(16),
  modelPrefs: { 'gemma4:e4b': { numCtx: 65536 } },
  models: [{ name: 'gemma4:e4b', size: 1, details: { parameter_size: '4B', family: 'gemma' } }]
});
const laptop = node({
  id: 'laptop',
  name: 'laptop 3060',
  hardware: hw(6),
  modelPrefs: { 'gemma4:e2b': { numCtx: 16384 } },
  models: [{ name: 'gemma4:e2b', size: 1, details: { parameter_size: '2B', family: 'gemma' } }]
});
const frontier = node({
  id: 'cloud',
  name: 'Gemini',
  type: 'openai',
  apiKey: 'k',
  roles: ['planner'],
  hardware: hw(0),
  models: [{ name: 'gemini-2.5-flash-lite', size: 1 }]
});

const cluster = [laptop, mid, big, frontier];
const reviewer = pickCapableReviewTarget(cluster, 'reviewer');
assert.equal(reviewer?.model, 'gemma4:12b');
assert.equal(reviewer?.node.id, 'rig');
const planner = pickCapableReviewTarget(cluster, 'planner');
assert.equal(planner?.model, 'gemma4:12b');

const lead = findLeadArchitect(cluster);
assert.equal(lead?.model, 'gemma4:12b');
assert.equal(lead?.usedFrontierBackup, false);

// A 12B pinned at 64k on an 8 GB card spills to system RAM, so the largest model that fits wins.
const spilling = { ...big, modelPrefs: { 'gemma4:12b': { numCtx: 65536 } } };
assert.equal(pickCapableReviewTarget([laptop, mid, spilling], 'reviewer')?.model, 'gemma4:e4b');

const plannerOnly = node({
  id: 'plan',
  name: 'planner box',
  roles: ['planner'],
  hardware: hw(8),
  models: [{ name: 'gemma4:12b', size: 1, details: { parameter_size: '12B' } }]
});
const reviewerOnly = node({
  id: 'rev',
  name: 'review box',
  roles: ['reviewer'],
  hardware: hw(24),
  models: [{ name: 'gemma4:e2b', size: 1, details: { parameter_size: '2B' } }]
});
assert.equal(pickCapableReviewTarget([plannerOnly, reviewerOnly], 'planner')?.model, 'gemma4:12b');
assert.equal(pickCapableReviewTarget([plannerOnly, reviewerOnly], 'reviewer')?.model, 'gemma4:e2b');

const finalPick = pickFinalSourceReviewTarget(cluster);
assert.equal(finalPick?.node.id, 'cloud');
assert.equal(finalPick?.model, 'gemini-2.5-flash-lite');
const localOnly = pickFinalSourceReviewTarget([laptop, mid, big]);
assert.equal(localOnly?.model, 'gemma4:12b');
assert.equal(parseFinalReview('<final_review><result>pass</result><notes>Matches the plan.</notes></final_review>')?.result, 'pass');
assert.equal(
  parseFinalReview('<final_review><result>issues</result><notes>App.tsx is not wired.</notes></final_review>')?.result,
  'issues'
);

const fresh = mergeSettings(null);
assert.equal(fresh.swarmEnabled, false);
assert.equal(fresh.autoSelectEndpoint, false);
assert.equal(fresh.autoApplyWrites, false);
assert.equal(fresh.autoReview, false);
assert.equal(fresh.cloudStrategistEnabled, false);
assert.ok((fresh.chatWidth ?? 0) >= MIN_CHAT_WIDTH);
const keptOff = mergeSettings({ swarmEnabled: false, autoReview: false });
assert.equal(keptOff.swarmEnabled, false);
assert.equal(keptOff.autoReview, false);
assert.equal(keptOff.autoApplyWrites, false);
assert.equal(keptOff.autoSelectEndpoint, false);
assert.equal(keptOff.cloudStrategistEnabled, false);
const keptOn = mergeSettings({
  swarmEnabled: true,
  autoSelectEndpoint: true,
  autoApplyWrites: true,
  autoReview: true,
  cloudStrategistEnabled: true,
  chatWidth: 1100
});
assert.equal(keptOn.swarmEnabled, true);
assert.equal(keptOn.autoSelectEndpoint, true);
assert.equal(keptOn.autoApplyWrites, true);
assert.equal(keptOn.autoReview, true);
assert.equal(keptOn.cloudStrategistEnabled, true);
assert.equal(keptOn.chatWidth, 1100);
assert.equal(mergeSettings({ chatWidth: 400 }).chatWidth, MIN_CHAT_WIDTH);

function bench(model: string, nodeId: string, evalTokPerSec: number): BenchmarkResult {
  return {
    model,
    nodeId,
    evalTokens: 64,
    evalTokPerSec,
    promptTokens: 16,
    promptTokPerSec: evalTokPerSec,
    loadMs: 10,
    totalMs: 100
  };
}

function swarmFile(filePath: string, complexity: SwarmTask['complexity']): SwarmTask {
  return {
    filePath,
    complexity,
    preferredRole: '@coder',
    requiredExports: [],
    requiredImports: [],
    instructions: filePath
  };
}

// 5070 12B is the slowest card. Routing must still give it planner, reviewer, and heavy work.
const slow12 = node({
  id: 'rig',
  name: '5070',
  hardware: { ...hw(16), gpuBandwidthGBs: 40 },
  benchmarks: { 'gemma4:12b': bench('gemma4:12b', 'rig', 12) },
  models: [{ name: 'gemma4:12b', size: 1, details: { parameter_size: '12B', family: 'gemma' } }]
});
const fast4 = node({
  id: '1080',
  name: '1080ti',
  hardware: { ...hw(11), gpuBandwidthGBs: 480 },
  benchmarks: { 'gemma4:e4b': bench('gemma4:e4b', '1080', 90) },
  models: [{ name: 'gemma4:e4b', size: 1, details: { parameter_size: '4B', family: 'gemma' } }]
});
const fastest2 = node({
  id: 'laptop',
  name: 'laptop 3060',
  hardware: { ...hw(6), gpuBandwidthGBs: 900 },
  benchmarks: { 'gemma4:e2b': bench('gemma4:e2b', 'laptop', 140) },
  models: [{ name: 'gemma4:e2b', size: 1, details: { parameter_size: '2B', family: 'gemma' } }]
});
const speedTrap = [fastest2, fast4, slow12];

assert.equal(pickCapableReviewTarget(speedTrap, 'planner')?.model, 'gemma4:12b');
assert.equal(pickCapableReviewTarget(speedTrap, 'reviewer')?.node.id, 'rig');
assert.equal(findLeadArchitect(speedTrap)?.model, 'gemma4:12b');
assert.equal(findFastestConductor(speedTrap)?.model, 'gemma4:12b');
assert.equal(selectBestEndpointForTask('implement the game loop', 'coder', speedTrap)?.id, 'rig');

const heavyAssign = assignSwarmTasksToCluster([swarmFile('src/game.ts', 'high')], speedTrap);
assert.equal(heavyAssign[0]?.model, 'gemma4:12b');
assert.equal(heavyAssign[0]?.node.id, 'rig');
const mediumAssign = assignSwarmTasksToCluster([swarmFile('src/state.ts', 'medium')], speedTrap);
assert.equal(mediumAssign[0]?.model, 'gemma4:12b');
const lightAssign = assignSwarmTasksToCluster([swarmFile('src/theme.css', 'low')], speedTrap);
assert.equal(lightAssign[0]?.model, 'gemma4:e2b');
assert.equal(lightAssign[0]?.node.id, 'laptop');

const sameCard = node({
  id: 'both',
  name: '5070',
  benchmarks: {
    'gemma4:12b': bench('gemma4:12b', 'both', 12),
    'gemma4:e2b': bench('gemma4:e2b', 'both', 200)
  },
  models: [
    { name: 'gemma4:12b', size: 1, details: { parameter_size: '12B' } },
    { name: 'gemma4:e2b', size: 1, details: { parameter_size: '2B' } }
  ]
});
assert.equal(pickBestModelForComplexity(sameCard, 'heavy'), 'gemma4:12b');
assert.equal(pickBestModelForComplexity(sameCard, 'medium'), 'gemma4:12b');
assert.equal(pickBestModelForComplexity(sameCard, 'light'), 'gemma4:e2b');

const disabled12 = { ...slow12, disabledModels: ['gemma4:12b'], activeModel: undefined };
const disabledCluster = [disabled12, fast4, fastest2];
assert.equal(pickCapableReviewTarget(disabledCluster, 'reviewer')?.model, 'gemma4:e4b');
assert.equal(pickCapableReviewTarget(disabledCluster, 'planner')?.node.id, '1080');
assert.equal(findFastestConductor(disabledCluster)?.model, 'gemma4:e4b');
assert.equal(
  assignSwarmTasksToCluster([swarmFile('src/game.ts', 'high')], disabledCluster)[0]?.model,
  'gemma4:e4b'
);
assert.equal(
  liveRoutePin(disabledCluster, { node: slow12, model: 'gemma4:12b' }, 'coder')?.model,
  'gemma4:e4b'
);
// Enabling the 12B again makes it eligible for the next heavy / planner route.
assert.equal(
  liveRoutePin(speedTrap, { node: fastest2, model: 'gemma4:e2b' }, 'reviewer')?.model,
  'gemma4:12b'
);
assert.equal(
  liveRoutePin(cluster, { node: frontier, model: 'gemini-2.5-flash-lite' }, 'reviewer')?.model,
  'gemini-2.5-flash-lite'
);

const offline12 = { ...slow12, online: false };
const offlineCluster = [offline12, fast4, fastest2];
assert.equal(pickCapableReviewTarget(offlineCluster, 'planner')?.model, 'gemma4:e4b');
assert.equal(selectBestEndpointForTask('heal the compile errors', 'coder', offlineCluster)?.id, '1080');
assert.equal(
  assignSwarmTasksToCluster([swarmFile('src/game.ts', 'high')], offlineCluster)[0]?.node.id,
  '1080'
);
// The 12B card coming back online is eligible without a restart.
assert.equal(pickCapableReviewTarget(speedTrap, 'reviewer')?.node.id, 'rig');

const docsOnly = node({
  id: 'docs-only',
  name: 'docs',
  roles: ['docs'],
  hardware: hw(24),
  models: [{ name: 'gemma4:12b', size: 1, details: { parameter_size: '12B' } }]
});
assert.equal(pickFailoverTarget([docsOnly, big], 'gone', 'gemma4:12b', { role: 'planner' })?.node.id, 'rig');
const spillPlanner = node({
  id: 'spill-planner',
  name: 'spill',
  hardware: hw(6),
  roles: ['planner'],
  models: [{ name: 'gemma4:12b', size: 20e9, details: { parameter_size: '12B' } }],
  loaded: [{ name: 'gemma4:12b', size: 1, sizeVram: 1 }]
});
const fitPlanner = node({
  id: 'fit-planner',
  name: 'fit',
  hardware: hw(16),
  roles: ['planner'],
  models: [{ name: 'gemma4:e2b', size: 2e9, details: { parameter_size: '2B' } }]
});
assert.equal(
  pickFailoverTarget([spillPlanner, fitPlanner], 'gone', 'gemma4:12b', { role: 'planner' })?.model,
  'gemma4:e2b'
);

console.log('plannerRoute.selftest ok');
