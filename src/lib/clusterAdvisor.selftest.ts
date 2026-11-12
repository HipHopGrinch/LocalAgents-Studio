/**
 * Run: npx --yes tsx src/lib/clusterAdvisor.selftest.ts
 */
import assert from 'node:assert/strict';
import type { EndpointNode, HardwareProfile, OllamaModel } from '../types';
import { FIT_FACTOR } from './recommender';
import {
  buildClusterAutoConfigPlan,
  computeOptimalNumCtxForModel,
  mergeCloudAuditIntoPlan
} from './clusterAdvisor';

function hw(partial: Partial<HardwareProfile> & Pick<HardwareProfile, 'gpu' | 'vramGB' | 'gpuBandwidthGBs'>): HardwareProfile {
  return {
    cpu: '',
    ramGB: 64,
    ramBandwidthGBs: 60,
    reserveVramGB: 1,
    kvCacheType: 'f16',
    ...partial
  };
}

function ollama(name: string, sizeGB: number, params: string): OllamaModel {
  return { name, size: sizeGB * 1e9, details: { parameter_size: params, quantization_level: 'Q4_K_M' } };
}

function node(partial: Partial<EndpointNode> & Pick<EndpointNode, 'id' | 'name' | 'url' | 'hardware' | 'models'>): EndpointNode {
  return {
    online: true,
    latency: 5,
    roles: ['coder', 'planner', 'reviewer'],
    loaded: [],
    disabledModels: [],
    ...partial
  } as EndpointNode;
}

const coder14 = ollama('qwen2.5-coder:14b', 8.99, '14.8B');
const coder7 = ollama('qwen2.5-coder:7b', 4.68, '7.6B');
const flux = ollama('flux-schnell', 4.2, '12B');

const architect = node({
  id: '5070',
  name: 'Main Rig',
  url: 'http://127.0.0.1:11434',
  isDevNode: true,
  hardware: hw({ gpu: 'RTX 5070 Ti', vramGB: 16, gpuBandwidthGBs: 896, vramOverheadMode: 'windows_desktop' }),
  models: [coder14, flux],
  imageModel: 'flux-schnell'
});
const pascal = node({
  id: '1080',
  name: 'Headless 1080 Ti',
  url: 'http://10.0.0.12:11434',
  hardware: hw({ gpu: 'GTX 1080 Ti', vramGB: 11, gpuBandwidthGBs: 484, vramOverheadMode: 'headless_linux' }),
  models: [coder14]
});
const scout = node({
  id: '3060',
  name: 'Laptop 3060',
  url: 'http://10.0.0.20:11434',
  hardware: hw({ gpu: 'RTX 3060 Laptop', vramGB: 6, gpuBandwidthGBs: 336, vramOverheadMode: 'igpu_display' }),
  models: [coder7, coder14]
});

const pascalCtx = computeOptimalNumCtxForModel(pascal, coder14, 10.8);
assert.ok(pascalCtx.numCtx <= 8192, `pascal 14B ctx ${pascalCtx.numCtx}`);
assert.equal(pascalCtx.fitsVram, true);
assert.ok(pascalCtx.numCtx >= 4096);

const scoutCtx = computeOptimalNumCtxForModel(scout, coder7, 5.9);
assert.equal(scoutCtx.numCtx, 8192);
assert.equal(scoutCtx.fitsVram, true);

const archCtx = computeOptimalNumCtxForModel(architect, coder14, 15);
assert.ok(archCtx.numCtx >= 16384 && archCtx.numCtx <= 32768, `architect ctx ${archCtx.numCtx}`);
assert.equal(archCtx.fitsVram, true);

const plan = buildClusterAutoConfigPlan([architect, pascal, scout]);
for (const advice of plan.nodes) {
  const primaries = advice.modelAdvice.filter(m => m.isPrimary);
  assert.equal(primaries.length, 1, `${advice.nodeName} should pin one primary`);
  assert.ok(advice.primaryModel, advice.nodeName);
  assert.ok((advice.modelNumCtx[advice.primaryModel!] || 0) >= 4096);
  assert.equal(advice.enabledModels.filter(n => n === advice.primaryModel).length, 1);
}

const archAdvice = plan.nodes.find(n => n.nodeId === '5070')!;
assert.equal(archAdvice.specialty, 'architect');
assert.equal(archAdvice.primaryModel, 'qwen2.5-coder:14b');
assert.ok(archAdvice.enabledModels.includes('flux-schnell'));
assert.ok(!archAdvice.disabledModels.includes('flux-schnell'));
assert.equal(archAdvice.modelAdvice.filter(m => m.isPrimary).length, 1);
assert.equal(FIT_FACTOR.partial, 0.35);

const scoutAdvice = plan.nodes.find(n => n.nodeId === '3060')!;
assert.equal(scoutAdvice.specialty, 'scout');
assert.equal(scoutAdvice.primaryModel, 'qwen2.5-coder:7b');
assert.ok(scoutAdvice.disabledModels.includes('qwen2.5-coder:14b'));
assert.ok((scoutAdvice.modelNumCtx['qwen2.5-coder:7b'] || 0) <= 8192);

const merged = mergeCloudAuditIntoPlan(
  JSON.stringify({
    summary: 'cloud',
    nodes: [
      {
        nodeId: '5070',
        specialty: 'architect',
        roles: ['planner', 'coder', 'reviewer'],
        primaryModel: 'flux-schnell',
        modelNumCtx: { 'qwen2.5-coder:14b': 16384 },
        rationale: 'try image as primary'
      }
    ]
  }),
  plan,
  'strategist'
);
const mergedArch = merged.nodes.find(n => n.nodeId === '5070')!;
assert.equal(mergedArch.primaryModel, 'qwen2.5-coder:14b');
assert.ok(mergedArch.enabledModels.includes('flux-schnell'));
assert.ok(!mergedArch.disabledModels.includes('flux-schnell'));

console.log('clusterAdvisor.selftest ok');
