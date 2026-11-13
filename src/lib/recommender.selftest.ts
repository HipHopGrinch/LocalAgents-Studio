/**
 * Run: npx --yes tsx src/lib/recommender.selftest.ts
 */
import assert from 'node:assert/strict';
import { MODEL_CATALOG } from '../config/modelCatalog';
import type { HardwareProfile } from '../types';
import {
  FIT_FACTOR,
  estimateFit,
  estimateInstalledModelFit,
  estimateKvKBPerToken,
  findCatalogModel,
  kvCacheScale,
  recommendQuantVariant,
  scoreFor
} from './recommender';

const hw = (over: Partial<HardwareProfile> = {}): HardwareProfile => ({
  cpu: 'cpu',
  gpu: 'RTX 5070 Ti',
  vramGB: 16,
  gpuBandwidthGBs: 896,
  ramGB: 64,
  ramBandwidthGBs: 80,
  reserveVramGB: 1,
  kvCacheType: 'f16',
  ...over
});

const kv14 = estimateKvKBPerToken({ paramsB: 14.8 });
assert.ok(kv14 >= 150 && kv14 <= 200, `14B KV heuristic ${kv14} KB/token, want 150-200`);
assert.ok(estimateKvKBPerToken({ paramsB: 14 }) > 64, 'heuristic must not collapse to the old ~64 KB curve');

assert.equal(kvCacheScale(undefined), 1);
assert.equal(kvCacheScale('f16'), 1);
assert.equal(kvCacheScale('q4_0'), FIT_FACTOR.gpu ? 0.28 : 0.28);
assert.ok(kvCacheScale('q8_0') < 1);
assert.equal(kvCacheScale('q6_k'), 1);

const bare14 = {
  sizeGB: 9,
  paramsB: 14.8,
  contextMax: 32768
};
const fitF16 = estimateFit(bare14, hw(), 8192);
const fitUnset = estimateFit(bare14, hw({ kvCacheType: undefined as unknown as HardwareProfile['kvCacheType'] }), 8192);
const fitQ4 = estimateFit(bare14, hw({ kvCacheType: 'q4_0' }), 8192);
assert.ok(Math.abs(fitUnset.kvGB - fitF16.kvGB) < 1e-9, 'unknown KV type stays at f16');
assert.ok(fitQ4.kvGB < fitF16.kvGB * 0.5, 'known q4_0 KV cache is smaller');
assert.ok(fitF16.kvGB > (64 * 8192) / (1024 * 1024), '14B KV at 8K is larger than the old 64 KB estimate');

assert.equal(FIT_FACTOR.gpu, 1);
assert.equal(FIT_FACTOR.partial, 0.35);
assert.equal(FIT_FACTOR.cpu, 0.1);
assert.equal(FIT_FACTOR.none, 0);

const coder14 = MODEL_CATALOG.find(m => m.tag === 'qwen2.5-coder:14b')!;
const coder32 = MODEL_CATALOG.find(m => m.tag === 'qwen2.5-coder:32b')!;
const gpuScore = scoreFor(coder14, 'coding', { ...fitF16, kind: 'gpu', tokensPerSec: 40 }, 8192);
const spillScore = scoreFor(coder32, 'coding', { ...fitF16, kind: 'partial', tokensPerSec: 40 }, 8192);
assert.ok(gpuScore > spillScore, 'full-VRAM score beats a partial offload');

assert.equal(findCatalogModel('qwen2.5-coder:7b')?.tag, 'qwen2.5-coder:7b');
assert.equal(findCatalogModel('qwen2.5-coder:14b-instruct-q5_K_M')?.tag, 'qwen2.5-coder:14b');
assert.equal(findCatalogModel('qwen2.5-coder:14b-instruct-q8_0')?.paramsB, 14.8);
assert.equal(findCatalogModel('qwen3:14b-q8_0')?.tag, 'qwen3:14b');
assert.notEqual(findCatalogModel('qwen3:14b-q8_0')?.tag, 'qwen3-coder:30b');
assert.equal(findCatalogModel('gemma4:e4b-it')?.tag, 'gemma4:e4b');
assert.equal(findCatalogModel('qwen2.5-coder:latest'), undefined);
assert.notEqual(findCatalogModel('qwen2.5-coder:latest')?.tag, 'qwen2.5-coder:32b');
assert.equal(findCatalogModel('phi4:latest')?.tag, 'phi4:14b');

const q8 = estimateInstalledModelFit(
  {
    name: 'qwen2.5-coder:14b-instruct-q8_0',
    size: 15.7e9,
    details: { parameter_size: '14.8B', quantization_level: 'Q8_0' }
  },
  hw(),
  8192
);
assert.ok(Math.abs(q8.weightsGB - 15.7) < 0.05, `q8 weights ${q8.weightsGB} should follow the blob, not the Q4 catalog row`);

const latest7 = estimateInstalledModelFit(
  {
    name: 'qwen2.5-coder:latest',
    size: 4.68e9,
    details: { parameter_size: '7.6B', quantization_level: 'Q4_K_M' }
  },
  hw(),
  8192
);
assert.ok(latest7.weightsGB < 6, `latest tag used catalog weights ${latest7.weightsGB}`);
assert.ok(latest7.kvGB < 0.7, `latest+parameter_size should use the 7B KV row, kvGB=${latest7.kvGB}`);

const card11 = hw({ gpu: 'GTX 1080 Ti', vramGB: 11, gpuBandwidthGBs: 484, reserveVramGB: 0.2 });
const spill = recommendQuantVariant({ hardware: card11 }, coder14, 8192);
assert.equal(spill?.reason, 'spill');
assert.equal(spill?.quant, 'q3_k_m');
assert.match(spill?.tag || '', /q3_K_M/);

const llama3 = MODEL_CATALOG.find(m => m.tag === 'llama3.2:3b')!;
const headroom = recommendQuantVariant({ hardware: hw() }, llama3, 8192);
assert.equal(headroom?.reason, 'headroom');
assert.equal(headroom?.quant, 'q8_0');

const uncertain = recommendQuantVariant(
  { hardware: card11 },
  {
    ...coder14,
    quantVariants: [{ tag: 'deepseek-r1:8b-llama-distill-q4_K_M', quant: 'q3_k_m', sizeGB: 4, confident: false }]
  },
  8192
);
assert.equal(uncertain, null);

const tight7 = MODEL_CATALOG.find(m => m.tag === 'qwen2.5-coder:7b')!;
const noChange = recommendQuantVariant(
  { hardware: hw({ gpu: 'RTX 3060', vramGB: 6, gpuBandwidthGBs: 336, reserveVramGB: 0.1 }) },
  tight7,
  8192
);
assert.equal(noChange, null);

// B-22: dense sizes must not resolve to the 30B MoE row or a different gemma3 size
assert.notEqual(findCatalogModel('qwen3:32b')?.tag, 'qwen3:30b');
assert.notEqual(findCatalogModel('qwen3:4b')?.tag, 'qwen3:30b');
assert.notEqual(findCatalogModel('qwen3:1.7b')?.tag, 'qwen3:30b');
assert.notEqual(findCatalogModel('gemma3:4b')?.tag, 'gemma3:12b');
assert.equal(findCatalogModel('qwen3:30b-a3b-q4_K_M')?.tag, 'qwen3:30b');

console.log('recommender.selftest ok');
