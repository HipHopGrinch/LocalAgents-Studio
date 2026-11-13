/**
 * Run: node scripts/analyze-run-log.selftest.cjs
 * Asserts the analyzer finds the known waste in a real 4-step run log (scripts/fixtures).
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseRunLogMarkdown, analyzeText, loadRunLog } = require('./analyze-run-log.cjs');

const runLog = loadRunLog();
const fixtureDir = path.join(__dirname, 'fixtures');
const runPath = path.join(fixtureDir, 'connect4-run.md');
const planPath = path.join(fixtureDir, 'connect4-plan.json');
const markdown = fs.readFileSync(runPath, 'utf8');

assert.ok(fs.statSync(runPath).size < 70 * 1024, 'run fixture stays small');
assert.ok(
  !/(sk-[A-Za-z0-9_-]{8,}|AIzaSy|ghp_|xai-|Bearer\s+[A-Za-z0-9._-]{12,})/.test(markdown + fs.readFileSync(planPath, 'utf8')),
  'fixtures hold no key-like strings'
);

// Parser: event counts per kind match the `counts:` header line the log wrote about itself.
const events = parseRunLogMarkdown(markdown);
const headerCounts = {};
const countsLine = /^counts: (.*)$/m.exec(markdown);
assert.ok(countsLine, 'fixture has a counts line');
for (const part of countsLine[1].split(', ')) {
  const [kind, n] = part.split(' ');
  headerCounts[kind] = Number(n);
}
const parsedCounts = {};
for (const event of events) parsedCounts[event.kind] = (parsedCounts[event.kind] || 0) + 1;
assert.deepEqual(parsedCounts, headerCounts);

// Turn parsing keeps node names with spaces and numeric fields.
const firstWorker = events.find(e => e.kind === 'turn' && e.phase === 'swarm-worker');
assert.ok(firstWorker);
assert.equal(firstWorker.role, 'coder');
assert.equal(firstWorker.nodeName, 'Local Ollama');
assert.equal(firstWorker.numCtx, 24576);
assert.equal(firstWorker.wallMs, 6400);
assert.equal(firstWorker.doneReason, 'stop');

const result = analyzeText(runLog, markdown);
const waste = result.waste;

// (1) writes rejected as duplicates after a full generation.
assert.ok(waste.rejectedWrites.count >= 7, `rejected writes: ${waste.rejectedWrites.count}`);
assert.equal(waste.rejectedWrites.count, 13);
assert.ok(waste.rejectedWrites.ms > 6 * 60 * 1000, 'rejected writes cost more than six minutes of turns');

// (2) duplicate dispatch normalised across leading folders.
const dupes = waste.duplicateDispatch.pairs.map(p => `${p.file.toLowerCase()}|${p.duplicateOf.toLowerCase()}`);
assert.ok(dupes.includes('scene/constants.ts|src/scene/constants.ts'));
assert.ok(dupes.includes('game/types.ts|src/game/types.ts'));
assert.ok(dupes.includes('components/hud.tsx|src/components/hud.tsx'));
assert.equal(waste.duplicateDispatch.count, 17);

// (3) Reviewer spent while verify was red, incl. the step-1 yay->nay (verify failed).
assert.ok(waste.reviewerOnRed.yayToNay >= 1);
assert.ok(waste.reviewerOnRed.count >= 4);
assert.ok(waste.reviewerOnRed.ms >= 4000);
const step1 = result.steps.find(s => s.stepId === '1');
assert.ok(step1, 'step 1 row');
assert.deepEqual(step1.verdicts, ['yay->nay', 'yay']);
assert.equal(step1.reworks, 1);

// (4)/(5)/(7) patterns the real run did not hit stay at zero.
assert.equal(waste.cutOffVerdicts.count, 0);
assert.equal(waste.noOpReworks.count, 0);
assert.equal(waste.thinkingAteBudget.count, 0);

// (6) the same compiler fingerprint failing verify again and again.
assert.ok(waste.repeatedFingerprint.count >= 3);
assert.equal(waste.repeatedFingerprint.fingerprints[0].fingerprint, 'enfgmv5_2');

assert.ok(waste.wastedMs > 0 && waste.wastedMs < waste.totalTurnMs);
const lines = runLog.formatRunWasteLines(waste);
assert.ok(lines[0].startsWith('waste: rejected-writes 13 ('));
assert.match(lines[1], /^est\. wasted ~\d+m\d{2}s of \d+m\d{2}s total$/);

// Timeline: every plan step shows up, in order, with the known rework/heal counts.
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const planIds = plan.steps.map(s => String(s.id));
assert.deepEqual(
  result.steps.map(s => s.stepId).filter(id => id !== '-'),
  planIds
);
const step3 = result.steps.find(s => s.stepId === '3');
assert.equal(step3.reworks, 2);
assert.equal(step3.heals, 2);
assert.deepEqual(step3.verdicts, ['nay', 'nay', 'nay', 'nay', 'yay']);
assert.ok(step3.coderMs > step3.reviewMs);

// Top turns: five, most expensive first (the 122.2 s follow-up write).
assert.equal(result.topTurns.length, 5);
assert.equal(result.topTurns[0].wallMs, 122200);
assert.equal(result.topTurns[0].stepId, '3');
for (let i = 1; i < result.topTurns.length; i += 1) {
  assert.ok(result.topTurns[i - 1].wallMs >= result.topTurns[i].wallMs);
}

// Round trip: render a synthetic log with the real renderer, parse it back, same analysis.
const log = runLog.createRunLog({ now: () => 1_700_000_000_000 });
let t = 1_700_000_000_000;
const at = secs => {
  t += secs * 1000;
  return t;
};
log.startRun({ runId: 1, conversationId: 'chat-x', label: 'send' });
log.add({
  kind: 'swarm-assign',
  t: at(1),
  assignments: [
    { wave: 0, file: 'src/lib/a.ts', node: 'Laptop 3060', model: 'm:1' },
    { wave: 1, file: 'lib\\A.ts', node: 'Laptop 3060', model: 'm:1' },
    { wave: 2, file: 'src/lib/b.ts', node: 'Laptop 3060', model: 'm:1' }
  ]
});
log.add({
  kind: 'turn',
  t: at(5),
  role: 'coder',
  model: 'm:1',
  nodeName: 'Laptop 3060',
  phase: 'swarm-worker',
  evalCount: 400,
  wallMs: 7000,
  doneReason: 'stop'
});
log.add({
  kind: 'tool',
  t: at(0),
  name: 'write_file',
  path: 'lib/A.ts',
  status: 'error',
  stepId: '1',
  result: 'Rejected lib/A.ts: that module already exists as src/lib/a.ts. Edit src/lib/a.ts instead of creating a second copy.'
});
log.add({
  kind: 'turn',
  t: at(3),
  role: 'reviewer',
  model: 'cloud:1',
  nodeName: 'Cloud Frontier',
  phase: 'verdict',
  evalCount: 9,
  doneReason: 'length',
  reasoningTokens: 4000,
  think: 'high',
  wallMs: 4000
});
log.add({ kind: 'verdict', t: at(0), result: 'nay', stepId: '1', text: 'yay->nay (verify failed)' });
const rendered = log.formatMarkdown();
assert.match(rendered, /think=high/);
assert.match(rendered, /reasoning=4000/);
const roundTrip = analyzeText(runLog, rendered);
assert.deepEqual(roundTrip.waste, runLog.analyzeRunWaste(log.events()));
assert.equal(roundTrip.waste.rejectedWrites.count, 1);
assert.equal(roundTrip.waste.rejectedWrites.ms, 7000);
assert.equal(roundTrip.waste.duplicateDispatch.count, 1);
assert.equal(roundTrip.waste.cutOffVerdicts.count, 1);
assert.equal(roundTrip.waste.reviewerOnRed.yayToNay, 1);
const parsedTurn = parseRunLogMarkdown(rendered).find(e => e.kind === 'turn' && e.phase === 'verdict');
assert.equal(parsedTurn.think, 'high');
assert.equal(parsedTurn.reasoningTokens, 4000);
assert.equal(parsedTurn.nodeName, 'Cloud Frontier');

// CLI: text and --json on the fixture, and a missing file fails without a stack trace.
const cli = path.join(__dirname, 'analyze-run-log.cjs');
const text = spawnSync(process.execPath, [cli, runPath], { encoding: 'utf8' });
assert.equal(text.status, 0, text.stderr);
assert.match(text.stdout, /^waste: rejected-writes 13/m);
assert.match(text.stdout, /scene\/constants\.ts == src\/scene\/constants\.ts/);
assert.match(text.stdout, /top 5 most expensive turns:/);
const asJson = spawnSync(process.execPath, [cli, runPath, '--json'], { encoding: 'utf8' });
assert.equal(asJson.status, 0, asJson.stderr);
const parsed = JSON.parse(asJson.stdout);
assert.equal(parsed.files.length, 1);
assert.equal(parsed.files[0].waste.rejectedWrites.count, 13);
const missing = spawnSync(process.execPath, [cli, path.join(fixtureDir, 'nope.md')], { encoding: 'utf8' });
assert.equal(missing.status, 1);
assert.match(missing.stderr, /Cannot read/);

console.log('analyze-run-log selftest: ok');
