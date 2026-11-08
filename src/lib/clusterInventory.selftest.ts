/**
 * Run: npx --yes tsx src/lib/clusterInventory.selftest.ts
 */
import assert from 'node:assert/strict';
import {
  buildModelFitSection,
  fileContextCapsForTier,
  formatClusterInventory,
  modelFitTier,
  resolveModelFit
} from './clusterInventory';
import type { EndpointNode } from '../types';

assert.equal(modelFitTier('gemma4:e4b', 16384), 'tight');
assert.equal(modelFitTier('qwen2.5:7b', 16384), 'tight');
assert.equal(modelFitTier('qwen2.5:32b', 32768), 'standard');
assert.equal(modelFitTier('qwen2.5:32b', 65536), 'wide');
assert.equal(modelFitTier('llama3.1:70b', 131072), 'wide');
// Frontier names are never "small" by param heuristic
assert.equal(modelFitTier('gpt-4o', 128000), 'wide');

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

console.log('clusterInventory.selftest: ok');
