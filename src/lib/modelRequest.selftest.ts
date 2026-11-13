/**
 * Run: node node_modules/tsx/dist/cli.mjs src/lib/modelRequest.selftest.ts
 */
import assert from 'node:assert/strict';
import {
  FRONTIER_REASONING_OUTPUT_FLOOR,
  frontierCutOffBudget,
  pinnedChatOptions,
  prependVolatileContext,
  raisedOutputBudget,
  withRaisedOutputBudget,
  type PinnedChatOptions
} from '../components/agent/modelRequest';
import type { EndpointNode } from '../types';
import { outputBudgetFor } from './contextSize';
import { emptyWorkLog, renderWorkLog } from './workLog';

const log = { ...emptyWorkLog(), request: 'Build a checkers game', next: 'wire the board' };
const progressLog = renderWorkLog(log);

// B-96: the words "work log" in a user message don't drop the log
const mentioned = prependVolatileContext('Please update the work log format', { progressLog });
assert.ok(mentioned.includes('wire the board'), 'progress log kept');
assert.ok(mentioned.endsWith('Please update the work log format'));

// A packet that already carries the rendered log doesn't get a second copy
const already = prependVolatileContext(`Task\n\n${progressLog}`, { progressLog });
assert.equal(already.split('wire the board').length - 1, 1);

// Real log: 16K tight coder, 6144 cap, 928-token prompt -> doubled to 12288
assert.equal(raisedOutputBudget({ numCtx: 16384, estPromptTokens: 928, currentBudget: 6144 }), 12288);
// window-limited: 8K window with 3000-token prompt has no room beyond 6144
assert.equal(raisedOutputBudget({ numCtx: 8192, estPromptTokens: 3000, currentBudget: 6144 }), null);
// partial room is rounded down to 256
assert.equal(raisedOutputBudget({ numCtx: 16384, estPromptTokens: 7000, currentBudget: 6144 }), 8960);
// huge windows still respect the hard max
assert.equal(raisedOutputBudget({ numCtx: 131072, estPromptTokens: 1000, currentBudget: 8192 }), 16384);
assert.equal(raisedOutputBudget({ numCtx: 131072, estPromptTokens: 1000, currentBudget: 16384 }), null);
assert.equal(raisedOutputBudget({ numCtx: NaN, estPromptTokens: 1, currentBudget: 100 }), null);
assert.equal(raisedOutputBudget({ numCtx: 16384, estPromptTokens: 100, currentBudget: 0 }), null);

const pinned: PinnedChatOptions = {
  temperature: 0.2,
  num_ctx: 16384,
  num_predict: 6144,
  tier: 'tight',
  promptBudget: 9984,
  pinnedCtx: 16384
};
const retry = withRaisedOutputBudget(pinned, 928);
assert.equal(retry?.num_predict, 12288);
assert.equal(retry?.num_ctx, 16384);
assert.equal(pinned.num_predict, 6144, 'input not mutated');
assert.equal(withRaisedOutputBudget(pinned, 15000), null);

// Frontier reasoning roles get an output floor: hidden thinking counts against max_tokens.
const cloudNode = {
  id: 'cloud',
  name: 'Gemini',
  url: 'https://generativelanguage.googleapis.com',
  type: 'openai',
  apiKey: 'k',
  online: true,
  latency: 1,
  models: [{ name: 'gemini-4-hydrogen', size: 1 }]
} as unknown as EndpointNode;
const cloudReviewer = pinnedChatOptions({ node: cloudNode, model: 'gemini-4-hydrogen', role: 'reviewer' });
assert.equal(cloudReviewer.num_predict, FRONTIER_REASONING_OUTPUT_FLOOR);
assert.equal(cloudReviewer.promptBudget, cloudReviewer.pinnedCtx - FRONTIER_REASONING_OUTPUT_FLOOR - 256);
const cloudPlanner = pinnedChatOptions({ node: cloudNode, model: 'gemini-4-hydrogen', role: 'planner' });
assert.equal(cloudPlanner.num_predict, outputBudgetFor('planner', { tier: cloudPlanner.tier }) + 6144);
assert.equal(cloudReviewer.thinks, 'hidden');
assert.equal(cloudReviewer.reasoningReserve, 6144);
// The coder on a thinking cloud model gets its reserve too: visible 8192 + 4096.
assert.equal(
  pinnedChatOptions({ node: cloudNode, model: 'gemini-4-hydrogen', role: 'coder', createIntent: true }).num_predict,
  12288
);
// A non-reasoning cloud model keeps the plain persona cap (no unnecessary floor).
const cloudPlain = pinnedChatOptions({ node: cloudNode, model: 'gpt-4o-mini', role: 'reviewer' });
assert.equal(cloudPlain.num_predict, 2048);
assert.equal(cloudPlain.thinks, 'off');
const localNode = {
  id: 'gpu',
  name: 'GPU',
  url: 'http://127.0.0.1:11434',
  type: 'ollama',
  online: true,
  latency: 1,
  models: [{ name: 'qwen3:14b', size: 1 }]
} as unknown as EndpointNode;
assert.equal(pinnedChatOptions({ node: localNode, model: 'qwen3:14b', role: 'reviewer' }).num_predict, 2048);

// Retry after a frontier reply stopped for length with room: x4, up to 16384, even when evalCount is tiny.
const cutOff = { promptEvalCount: 12203, evalCount: 3, doneReason: 'length' };
assert.equal(frontierCutOffBudget({ stats: cutOff, numCtx: 262144, numPredict: 2304 }), 9216);
assert.equal(frontierCutOffBudget({ stats: cutOff, numCtx: 262144, numPredict: 8192 }), 16384);
assert.equal(frontierCutOffBudget({ stats: cutOff, numCtx: 262144, numPredict: 16384 }), null);
assert.equal(frontierCutOffBudget({ stats: { ...cutOff, doneReason: 'stop' }, numCtx: 262144, numPredict: 8192 }), null);
assert.equal(frontierCutOffBudget({ stats: undefined, numCtx: 262144, numPredict: 8192 }), null);
// A full window is the context monitor's case, not an output cap.
assert.equal(
  frontierCutOffBudget({ stats: { ...cutOff, promptEvalCount: 250000 }, numCtx: 262144, numPredict: 2048 }),
  null
);
// No prompt count from the provider: the estimate stands in.
assert.equal(
  frontierCutOffBudget({
    stats: { evalCount: 3, doneReason: 'length' },
    numCtx: 262144,
    numPredict: 8192,
    estPromptTokens: 11000
  }),
  16384
);
assert.equal(frontierCutOffBudget({ stats: { evalCount: 3, doneReason: 'length' }, numCtx: 262144, numPredict: 8192 }), null);

console.log('modelRequest.selftest ok');
