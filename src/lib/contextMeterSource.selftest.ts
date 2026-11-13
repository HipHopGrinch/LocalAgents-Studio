/**
 * Run: npx --yes tsx src/lib/contextMeterSource.selftest.ts
 */
import assert from 'node:assert/strict';
import { resolveContextMeter } from './contextMeterSource';

const target = { model: 'qwen3:27b', node: 'Main', pinned: 16384 };
const coderTurn = {
  role: 'assistant',
  model: 'qwen3:27b',
  endpointName: 'Main',
  stats: { promptTokens: 9000, numCtx: 16384 }
};

// Idle: no request sized yet shows the selected target.
assert.deepEqual(resolveContextMeter({ snapshot: null, messages: [], target }), {
  pinned: 16384,
  model: 'qwen3:27b',
  node: 'Main'
});

// The reviewer turn on a 262144 window is read against its own window, not the coder's 16384.
const reviewerSnap = { model: 'gemini-3.5-flash-lite', pinnedCtx: 262144, promptTokens: 19522 };
const reviewer = resolveContextMeter({
  snapshot: reviewerSnap,
  messages: [coderTurn],
  target,
  nodesFor: m => (m === 'gemini-3.5-flash-lite' ? ['Gemini'] : [])
});
assert.deepEqual(reviewer, { used: 19522, pinned: 262144, model: 'gemini-3.5-flash-lite', node: 'Gemini' });

// A message of another model never lends its prompt to the snapshot.
const noSample = resolveContextMeter({
  snapshot: { model: 'gemini-3.5-flash-lite', pinnedCtx: 262144 },
  messages: [coderTurn],
  target
});
assert.equal(noSample.used, undefined);
assert.equal(noSample.pinned, 262144);
assert.equal(noSample.node, undefined);

// Same model without a snapshot sample: that message's own prompt and own window.
const sameModel = resolveContextMeter({
  snapshot: { model: 'qwen3:27b', pinnedCtx: 16384 },
  messages: [coderTurn],
  target
});
assert.deepEqual(sameModel, { used: 9000, pinned: 16384, model: 'qwen3:27b', node: 'Main' });

// Two nodes host the model and nothing names one: no node label rather than a guess.
const ambiguous = resolveContextMeter({
  snapshot: { model: 'qwen3:27b', pinnedCtx: 16384, promptTokens: 100 },
  messages: [],
  target,
  nodesFor: () => ['Main', 'Lab']
});
assert.equal(ambiguous.node, undefined);

// No snapshot: the newest sampled message supplies all four values.
const fromMessage = resolveContextMeter({
  snapshot: null,
  messages: [coderTurn, { role: 'user' }],
  target: { pinned: 4096 }
});
assert.deepEqual(fromMessage, { used: 9000, pinned: 16384, model: 'qwen3:27b', node: 'Main' });

console.log('contextMeterSource selftest ok');
