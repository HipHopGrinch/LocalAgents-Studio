import assert from 'node:assert/strict';
import { createQueueFromReviewPlan, getActiveTask, markCompleted, markInProgress, markStopped } from './executionQueue';

const base = createQueueFromReviewPlan({
  summary: 'Fixes',
  tasks: [
    { id: '1', title: 'One', description: 'a' },
    { id: '2', title: 'Two', description: 'b' }
  ]
});

// Stop sends an in-progress task back to pending and keeps it active for Resume.
const running = markInProgress(base, '1');
const stopped = markStopped(running, '1');
assert.equal(stopped.tasks[0].status, 'pending');
assert.equal(getActiveTask(stopped)?.id, '1');

// Finished or untouched tasks are left alone.
const done = markCompleted(running, '1');
assert.equal(markStopped(done, '1'), done);
assert.equal(markStopped(base, '2'), base);

console.log('executionQueue.selftest ok');
