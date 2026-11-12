import assert from 'node:assert/strict';
import type { PipelineStep } from '../types';
import { findNodeWorkIndex, nodeWorkKey, settleRunningNodeWork, upsertNodeWork } from './nodeWork';

const card = (over: Partial<PipelineStep>): PipelineStep => ({
  nodeId: 'gemini',
  nodeName: 'Google Gemini',
  agentHandle: 'coder',
  role: 'Lead Coder · flash-lite',
  status: 'running',
  content: 'Working…',
  ...over
});

// A turn starts as "workspace" and finishes on the file it wrote: one card, not two.
let steps = upsertNodeWork([], card({ targetFile: 'workspace' }));
const startIdx = findNodeWorkIndex(steps, { nodeId: 'gemini', targetFile: 'workspace', role: '' });
assert.equal(startIdx, 0);
steps = upsertNodeWork(
  steps,
  card({ targetFile: 'pacman.html', status: 'completed', content: 'Wrote pacman.html' }),
  startIdx
);
assert.equal(steps.length, 1);
assert.equal(steps[0].status, 'completed');
assert.equal(steps[0].targetFile, 'pacman.html');

// Without the hint a different target appends (Swarm workers, one card per file).
steps = upsertNodeWork(steps, card({ targetFile: 'ghosts.js' }));
assert.equal(steps.length, 2);

// Same key merges in place.
steps = upsertNodeWork(steps, card({ targetFile: 'ghosts.js', content: 'Writing ghosts.js…' }));
assert.equal(steps.length, 2);
assert.equal(steps[1].content, 'Writing ghosts.js…');

// A stale hint past the end falls back to the key.
steps = upsertNodeWork(steps, card({ targetFile: 'ghosts.js', status: 'failed', content: 'x' }), 9);
assert.equal(steps.length, 2);
assert.equal(steps[1].status, 'failed');

// Settle only touches running cards, and returns the same array when none are running.
const mixed = [card({ targetFile: 'a' }), card({ targetFile: 'b', status: 'completed', content: 'done' })];
const settled = settleRunningNodeWork(mixed, 'failed', 'Stopped');
assert.equal(settled[0].status, 'failed');
assert.equal(settled[0].content, 'Stopped');
assert.equal(settled[1].content, 'done');
assert.equal(settleRunningNodeWork(settled, 'failed', 'Stopped'), settled);

assert.equal(nodeWorkKey({ nodeId: 'n', role: 'Reviewer' }), 'n::Reviewer');

console.log('nodeWork.selftest ok');
