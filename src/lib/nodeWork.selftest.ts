import assert from 'node:assert/strict';
import type { ChatConversation, ChatMessage, PipelineStep } from '../types';
import { createQueueFromReviewPlan, markInProgress } from './executionQueue';
import {
  failUnfinishedNodeWork,
  findNodeWorkIndex,
  nodeWorkKey,
  stopUnfinishedConversation,
  stopUnfinishedWork,
  upsertNodeWork
} from './nodeWork';

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

// Fail touches pending and running cards only, and returns the same array when none are left.
const mixed = [
  card({ targetFile: 'a' }),
  card({ targetFile: 'b', status: 'completed', content: 'done' }),
  card({ targetFile: 'c', status: 'pending', content: 'waiting…' }),
  card({ targetFile: 'd', status: 'failed', content: 'Skipped: offline' })
];
const settled = failUnfinishedNodeWork(mixed, 'Stopped');
assert.deepEqual(
  settled.map(s => `${s.status}:${s.content}`),
  ['failed:Stopped', 'completed:done', 'failed:Stopped', 'failed:Skipped: offline']
);
assert.equal(failUnfinishedNodeWork(settled, 'Stopped'), settled);

assert.equal(nodeWorkKey({ nodeId: 'n', role: 'Reviewer' }), 'n::Reviewer');

// Reopening a chat left mid-run: unfinished steps read Stopped, the in-progress review task is
// pending again, other messages are untouched.
const msgs: ChatMessage[] = [
  { id: 'u', role: 'user', raw: 'hi', display: 'hi', timestamp: '' },
  { id: 'p', role: 'assistant', raw: '', display: 'Swarm', timestamp: '', pipelineSteps: mixed },
  {
    id: 'r',
    role: 'assistant',
    raw: '',
    display: 'Review',
    timestamp: '',
    reviewPlan: {
      summary: 'Fixes',
      tasks: [
        { id: '1', title: 'One', description: 'a', status: 'in_progress' },
        { id: '2', title: 'Two', description: 'b', status: 'completed' }
      ]
    }
  }
];
const reopened = stopUnfinishedWork(msgs);
assert.equal(reopened[0], msgs[0]);
assert.deepEqual(reopened[1].pipelineSteps?.map(s => s.status), ['failed', 'completed', 'failed', 'failed']);
assert.deepEqual(reopened[2].reviewPlan?.tasks.map(t => t.status), ['pending', 'completed']);
assert.equal(stopUnfinishedWork(reopened), reopened);

// A conversation loaded from disk: messages and the review queue's in-progress task.
const loaded: ChatConversation = {
  id: 'c',
  title: 't',
  workspacePath: 'D:\\proj',
  agentId: 'coder',
  messages: msgs,
  createdAt: 0,
  updatedAt: 0,
  executionQueue: markInProgress(
    createQueueFromReviewPlan({ summary: 'Fixes', tasks: [{ id: '1', title: 'One', description: 'a' }] }),
    '1'
  )
};
const reloaded = stopUnfinishedConversation(loaded);
assert.equal(reloaded.executionQueue?.tasks[0].status, 'pending');
assert.equal(reloaded.messages[2].reviewPlan?.tasks[0].status, 'pending');
assert.equal(stopUnfinishedConversation(reloaded), reloaded);

console.log('nodeWork.selftest ok');
