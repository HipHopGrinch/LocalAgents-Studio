/**
 * Run: npx --yes tsx src/lib/contextSize.selftest.ts
 */
import assert from 'node:assert/strict';
import {
  capActiveFileForTier,
  charsPerToken,
  CHARS_PER_TOKEN_SEED,
  estimateChatPayloadTokens,
  estimateTextTokens,
  expectedOutputTokens,
  fitBudgetForPinnedCtx,
  hydrateTokenCalibration,
  nearestNumCtxBucket,
  NUM_CTX_BUCKETS,
  outputBudgetFor,
  pinnedNumCtx,
  recordPromptSample,
  resetTokenCalibration,
  serializeTokenCalibration,
  snapNumCtxToOption
} from './contextSize';
import { estimateImageTokens } from './images';

resetTokenCalibration();
assert.equal(charsPerToken(), CHARS_PER_TOKEN_SEED);
assert.equal(charsPerToken('qwen2.5-coder:7b'), CHARS_PER_TOKEN_SEED);
assert.equal(estimateTextTokens('a'.repeat(320)), 100);

recordPromptSample('qwen2.5-coder:7b', 40, 10);
assert.equal(charsPerToken('qwen2.5-coder:7b'), CHARS_PER_TOKEN_SEED);
recordPromptSample('', 4000, 1000);
assert.equal(charsPerToken(''), CHARS_PER_TOKEN_SEED);

recordPromptSample('qwen2.5-coder:7b', 4000, 1000);
assert.ok(Math.abs(charsPerToken('qwen2.5-coder:7b') - 3.6) < 0.05);
for (let i = 0; i < 24; i++) recordPromptSample('qwen2.5-coder:7b', 4000, 1000);
const calibrated = charsPerToken('qwen2.5-coder:7b');
assert.ok(calibrated > 3.85 && calibrated <= 4, `expected ~4, got ${calibrated}`);
const fitted = estimateTextTokens('a'.repeat(320), 'qwen2.5-coder:7b');
assert.ok(fitted <= 84 && fitted >= 78, `expected ~80 tokens, got ${fitted}`);
assert.equal(estimateTextTokens('a'.repeat(320)), 100);

recordPromptSample('hot-model', 10000, 1000);
assert.ok(charsPerToken('hot-model') <= 5);
assert.ok(charsPerToken('hot-model') >= 2);
recordPromptSample('cold-model', 10000, 8000);
assert.ok(charsPerToken('cold-model') >= 2);
assert.ok(charsPerToken('cold-model') < 3.2);

const dumped = serializeTokenCalibration();
resetTokenCalibration();
assert.equal(charsPerToken('qwen2.5-coder:7b'), CHARS_PER_TOKEN_SEED);
hydrateTokenCalibration(dumped);
assert.ok(charsPerToken('qwen2.5-coder:7b') > 3.85);
hydrateTokenCalibration('not json');
assert.equal(charsPerToken('qwen2.5-coder:7b'), CHARS_PER_TOKEN_SEED);
resetTokenCalibration();

const withImage = estimateChatPayloadTokens([
  { role: 'user', content: 'hi', images: ['data:image/png;base64,aaaa'] }
]);
assert.ok(withImage >= estimateImageTokens('data:image/png;base64,aaaa'));
assert.ok(withImage >= 1500);
const wideShot = estimateChatPayloadTokens([
  { role: 'user', content: [{ type: 'image_url', image_url: { url: 'x' }, width: 1920, height: 1080 }] }
]);
const smallShot = estimateChatPayloadTokens([
  { role: 'user', content: [{ width: 768, height: 768 }] }
]);
assert.ok(wideShot > smallShot);

assert.equal(outputBudgetFor('coder'), 6144);
assert.equal(outputBudgetFor('coder', { createIntent: false }), 6144);
assert.equal(outputBudgetFor('coder', { createIntent: true }), 8192);
assert.equal(outputBudgetFor('coder', { tier: 'wide' }), 8192);
assert.equal(outputBudgetFor('coder', { tier: 'tight', createIntent: true }), 6144);
assert.equal(outputBudgetFor('planner'), 3072);
assert.equal(outputBudgetFor('planner', { tier: 'standard' }), 4096);
assert.equal(outputBudgetFor('planner', { tier: 'wide' }), 4096);
assert.equal(outputBudgetFor('reviewer'), 2048);
assert.equal(outputBudgetFor('pass1'), 2048);
assert.equal(outputBudgetFor('audit'), 2048);
assert.equal(outputBudgetFor('assist'), 480);
assert.equal(expectedOutputTokens('assist'), outputBudgetFor('assist'));
assert.equal(expectedOutputTokens('coder', { createIntent: true }), 8192);
assert.equal(expectedOutputTokens('reviewer'), 2048);

assert.equal(pinnedNumCtx({ modelPrefs: { 'qwen:7b': { numCtx: 8192 } } }, 'qwen:7b', 16384), 8192);
assert.equal(pinnedNumCtx({ type: 'ollama' }, 'qwen:7b', 8192), 8192);
assert.equal(pinnedNumCtx({ type: 'openai', apiKey: 'x' }, 'gemini-2.5-flash', 16384), 262144);

const reviewBudget = fitBudgetForPinnedCtx({ pinnedCtx: 16384, role: 'reviewer' });
assert.equal(reviewBudget.pinnedCtx, 16384);
assert.equal(reviewBudget.outputReserve, 2048);
assert.equal(reviewBudget.promptBudget, 16384 - 2048 - 256);
const scout = fitBudgetForPinnedCtx({ pinnedCtx: 8192, role: 'coder', createIntent: false });
assert.equal(scout.outputReserve, 6144);
assert.equal(scout.promptBudget, 8192 - 6144 - 256);
const tightCreate = fitBudgetForPinnedCtx({ pinnedCtx: 8192, role: 'coder', createIntent: true });
assert.equal(tightCreate.outputReserve, 8192);
assert.equal(tightCreate.promptBudget, 512);

assert.ok(NUM_CTX_BUCKETS.includes(8192));
assert.equal(nearestNumCtxBucket(8192), 8192);
assert.equal(nearestNumCtxBucket(10000), 12288);
assert.equal(nearestNumCtxBucket(300000), 262144);

const lines = Array.from({ length: 200 }, (_, i) => `L${i + 1} ${'x'.repeat(40)}`);
const file = lines.join('\n');
assert.ok(file.length > 4000);
const around = capActiveFileForTier(file, 'tight', 100);
assert.match(around, /L100 /);
assert.ok(around.length < file.length);
assert.ok(around.length <= 4000 + 80, `window was ${around.length}`);
assert.match(around, /omitted/);
const head = capActiveFileForTier(file, 'tight');
assert.ok(head.startsWith('L1 '));
assert.match(head, /truncated to 4000/);
assert.ok(head.length < 4100);
assert.equal(capActiveFileForTier('short file', 'tight', 1), 'short file');
const standardCapped = capActiveFileForTier('x'.repeat(9000), 'standard');
assert.ok(standardCapped.length < 9000);
assert.ok(standardCapped.length <= 8100);

// B-26: 12K and 24K are real presets
assert.equal(snapNumCtxToOption(12288, 32768), 12288);
assert.equal(snapNumCtxToOption(24576, 32768), 24576);

console.log('contextSize.selftest ok');
