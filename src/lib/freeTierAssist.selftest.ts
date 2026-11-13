/**
 * Run: node node_modules/tsx/dist/cli.mjs src/lib/freeTierAssist.selftest.ts
 */
import assert from 'node:assert/strict';
import { noteFreeTierRpmRequest, waitForFreeTierRpm } from './freeTierAssist';

async function main() {
  // A full RPM window makes the next request wait about a minute.
  for (let i = 0; i < 10; i++) noteFreeTierRpmRequest('rpm-stop');

  // A getter that flips to true mid-wait must stop the wait, not only a snapshot taken up front.
  const started = Date.now();
  let notes = 0;
  const waited = await waitForFreeTierRpm(
    { id: 'rpm-stop', freeTierRpm: 10 },
    {
      signal: {
        get aborted() {
          return Date.now() - started > 400;
        }
      },
      onWait: () => {
        notes++;
      }
    }
  );
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 3000, `wait stopped early (took ${elapsed}ms)`);
  assert.ok(waited < 3000, `reported wait stays short (${waited}ms)`);
  assert.ok(notes >= 1, 'onWait fired before the flip');

  // An already-aborted signal returns at once and does not claim an RPM slot.
  const immediate = await waitForFreeTierRpm(
    { id: 'rpm-stop', freeTierRpm: 10 },
    { signal: { aborted: true } }
  );
  assert.equal(immediate, 0);

  // A free window returns at once.
  assert.equal(await waitForFreeTierRpm({ id: 'rpm-free', freeTierRpm: 10 }), 0);

  console.log('freeTierAssist.selftest ok');
}

void main();
