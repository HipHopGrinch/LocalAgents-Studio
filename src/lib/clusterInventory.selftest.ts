/**
 * Run: npx --yes tsx src/lib/clusterInventory.selftest.ts
 */
import assert from 'node:assert/strict';
import {
  buildModelFitSection,
  fileContextCapsForTier,
  formatClusterInventory,
  modelFitTier,
  resolveModelFit,
  resolveReviewerFileCaps,
  roomyFileCaps
} from './clusterInventory';
import type { EndpointNode } from '../types';

assert.equal(modelFitTier('gemma4:e4b', 16384), 'tight');
assert.equal(modelFitTier('qwen2.5:7b', 16384), 'tight');
assert.equal(modelFitTier('qwen2.5:32b', 32768), 'standard');
assert.equal(modelFitTier('qwen2.5:32b', 65536), 'wide');
assert.equal(modelFitTier('llama3.1:70b', 131072), 'wide');
assert.notEqual(modelFitTier('mixtral:8x7b', 32768), 'tight');
assert.equal(modelFitTier('mixtral:8x22b', 65536), 'wide');
assert.equal(modelFitTier('mixtral:8x7b', 16384), 'tight');
assert.equal(modelFitTier('qwen2.5:7b', 32768), 'standard');
assert.equal(modelFitTier('qwen2.5:7b', 0), 'tight');
// Frontier: never tight even if Studio once fell back to 16k
assert.equal(modelFitTier('gpt-4o', 16384), 'standard');
assert.equal(modelFitTier('gemini-2.5-flash-lite', 16384), 'standard');
assert.equal(modelFitTier('gemini-2.0-flash-lite', 262144), 'wide');
assert.equal(modelFitTier('gpt-4o', 128000), 'wide');

import {
  DEFAULT_FRONTIER_NUM_CTX,
  resolveModelNumCtx
} from './contextSize';

const frontierNode = {
  type: 'openai' as const,
  apiKey: 'x',
  modelPrefs: {}
};
assert.equal(
  resolveModelNumCtx(frontierNode, 'gemini-2.5-flash-lite', 16384),
  DEFAULT_FRONTIER_NUM_CTX
);
assert.equal(DEFAULT_FRONTIER_NUM_CTX, 262144);

const tightCaps = fileContextCapsForTier('tight');
assert.ok(tightCaps.maxTotalChars < fileContextCapsForTier('standard').maxTotalChars);
assert.ok(fileContextCapsForTier('wide').maxTotalChars >= 64000);

const node = {
  id: 'n1',
  name: 'Local GPU',
  url: 'http://127.0.0.1:11434',
  online: true,
  latency: 12,
  roles: ['coder', 'planner'],
  isDevNode: true,
  hardware: {
    cpu: '',
    gpu: 'RTX',
    vramGB: 24,
    gpuBandwidthGBs: 0,
    ramGB: 64,
    ramBandwidthGBs: 0,
    reserveVramGB: 1,
    kvCacheType: 'f16'
  },
  models: [
    {
      name: 'gemma4:e4b',
      size: 1,
      details: { family: 'gemma', parameter_size: '4B' }
    }
  ],
  loaded: [{ name: 'gemma4:e4b', size: 1, sizeVram: 1 }],
  activeModel: 'gemma4:e4b',
  modelPrefs: { 'gemma4:e4b': { numCtx: 16384 } },
  disabledModels: []
} as EndpointNode;

const inv = formatClusterInventory([node], { fallbackNumCtx: 16384 });
assert.match(inv, /Cluster inventory/);
assert.match(inv, /Local GPU/);
assert.match(inv, /roles: coder, planner/);
assert.match(inv, /gemma4:e4b/);
assert.match(inv, /max ctx 16384/);
assert.match(inv, /\[active\]/);
assert.match(inv, /\[loaded\]/);

const fit = resolveModelFit(node, 'gemma4:e4b', 'coder', 32768);
assert.equal(fit.tier, 'tight');
assert.equal(fit.maxCtx, 16384);
assert.match(fit.section, /MODEL FIT/);
assert.match(fit.section, /gemma4:e4b/);
assert.match(fit.section, /16384/);
assert.ok(fit.packingLine);

const section = buildModelFitSection({
  model: 'qwen2.5:32b',
  nodeName: 'Big',
  role: 'coder',
  maxCtx: 65536,
  tier: 'wide'
});
assert.match(section, /wide context/);

// Frontier window: whole files, not local-tier truncation
const roomy = roomyFileCaps(262144);
assert.ok(roomy);
assert.ok(roomy.maxCharsPerFile >= 60000, `per-file ${roomy.maxCharsPerFile}`);
const frontierBudgetChars = Math.floor((262144 - 2048 - 256) * 3.2);
assert.ok(
  roomy.maxTotalChars >= frontierBudgetChars * 0.45 && roomy.maxTotalChars <= frontierBudgetChars * 0.55,
  `total ${roomy.maxTotalChars}`
);
assert.equal(roomyFileCaps(65536), null);
assert.deepEqual(fileContextCapsForTier('wide'), fileContextCapsForTier('wide', 65536));
assert.deepEqual(fileContextCapsForTier('tight', 16384), fileContextCapsForTier('tight'));
assert.ok(fileContextCapsForTier('wide', 262144).maxCharsPerFile >= 60000);
const reviewerLocal = { maxFiles: 16, maxCharsPerFile: 16000, maxTotalChars: 48000 };
assert.deepEqual(resolveReviewerFileCaps(16384, reviewerLocal), reviewerLocal);
assert.deepEqual(resolveReviewerFileCaps(65536, reviewerLocal), reviewerLocal);
const frontierCaps = resolveReviewerFileCaps(262144, reviewerLocal);
assert.ok(frontierCaps.maxCharsPerFile >= 60000 && frontierCaps.maxTotalChars > 48000 && frontierCaps.maxFiles >= 16);
const geminiNode = {
  id: 'cloud',
  name: 'Gemini',
  url: 'https://generativelanguage.googleapis.com',
  type: 'openai',
  apiKey: 'k',
  online: true,
  latency: 1,
  models: [{ name: 'gemini-3.5-flash-lite', size: 1 }]
} as unknown as EndpointNode;
const geminiFit = resolveModelFit(geminiNode, 'gemini-3.5-flash-lite', 'reviewer', 16384);
assert.equal(geminiFit.maxCtx, 262144);
assert.ok(geminiFit.caps.maxCharsPerFile >= 60000);
// A local 27B at 16K stays tight
const localFit = resolveModelFit(node, 'gemma4:e4b', 'coder', 16384);
assert.equal(localFit.tier, 'tight');
assert.deepEqual(localFit.caps, fileContextCapsForTier('tight'));

console.log('clusterInventory.selftest: ok');
