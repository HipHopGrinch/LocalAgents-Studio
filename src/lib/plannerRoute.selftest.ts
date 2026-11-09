/**
 * Run: npx --yes tsx src/lib/plannerRoute.selftest.ts
 */
import assert from 'node:assert/strict';
import { parseFinalReview, pickCapableReviewTarget, pickFinalSourceReviewTarget, reviewModelSizeB } from './continuationReview';
import { findLeadArchitect } from './swarmContract';
import { mergeSettings } from '../config/defaults';
import type { EndpointNode, HardwareProfile } from '../types';

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
  modelPrefs: { 'gemma4:12b': { numCtx: 65536 } },
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
assert.equal(fresh.swarmEnabled, true);
assert.equal(fresh.autoSelectEndpoint, true);
assert.equal(fresh.autoApplyWrites, true);
assert.equal(fresh.autoReview, true);
const kept = mergeSettings({ swarmEnabled: false, autoReview: false });
assert.equal(kept.swarmEnabled, false);
assert.equal(kept.autoReview, false);
assert.equal(kept.autoApplyWrites, true);

console.log('plannerRoute.selftest ok');
