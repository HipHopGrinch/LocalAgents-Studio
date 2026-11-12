/**
 * Run: npx --yes tsx src/lib/modelFit.selftest.ts
 */
import assert from 'node:assert/strict';
import type { EndpointNode } from '../types';
import { classifyStreamError, isRetriableStreamError, StreamChatError } from './ollamaClient';
import {
  isFullGpuFit,
  isModelLoaded,
  measuredEvalTokPerSec,
  measuredPromptTokPerSec,
  modelFitAtCtx,
  catalogActiveParamsB,
  qualityScoreForTask
} from './modelFit';

assert.equal(catalogActiveParamsB('qwen3-coder:30b', '30.5B'), 3.3);
assert.equal(catalogActiveParamsB('qwen2.5-coder:14b', '14.8B'), 14.8);
assert.ok(catalogActiveParamsB('qwen3-coder:30b', '30.5B') < 10, 'MoE ranking size is active params');

const heavyMoe = qualityScoreForTask('qwen3-coder:30b', 'heavy');
const heavy32 = qualityScoreForTask('qwen2.5-coder:32b', 'heavy');
const heavy14 = qualityScoreForTask('qwen2.5-coder:14b', 'heavy');
assert.ok(heavyMoe > heavy32, `MoE coder quality ${heavyMoe} should beat dense 32B ${heavy32} on catalog quality, not parameter count`);
assert.ok(heavy32 > heavy14);
assert.ok(heavyMoe <= 10 && heavyMoe > 0);

const light7 = qualityScoreForTask('qwen2.5-coder:7b', 'light');
const light32 = qualityScoreForTask('qwen2.5-coder:32b', 'light');
assert.ok(light7 > light32, `light 7B ${light7} should beat light 32B ${light32}`);
assert.ok(qualityScoreForTask('qwen2.5-coder:14b', 'review') > 0);
assert.ok(qualityScoreForTask('qwen3:14b', 'plan') > 0);
assert.ok(qualityScoreForTask('mystery-coder:7b', 'heavy') > 0);

const gpuNode = {
  id: 'gpu',
  name: 'GPU',
  url: 'http://127.0.0.1:11434',
  type: 'ollama',
  online: true,
  latency: 1,
  roles: ['coder'],
  hardware: {
    cpu: '',
    gpu: 'RTX 5070 Ti',
    vramGB: 16,
    gpuBandwidthGBs: 896,
    ramGB: 64,
    ramBandwidthGBs: 80,
    reserveVramGB: 1,
    kvCacheType: 'f16'
  },
  models: [
    {
      name: 'qwen2.5-coder:7b',
      size: 4.68e9,
      details: { parameter_size: '7.6B', quantization_level: 'Q4_K_M' }
    }
  ],
  loaded: [{ name: 'qwen2.5-coder:7b', size: 1, sizeVram: 1 }],
  benchmarks: {
    'qwen2.5-coder:7b': {
      model: 'qwen2.5-coder:7b',
      nodeId: 'gpu',
      evalTokens: 64,
      evalTokPerSec: 80,
      promptTokens: 32,
      promptTokPerSec: 400,
      loadMs: 1,
      totalMs: 1,
      provisional: false
    },
    'seeded:7b': {
      model: 'seeded:7b',
      nodeId: 'gpu',
      evalTokens: 1,
      evalTokPerSec: 50,
      promptTokens: 1,
      promptTokPerSec: 100,
      loadMs: 1,
      totalMs: 1,
      provisional: true
    }
  },
  modelPrefs: { 'qwen2.5-coder:7b': { numCtx: 8192 } },
  disabledModels: []
} as EndpointNode;

assert.equal(modelFitAtCtx(gpuNode, 'qwen2.5-coder:7b', 8192), 'gpu');
assert.equal(isFullGpuFit(gpuNode, 'qwen2.5-coder:7b', 8192), true);
assert.equal(isFullGpuFit({ ...gpuNode, type: 'openai' }, 'gpt-4o'), true);
assert.equal(measuredEvalTokPerSec(gpuNode, 'qwen2.5-coder:7b'), 80);
assert.equal(measuredPromptTokPerSec(gpuNode, 'qwen2.5-coder:7b'), 400);
assert.equal(measuredEvalTokPerSec(gpuNode, 'seeded:7b'), undefined);
assert.equal(isModelLoaded(gpuNode, 'qwen2.5-coder:7b'), true);
assert.equal(isModelLoaded(gpuNode, 'qwen2.5-coder:14b'), false);

assert.deepEqual(classifyStreamError('idle timeout after 120s'), { retriable: true, code: 'idle_timeout' });
assert.deepEqual(classifyStreamError('deadline exceeded'), { retriable: true, code: 'absolute_timeout' });
assert.deepEqual(classifyStreamError('stalled — no chunk'), { retriable: true, code: 'stall' });
assert.deepEqual(classifyStreamError('Model stalled: no data for 120s. This is retriable'), {
  retriable: true,
  code: 'stall'
});
assert.deepEqual(classifyStreamError('Request exceeded the 120 minute limit. This is retriable'), {
  retriable: true,
  code: 'absolute_timeout'
});
assert.deepEqual(classifyStreamError('HTTP 500: boom'), { retriable: false, code: 'stream_error' });
assert.equal(classifyStreamError(undefined, { retriable: true, code: 'idle_timeout' }).retriable, true);
const timeoutErr = new StreamChatError('idle timeout', {
  retriable: true,
  code: 'idle_timeout',
  requestId: 'chat-1'
});
assert.equal(isRetriableStreamError(timeoutErr), true);
assert.equal(isRetriableStreamError(new Error('nope')), false);

console.log('modelFit.selftest ok');
