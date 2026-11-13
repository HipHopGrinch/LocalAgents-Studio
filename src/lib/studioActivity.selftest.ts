/**
 * Run: npx --yes tsx src/lib/studioActivity.selftest.ts
 */
import assert from 'node:assert/strict';
import {
  activityLabelOf,
  popActivity,
  pushActivity,
  removeActivity,
  topActivityHandle,
  type StudioActivity
} from './studioActivity';

function begin(stack: StudioActivity[], label: string) {
  const next = pushActivity(stack, 'other', label);
  return { stack: next, handle: topActivityHandle(next)! };
}

// Handles are unique per frame.
{
  const a = begin([], 'A');
  const b = begin(a.stack, 'B');
  assert.notEqual(a.handle, b.handle);
  assert.equal(b.stack.length, 2);
}

// A late end of an older frame leaves the newer frame on top.
{
  const old = begin([], 'old run');
  // Stop clears the stack, then a newer run pushes its own frame.
  const cleared: StudioActivity[] = [];
  const fresh = begin(cleared, 'new run');
  const after = removeActivity(fresh.stack, old.handle);
  assert.equal(after, fresh.stack, 'a handle that is gone must be a no-op (same array)');
  assert.equal(activityLabelOf(after), 'new run');
}

// An older frame under a newer one is removed in place; the newer stays on top.
{
  const a = begin([], 'outer');
  const b = begin(a.stack, 'inner');
  const after = removeActivity(b.stack, a.handle);
  assert.equal(after.length, 1);
  assert.equal(activityLabelOf(after), 'inner');
  assert.equal(removeActivity(after, a.handle), after, 'ending twice is a no-op');
}

// Ending the top frame by handle matches the no-argument pop.
{
  const a = begin([], 'outer');
  const b = begin(a.stack, 'inner');
  assert.deepEqual(removeActivity(b.stack, b.handle), popActivity(b.stack));
}

// Empty stack has no handle and nothing to remove.
{
  assert.equal(topActivityHandle([]), undefined);
  const empty: StudioActivity[] = [];
  assert.equal(removeActivity(empty, 1), empty);
}

console.log('studioActivity selftest ok');
