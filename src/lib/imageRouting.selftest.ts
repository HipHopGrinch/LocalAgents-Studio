/**
 * Run: npx --yes tsx src/lib/imageRouting.selftest.ts
 */
import assert from 'node:assert/strict';
import type { EndpointNode, HardwareProfile, OllamaModel } from '../types';
import { coderModelToRewarm, pickImageTarget } from './imageRouting';

function hw(gpu: string, vramGB: number, reserve: number, bw: number): HardwareProfile {
  return {
    cpu: '',
    gpu,
    vramGB,
    gpuBandwidthGBs: bw,
    ramGB: 32,
    ramBandwidthGBs: 50,
    reserveVramGB: reserve,
    kvCacheType: 'f16'
  };
}

function model(name: string, sizeGB: number): OllamaModel {
  return { name, size: sizeGB * 1e9, details: { parameter_size: '4B' } };
}

function node(partial: Partial<EndpointNode> & Pick<EndpointNode, 'id' | 'name' | 'hardware'>): EndpointNode {
  return {
    url: 'http://10.0.0.8:11434',
    online: true,
    latency: 4,
    roles: ['coder'],
    models: [],
    loaded: [],
    disabledModels: [],
    ...partial
  } as EndpointNode;
}

const architect = node({
  id: 'arch',
  name: 'Main Rig',
  specialty: 'architect',
  hardware: hw('RTX 5070 Ti', 16, 1, 896),
  activeModel: 'qwen2.5-coder:14b',
  models: [model('qwen2.5-coder:14b', 9), model('flux-schnell', 4)],
  modelPrefs: { 'qwen2.5-coder:14b': { numCtx: 16384 } }
});
const scout = node({
  id: 'scout',
  name: 'Laptop',
  specialty: 'scout',
  hardware: hw('RTX 3060', 6, 0.1, 336),
  activeModel: 'qwen2.5-coder:7b',
  models: [model('qwen2.5-coder:7b', 4.7), model('flux-schnell', 4)],
  modelPrefs: { 'qwen2.5-coder:7b': { numCtx: 8192 } }
});

const picked = pickImageTarget([architect, scout]);
assert.equal(picked?.node.id, 'scout', 'image gen should prefer the scout, not the 16GB architect');
assert.equal(picked?.model, 'flux-schnell');
const rewarm = coderModelToRewarm(picked!);
assert.equal(rewarm?.model, 'qwen2.5-coder:7b');
assert.equal(rewarm?.nodeId, 'scout');
assert.equal(rewarm?.numCtx, 8192);

const hugeOnScout = node({
  ...scout,
  models: [model('qwen2.5-coder:7b', 4.7), model('flux-dev', 13)]
});
const hugeOnArch = node({
  ...architect,
  models: [model('qwen2.5-coder:14b', 9), model('flux-dev', 13)]
});
const onlyArchFits = pickImageTarget([hugeOnArch, hugeOnScout]);
assert.equal(onlyArchFits?.node.id, 'arch');
assert.equal(coderModelToRewarm(onlyArchFits!)?.model, 'qwen2.5-coder:14b');

const imagePrimary = node({
  ...architect,
  activeModel: 'flux-schnell',
  models: [model('flux-schnell', 4)]
});
const stay = pickImageTarget([imagePrimary, scout]);
assert.equal(stay?.node.id, 'arch', 'a node whose primary is already the image model wins');
assert.equal(coderModelToRewarm(stay!), null);

const twoImageModels = node({
  ...architect,
  activeModel: 'flux-schnell',
  models: [model('sdxl', 4), model('flux-schnell', 4)]
});
const pinnedWins = pickImageTarget([twoImageModels]);
assert.equal(pinnedWins?.model, 'flux-schnell', 'only the exact pinned image model counts as primary');

console.log('imageRouting.selftest ok');
