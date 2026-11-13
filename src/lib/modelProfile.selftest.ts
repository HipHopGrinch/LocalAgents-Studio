/**
 * Run: node node_modules/tsx/dist/cli.mjs src/lib/modelProfile.selftest.ts
 */
import assert from 'node:assert/strict';
import { pinnedChatOptions, planCutOffRetry } from '../components/agent/modelRequest';
import type { EndpointNode } from '../types';
import {
  REASONING_MODEL_NAME_PATTERNS,
  cappedReasoningReserve,
  estimateReasoningTokens,
  frontierThinkLabel,
  hydrateLearnedReasoning,
  isLearnedReasoning,
  isReasoningModelName,
  modelProfile,
  noteReasoningObservation,
  reasoningReserveFor,
  resetLearnedReasoning,
  serializeLearnedReasoning,
  splitInlineThinking,
  thinkIsEnabled,
  turnThinkFields
} from './modelProfile';

assert.ok(REASONING_MODEL_NAME_PATTERNS.length >= 8);

// --- Name detection -----------------------------------------------------------------------
const reasoning = [
  'o1',
  'o1-mini',
  'o3',
  'o3-mini',
  'o4-mini',
  'openai/o3',
  'gpt-5',
  'gpt-5-mini',
  'gpt-5.1',
  'claude-3-7-sonnet-thinking',
  'anthropic/claude-3.7-sonnet:thinking',
  'qwen3-235b-a22b-thinking-2507',
  'deepseek-r1',
  'deepseek/deepseek-r1-0528',
  'deepseek-reasoner',
  'qwq-32b',
  'gemini-2.5-pro',
  'models/gemini-2.5-flash',
  'gemini-3-pro-preview',
  'gemini-3.5-flash',
  'models/gemini-4-hydrogen',
  'gemini-4-carbon-medium',
  'grok-4',
  'grok-4-fast-reasoning',
  'x-ai/grok-4',
  'grok-3-mini'
];
for (const name of reasoning) assert.equal(isReasoningModelName(name), true, name);
const plain = [
  '',
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4.1',
  'gpt-5-chat-latest',
  'o',
  'omni-moderation',
  'gemini-1.5-pro',
  'gemini-2.0-flash',
  'gemini-2.5-flash-lite',
  'models/gemini-4-hydrogen-lite',
  'grok-4-fast-non-reasoning',
  'grok-3',
  'claude-3-5-sonnet',
  'llama3.1:8b',
  'qwen2.5-coder:14b'
];
for (const name of plain) assert.equal(isReasoningModelName(name), false, name || '(empty)');

// --- Profile ------------------------------------------------------------------------------
const cloud = {
  id: 'cloud',
  name: 'Cloud',
  url: 'https://generativelanguage.googleapis.com/v1beta/openai',
  type: 'openai',
  apiKey: 'k',
  online: true,
  latency: 1,
  models: []
} as unknown as EndpointNode;

const hidden = modelProfile(cloud, 'models/gemini-4-hydrogen', { role: 'reviewer' });
assert.deepEqual(hidden, { thinks: 'hidden', source: 'name', reasoningReserve: 6144 });
assert.deepEqual(modelProfile(cloud, 'gpt-4o', { role: 'reviewer' }), {
  thinks: 'off',
  source: 'none',
  reasoningReserve: 0
});
assert.equal(modelProfile(cloud, 'models/gemini-4-hydrogen', { role: 'coder' }).reasoningReserve, 4096);
assert.equal(modelProfile(cloud, 'models/gemini-4-hydrogen', { role: 'assist' }).reasoningReserve, 1024);
assert.equal(reasoningReserveFor('planner'), 6144);
assert.equal(reasoningReserveFor('pass1'), 6144);
assert.equal(reasoningReserveFor('audit'), 6144);
assert.equal(reasoningReserveFor(undefined), 2048);

const thinker = (think: boolean | undefined, numCtx = 24576): EndpointNode =>
  ({
    id: 'gpu',
    name: 'GPU',
    url: 'http://127.0.0.1:11434',
    type: 'ollama',
    online: true,
    latency: 1,
    models: [
      { name: 'coder:27b', size: 1, capabilities: ['thinking'], thinking: { values: [false, true], default: true } },
      { name: 'plain:7b', size: 1 }
    ],
    modelPrefs: {
      'coder:27b': { numCtx, ...(think === undefined ? {} : { think }) },
      'plain:7b': { numCtx, think: true }
    }
  }) as unknown as EndpointNode;

assert.deepEqual(modelProfile(thinker(true), 'coder:27b', { role: 'coder' }), {
  thinks: 'on',
  source: 'pref',
  reasoningReserve: 4096
});
assert.equal(modelProfile(thinker(false), 'coder:27b', { role: 'coder' }).thinks, 'off');
assert.equal(modelProfile(thinker(undefined), 'coder:27b', { role: 'coder' }).thinks, 'off', 'no pref -> off');
// A model that cannot think never reports thinking, whatever the pref says.
assert.equal(modelProfile(thinker(true), 'plain:7b', { role: 'coder' }).thinks, 'off');

assert.equal(thinkIsEnabled(true), true);
assert.equal(thinkIsEnabled('low'), true);
assert.equal(thinkIsEnabled(false), false);
assert.equal(thinkIsEnabled('off'), false);
assert.equal(thinkIsEnabled(undefined), false);

// --- Learned reasoning (unknown frontier name) -------------------------------------------
resetLearnedReasoning();
const mystery = 'acme-chat-9000';
assert.equal(modelProfile(cloud, mystery, { role: 'reviewer' }).thinks, 'off');
assert.equal(noteReasoningObservation(mystery, { doneReason: 'stop', visibleContent: 'x'.repeat(2000) }), false);
assert.equal(noteReasoningObservation(mystery, { doneReason: 'length', visibleContent: 'x'.repeat(2000) }), false);
assert.equal(noteReasoningObservation(mystery, { reasoningTokens: 0, doneReason: 'stop', visibleContent: 'ok' }), false);
assert.equal(noteReasoningObservation(mystery, { doneReason: 'length', visibleContent: 'ab' }), true);
assert.equal(isLearnedReasoning(mystery), true);
assert.deepEqual(modelProfile(cloud, mystery, { role: 'reviewer' }), {
  thinks: 'hidden',
  source: 'learned',
  reasoningReserve: 6144
});
assert.equal(frontierThinkLabel(mystery), 'hidden');
assert.equal(noteReasoningObservation(mystery, { reasoningTokens: 900 }), false, 'already learned');
assert.equal(noteReasoningObservation('another-model', { reasoningTokens: 900, doneReason: 'stop' }), true);
const blob = serializeLearnedReasoning();
resetLearnedReasoning();
assert.equal(isLearnedReasoning(mystery), false);
hydrateLearnedReasoning(blob);
assert.equal(isLearnedReasoning(mystery), true);
hydrateLearnedReasoning('{not json');
assert.equal(isLearnedReasoning(mystery), false);
assert.equal(frontierThinkLabel('gpt-4o'), undefined);
resetLearnedReasoning();

// --- Budget math --------------------------------------------------------------------------
const budget = (node: EndpointNode, model: string, role: Parameters<typeof pinnedChatOptions>[0]['role'], extra?: object) =>
  pinnedChatOptions({ node, model, role, tier: 'standard', ...(extra || {}) });

// Local, thinking off: byte-identical to the persona budgets.
const off = (role: Parameters<typeof pinnedChatOptions>[0]['role'], createIntent?: boolean) =>
  budget(thinker(false), 'coder:27b', role, { createIntent });
assert.equal(off('reviewer').num_predict, 2048);
assert.equal(off('reviewer').promptBudget, 24576 - 2048 - 256);
assert.equal(off('planner').num_predict, 4096);
assert.equal(off('coder', true).num_predict, 8192);
assert.equal(off('coder', true).promptBudget, 24576 - 8192 - 256);
assert.equal(off('reviewer').thinks, 'off');
assert.equal(off('reviewer').reasoningReserve, 0);

// Local, thinking on, 24576 window: visible + reserve, prompt budget shrinks to match.
const on = (role: Parameters<typeof pinnedChatOptions>[0]['role'], createIntent?: boolean) =>
  budget(thinker(true), 'coder:27b', role, { createIntent });
assert.equal(on('reviewer').num_predict, 2048 + 6144);
assert.equal(on('reviewer').promptBudget, 24576 - (2048 + 6144) - 256);
assert.equal(on('planner').num_predict, 4096 + 6144);
assert.equal(on('coder', true).num_predict, 8192 + 4096);
assert.equal(on('coder', true).promptBudget, 24576 - (8192 + 4096) - 256);
assert.equal(on('coder', false).num_predict, 6144 + 4096);
assert.equal(on('pass1').num_predict, 2048 + 6144);
assert.equal(on('coder', true).thinks, 'on');
assert.equal(on('coder', true).reasoningReserve, 4096);
for (const role of ['coder', 'reviewer', 'planner', 'pass1', 'audit', 'docs', 'assist', 'generic'] as const) {
  const o = on(role, true);
  assert.ok(o.promptBudget >= 512, `${role} promptBudget`);
  assert.ok(o.reasoningReserve! <= Math.floor(24576 / 3), `${role} reserve <= 1/3 window`);
  assert.ok(o.num_predict + o.promptBudget + 256 <= 24576, `${role} fits the window`);
}

// Frontier hidden reasoning, 262144 window.
const fr = (role: Parameters<typeof pinnedChatOptions>[0]['role'], createIntent?: boolean) =>
  pinnedChatOptions({ node: cloud, model: 'models/gemini-4-hydrogen', role, tier: 'wide', createIntent });
assert.equal(fr('reviewer').num_predict, 8192);
assert.equal(fr('reviewer').promptBudget, 262144 - 8192 - 256);
assert.equal(fr('planner').num_predict, 4096 + 6144);
assert.equal(fr('coder', true).num_predict, 8192 + 4096);
assert.equal(fr('assist').num_predict, 480 + 1024);

// Tiny windows: never more than 1/3 of the window nor half the prompt budget; prompt stays >= 512.
const tiny = thinker(true, 4096);
const t = pinnedChatOptions({ node: tiny, model: 'coder:27b', role: 'reviewer', tier: 'tight' });
assert.ok(t.reasoningReserve! <= Math.floor(4096 / 3));
assert.ok(t.promptBudget >= 512);
assert.ok(t.num_predict + t.promptBudget + 256 <= 4096);
const tiniest = pinnedChatOptions({ node: thinker(true, 1024), model: 'coder:27b', role: 'coder', tier: 'tight' });
assert.equal(tiniest.reasoningReserve, 0, 'no room for a reserve');
assert.equal(tiniest.num_predict, 6144, 'budget untouched when the reserve does not fit');
assert.ok(tiniest.promptBudget >= 512);
assert.equal(cappedReasoningReserve({ pinnedCtx: 24576, promptBudget: 16128, reasoningReserve: 4096 }), 4096);
assert.equal(cappedReasoningReserve({ pinnedCtx: 3000, promptBudget: 2000, reasoningReserve: 6144 }), 1000 - (1000 % 256));
assert.equal(cappedReasoningReserve({ pinnedCtx: 24576, promptBudget: 600, reasoningReserve: 4096 }), 0);
assert.equal(cappedReasoningReserve({ pinnedCtx: 24576, promptBudget: 16128, reasoningReserve: 0 }), 0);
assert.equal(cappedReasoningReserve({ pinnedCtx: NaN, promptBudget: 16128, reasoningReserve: 4096 }), 0);

// --- Retry decision -----------------------------------------------------------------------
const lengthStop = { promptEvalCount: 9000, evalCount: 12288, doneReason: 'length' };
// Local thinking ate the budget: thinking text present, visible reply tiny -> retry without thinking.
assert.deepEqual(
  planCutOffRetry({
    frontier: false,
    stats: lengthStop,
    content: '',
    thinking: 'let me think about this...',
    thinkSent: true,
    numCtx: 24576,
    numPredict: 12288
  }),
  { kind: 'no-think' }
);
assert.deepEqual(
  planCutOffRetry({ frontier: false, stats: lengthStop, content: 'ok', thinking: 'x', thinkSent: 'low', numCtx: 24576, numPredict: 12288 }),
  { kind: 'no-think' }
);
// Not applicable: thinking off, no thinking text, a long visible reply, or a clean stop.
const base = { frontier: false, stats: lengthStop, content: '', thinking: 'x', thinkSent: true as boolean, numCtx: 24576, numPredict: 12288 };
assert.equal(planCutOffRetry({ ...base, thinkSent: false }), null);
assert.equal(planCutOffRetry({ ...base, thinkSent: undefined }), null);
assert.equal(planCutOffRetry({ ...base, thinking: '  ' }), null);
assert.equal(planCutOffRetry({ ...base, content: 'y'.repeat(400) }), null);
assert.equal(planCutOffRetry({ ...base, stats: { ...lengthStop, doneReason: 'stop' } }), null);
assert.equal(planCutOffRetry({ ...base, stats: undefined }), null);
// Frontier keeps the x4 budget retry.
assert.deepEqual(
  planCutOffRetry({
    frontier: true,
    stats: { promptEvalCount: 12203, evalCount: 3, doneReason: 'length' },
    content: '',
    numCtx: 262144,
    numPredict: 2304
  }),
  { kind: 'raise', numPredict: 9216 }
);
assert.equal(
  planCutOffRetry({ frontier: true, stats: { evalCount: 3, doneReason: 'stop' }, numCtx: 262144, numPredict: 2304 }),
  null
);

// --- Inline <think> stripping -------------------------------------------------------------
assert.deepEqual(splitInlineThinking('plain reply'), { content: 'plain reply', thinking: '' });
assert.deepEqual(splitInlineThinking(''), { content: '', thinking: '' });
assert.deepEqual(splitInlineThinking('<think>plan it</think>\nDone.'), { content: 'Done.', thinking: 'plan it' });
assert.deepEqual(splitInlineThinking('  <thinking>a</thinking><think>b</think>Answer'), {
  content: 'Answer',
  thinking: 'a\nb'
});
assert.deepEqual(splitInlineThinking('<THINK>x</THINK> ok'), { content: 'ok', thinking: 'x' });
// Unclosed leading block: the whole tail is reasoning (the reply was cut).
assert.deepEqual(splitInlineThinking('<think>still going and never closed'), {
  content: '',
  thinking: 'still going and never closed'
});
// Orphan close tag from templates that prefill the opener.
assert.deepEqual(splitInlineThinking('reasoning here</think>\n<step_verdict><result>yay</result></step_verdict>'), {
  content: '<step_verdict><result>yay</result></step_verdict>',
  thinking: 'reasoning here'
});
// Real output before an orphan close, and mid-reply mentions, are left alone.
const writeBody = '<write_file path="a.ts">const t = "</think>";</write_file>';
assert.deepEqual(splitInlineThinking(writeBody), { content: writeBody, thinking: '' });
const midReply = 'Here is the file:\n<write_file path="p.ts">// strips <think>x</think> blocks\n</write_file>';
assert.deepEqual(splitInlineThinking(midReply), { content: midReply, thinking: '' });
// A verdict hidden inside a think block is not output.
const verdictInThink = splitInlineThinking('<think><step_verdict><result>yay</result></step_verdict></think>Nay, missing.');
assert.equal(verdictInThink.content, 'Nay, missing.');
assert.ok(verdictInThink.thinking.includes('<result>yay</result>'));

// --- Reasoning token reporting ------------------------------------------------------------
assert.equal(estimateReasoningTokens(''), undefined);
assert.equal(estimateReasoningTokens('abcdefgh'), 2);
assert.deepEqual(turnThinkFields({ think: true, thinking: 'a'.repeat(400), stats: {} }), { think: true, reasoningTokens: 100 });
assert.deepEqual(turnThinkFields({ think: 'low', thinking: '', stats: {} }), { think: 'low' });
assert.deepEqual(turnThinkFields({ think: false, thinking: '', stats: {} }), {});
assert.deepEqual(turnThinkFields({ stats: { reasoningTokens: 700 } }), { think: true });
assert.deepEqual(turnThinkFields({ think: 'hidden', stats: { reasoningTokens: 700 } }), { think: 'hidden' });
assert.deepEqual(turnThinkFields({ stats: {} }), {});

console.log('modelProfile.selftest ok');
