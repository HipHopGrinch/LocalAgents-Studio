/**
 * Latest-wins write queue used to coalesce settings / chats saves.
 * Run: node scripts/latest-wins.selftest.cjs
 */
const assert = require('assert');
const { createLatestWinsQueue } = require('../electron/latestWins.cjs');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  // A burst behind a slow running job runs the first job and only the newest pending one.
  {
    const q = createLatestWinsQueue();
    const ran = [];
    const job = (label, ms) => async () => {
      ran.push(label);
      await sleep(ms);
      return label;
    };
    const first = q.enqueue('file', 'a', job('1', 40));
    const rest = [2, 3, 4, 5].map(n => q.enqueue('file', 'a', job(String(n), 5)));
    const results = await Promise.all([first, ...rest]);
    assert.deepEqual(ran, ['1', '5']);
    assert.deepEqual(results, ['1', '5', '5', '5', '5']);
    assert.equal(q.size(), 0, 'finished lanes are released');
  }

  // Different tags never replace each other, and the newest call keeps the later slot.
  {
    const q = createLatestWinsQueue();
    const ran = [];
    const job = label => async () => {
      ran.push(label);
      await sleep(5);
    };
    const all = [
      q.enqueue('file', 'desktop', job('d1')),
      q.enqueue('file', 'desktop', job('d2')),
      q.enqueue('file', 'web', job('w1')),
      q.enqueue('file', 'desktop', job('d3'))
    ];
    await Promise.all(all);
    assert.deepEqual(ran, ['d1', 'w1', 'd3']);
  }

  // Lanes are independent per key.
  {
    const q = createLatestWinsQueue();
    const ran = [];
    await Promise.all([
      q.enqueue('a', 't', async () => ran.push('a1')),
      q.enqueue('b', 't', async () => ran.push('b1'))
    ]);
    assert.deepEqual(ran.sort(), ['a1', 'b1']);
  }

  // A failing job rejects its own callers, and the lane keeps working.
  {
    const q = createLatestWinsQueue();
    const bad = q.enqueue('file', 'a', async () => {
      await sleep(5);
      throw new Error('disk full');
    });
    const replaced = q.enqueue('file', 'a', async () => 'later');
    const replacedAgain = q.enqueue('file', 'a', async () => {
      throw new Error('still full');
    });
    await assert.rejects(bad, /disk full/);
    await assert.rejects(replaced, /still full/);
    await assert.rejects(replacedAgain, /still full/);
    assert.equal(await q.enqueue('file', 'a', async () => 'ok'), 'ok');
  }

  console.log('latest-wins selftest ok');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
