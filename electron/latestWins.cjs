'use strict';

/**
 * Keyed serial queue where a newer pending job replaces an older pending job with the same tag.
 * The running job is never interrupted. Every caller whose job was replaced gets the result of
 * the job that ran in its place, so a burst of whole-file saves holds at most one running and
 * one pending payload per tag instead of one payload per call.
 */
function createLatestWinsQueue() {
  /** @type {Map<string, { running: boolean, pending: Array<{ tag: string, fn: () => Promise<any>, waiters: Array<{ resolve: Function, reject: Function }> }> }>} */
  const lanes = new Map();

  async function drain(key, lane) {
    while (lane.pending.length) {
      const job = lane.pending.shift();
      let ok = true;
      let value;
      try {
        value = await job.fn();
      } catch (err) {
        ok = false;
        value = err;
      }
      for (const waiter of job.waiters) {
        if (ok) waiter.resolve(value);
        else waiter.reject(value);
      }
    }
    lane.running = false;
    if (lanes.get(key) === lane) lanes.delete(key);
  }

  function enqueue(key, tag, fn) {
    let lane = lanes.get(key);
    if (!lane) {
      lane = { running: false, pending: [] };
      lanes.set(key, lane);
    }
    return new Promise((resolve, reject) => {
      const waiters = [{ resolve, reject }];
      const at = lane.pending.findIndex(job => job.tag === tag);
      if (at >= 0) {
        // Replaced jobs hand their callers to the newer job; ordering follows the newest call.
        const [older] = lane.pending.splice(at, 1);
        waiters.unshift(...older.waiters);
      }
      lane.pending.push({ tag, fn, waiters });
      if (!lane.running) {
        lane.running = true;
        void drain(key, lane);
      }
    });
  }

  return { enqueue, size: () => lanes.size };
}

module.exports = { createLatestWinsQueue };
