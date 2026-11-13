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

// B-66: repeated or empty ids are made unique, so one verdict cannot complete two tasks
const dupQueue = createQueueFromReviewPlan({
  summary: 'Dup',
  tasks: [
    { id: '1', title: 'Fix header', description: 'a' },
    { id: '1', title: 'Fix footer', description: 'b' },
    { id: '', title: 'Fix nav', description: 'c' }
  ]
});
assert.equal(new Set(dupQueue.tasks.map(t => t.id)).size, 3);
const dupDone = markCompleted(markInProgress(dupQueue, dupQueue.tasks[0].id), dupQueue.tasks[0].id);
assert.equal(dupDone.tasks[0].status, 'completed');
assert.equal(dupDone.tasks[1].status, 'pending');

console.log('executionQueue.selftest ok');
