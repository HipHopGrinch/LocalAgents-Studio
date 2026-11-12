/**
 * Run: npx --yes tsx src/lib/thinking.selftest.ts
 */
import assert from 'node:assert/strict';
import {
  THINK_FALSE_FOR_SIDE_PATHS,
  resolveThinkOption,
  thinkFalseForSidePaths
} from './thinking';

const levels = {
  name: 'qwen3:14b',
  capabilities: ['thinking'],
  thinking: { values: ['low', 'medium', 'high'], default: 'medium' }
};

assert.equal(THINK_FALSE_FOR_SIDE_PATHS, false);
assert.equal(thinkFalseForSidePaths(), false);
assert.equal(resolveThinkOption(levels, undefined), false);
assert.equal(resolveThinkOption(levels, null, { persona: 'planner' }), false);
assert.equal(resolveThinkOption(levels, false, { persona: 'planner' }), false);
assert.equal(resolveThinkOption(levels, true, { persona: 'coder' }), 'low');
assert.equal(resolveThinkOption(levels, true, { persona: 'reviewer' }), 'low');
assert.equal(resolveThinkOption(levels, 'high', { persona: 'coder' }), 'low');
assert.equal(resolveThinkOption(levels, true, { persona: 'planner' }), 'high');
assert.equal(resolveThinkOption(levels, 'low', { persona: 'planner' }), 'high');
assert.equal(resolveThinkOption(levels, true), 'low');

const boolOnly = {
  name: 'simple:7b',
  capabilities: ['thinking'],
  thinking: { values: [false, true], default: false }
};
assert.equal(resolveThinkOption(boolOnly, true, { persona: 'coder' }), true);
assert.equal(resolveThinkOption(boolOnly, true, { persona: 'planner' }), true);
assert.equal(resolveThinkOption({ name: 'plain:7b' }, true), undefined);

console.log('thinking.selftest ok');
