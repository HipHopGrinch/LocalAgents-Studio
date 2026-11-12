/**
 * Run: npx --yes tsx src/lib/images.selftest.ts
 */
import assert from 'node:assert/strict';
import {
  estimateImageTokens,
  imageLimitsForTier,
  MIN_IMAGE_TOKENS,
  resolveImageMaxEdge,
  selectImagesForTier
} from './images';

const tight = imageLimitsForTier('tight');
assert.ok(tight.maxEdge >= 768 && tight.maxEdge <= 1024);
assert.equal(tight.maxImages, 1);
assert.equal(imageLimitsForTier('standard').maxEdge, 1280);
assert.equal(imageLimitsForTier('wide').maxEdge, 1920);
assert.equal(imageLimitsForTier('wide').maxImages, 6);

assert.equal(resolveImageMaxEdge(), 1920);
assert.equal(resolveImageMaxEdge({ tier: 'tight' }), tight.maxEdge);
assert.equal(resolveImageMaxEdge({ tier: 'standard' }), 1280);
assert.equal(resolveImageMaxEdge({ maxEdge: 768 }), 768);
assert.equal(resolveImageMaxEdge({ tier: 'wide', maxEdge: 800 }), 800);

assert.deepEqual(selectImagesForTier(['a', 'b', 'c'], 'tight'), ['a']);
assert.equal(selectImagesForTier(['a', 'b', 'c', 'd', 'e'], 'standard').length, 4);
assert.equal(selectImagesForTier(['a', 'b'], 'wide').length, 2);

assert.ok(estimateImageTokens('data:image/png;base64,abc') >= MIN_IMAGE_TOKENS);
assert.ok(estimateImageTokens({ width: 32, height: 32 }) >= 1000);
assert.ok(estimateImageTokens({ width: 64, height: 64 }) >= MIN_IMAGE_TOKENS);
const icon = estimateImageTokens({ width: 768, height: 768 });
const shot = estimateImageTokens({ width: 1920, height: 1080 });
assert.ok(icon >= MIN_IMAGE_TOKENS);
assert.ok(shot > icon);
assert.ok(shot > 1500);

console.log('images.selftest ok');
