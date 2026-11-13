/**
 * Run: npx --yes tsx src/lib/runLog.selftest.ts
 */
import assert from 'node:assert/strict';
import {
  analyzeRunWaste,
  computeTokPerSec,
  createRunLog,
  formatRunWasteLines,
  formatWasteDuration,
  summarizeRunSteps,
  redactRunLogText,
  runLogFileName,
  runLogPath,
  shapeToolForRunLog,
  summarizeStats
} from './runLog';

const sentence = 'The coder finished the turn and the reviewer said yay.';
assert.equal(redactRunLogText(sentence), sentence);
assert.equal(
  redactRunLogText('Discuss the token budget and the password policy later.'),
  'Discuss the token budget and the password policy later.'
);

assert.equal(redactRunLogText('sk-or-v1-abc_DEF-123'), 'sk-or-v1-[redacted]');
assert.equal(redactRunLogText('sk-abcdefgh'), 'sk-[redacted]');
assert.equal(redactRunLogText('sk-abcdefg'), 'sk-abcdefg');
assert.equal(redactRunLogText('xai-secret_key'), 'xai-[redacted]');
assert.equal(redactRunLogText('XAI-secret'), 'xai-[redacted]');
assert.equal(redactRunLogText(`AIzaSy${'a'.repeat(20)}`), 'AIzaSy[redacted]');
assert.equal(redactRunLogText(`AIzaSy${'a'.repeat(19)}`), `AIzaSy${'a'.repeat(19)}`);
assert.equal(redactRunLogText('Bearer abc.DEF-123/+=_'), 'Bearer [redacted]');
assert.equal(redactRunLogText('"apiKey":"super"'), '"apiKey":"[redacted]"');
assert.equal(redactRunLogText('"apiKey" : "super"'), '"apiKey":"[redacted]"');

for (const key of [
  'api_key',
  'api-key',
  'apikey',
  'token',
  'password',
  'passphrase',
  'authorization',
  'x-goog-api-key'
]) {
  assert.equal(redactRunLogText(`${key}=sekret`), `${key}=[redacted]`);
  assert.equal(redactRunLogText(`${key}: sekret`), `${key}=[redacted]`);
}
assert.equal(redactRunLogText('Password=sekret'), 'Password=[redacted]');
assert.equal(redactRunLogText('x-goog-api-key=abc.def'), 'x-goog-api-key=[redacted]');

assert.equal(
  redactRunLogText('https://ada:s3cret@example.com/db'),
  'https://[redacted]@example.com/db'
);
assert.equal(
  redactRunLogText('postgres://ada:s3cret@localhost:5432/app'),
  'postgres://[redacted]@localhost:5432/app'
);
assert.equal(redactRunLogText('https://example.com/src/lib/runLog.ts'), 'https://example.com/src/lib/runLog.ts');
assert.equal(
  redactRunLogText('https://api.example.com/v1?key=abc123&q=hello'),
  'https://api.example.com/v1?key=[redacted]&q=hello'
);
assert.equal(
  redactRunLogText('https://api.example.com/v1?api_key=sekret&access_token=tok&token=t'),
  'https://api.example.com/v1?api_key=[redacted]&access_token=[redacted]&token=[redacted]'
);
assert.equal(redactRunLogText('{"api_key":"abc","token":"t"}'), '{"api_key":"[redacted]","token":"[redacted]"}');
assert.equal(redactRunLogText('"api-key": "abc"'), '"api-key":"[redacted]"');
assert.equal(redactRunLogText('"apikey":"abc"'), '"apikey":"[redacted]"');
assert.equal(redactRunLogText('"access_token":"tok"'), '"access_token":"[redacted]"');
assert.equal(redactRunLogText('"secret":"s"'), '"secret":"[redacted]"');
assert.equal(redactRunLogText('"password":"p"'), '"password":"[redacted]"');
assert.equal(redactRunLogText('GEMINI_KEY=abc123'), 'GEMINI_KEY=[redacted]');
assert.equal(redactRunLogText('AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI'), 'AWS_SECRET_ACCESS_KEY=[redacted]');
assert.equal(
  redactRunLogText('DATABASE_URL=postgres://ada:s3cret@localhost/db'),
  'DATABASE_URL=postgres://[redacted]@localhost/db'
);
assert.equal(redactRunLogText('ghp_1234567890abcdefghij'), 'ghp_[redacted]');
assert.equal(redactRunLogText(`github_pat_${'A'.repeat(22)}`), 'github_pat_[redacted]');
assert.equal(redactRunLogText('glpat-abc123def456ghi789'), 'glpat-[redacted]');
assert.equal(redactRunLogText('xoxb-1234567890-abcdefghij'), 'xoxb-[redacted]');
assert.equal(
  redactRunLogText('The path is src/components/AgentChat.tsx and the token budget is fine.'),
  'The path is src/components/AgentChat.tsx and the token budget is fine.'
);
assert.equal(redactRunLogText('key points are listed below'), 'key points are listed below');

assert.deepEqual(
  shapeToolForRunLog({ name: 'read_file', status: 'done', result: 'secret file\nline 2' }),
  { result: '18 bytes, 2 lines' }
);
assert.deepEqual(
  shapeToolForRunLog({ name: 'search', status: 'done', result: 'hit' }),
  { result: '3 bytes, 1 lines' }
);
assert.equal(
  shapeToolForRunLog({ name: 'read_file', status: 'done', result: 'GEMINI_KEY=abc' }).result?.includes('GEMINI_KEY'),
  false
);
assert.deepEqual(
  shapeToolForRunLog({ name: 'write_file', status: 'done', result: 'Wrote file src/a.ts\nfull body' }),
  {}
);
assert.deepEqual(
  shapeToolForRunLog({ name: 'edit_file', status: 'error', result: 'Could not apply the edit.' }),
  { result: 'Could not apply the edit.' }
);
assert.deepEqual(
  shapeToolForRunLog({
    name: 'run_command',
    status: 'error',
    result: 'Blocked destructive command. Run it yourself if you really want it: rm -rf /'
  }),
  { result: 'blocked destructive command' }
);
assert.deepEqual(
  shapeToolForRunLog({ name: 'run_command', status: 'done', result: 'Ran: npm test' }),
  { result: 'ran (no output)' }
);
assert.deepEqual(
  shapeToolForRunLog({
    name: 'run_command',
    status: 'error',
    result: `Exit code: 1\n${'x'.repeat(900)}\nGEMINI_KEY=abc`
  }).exitCode,
  1
);
{
  const shaped = shapeToolForRunLog({
    name: 'run_command',
    status: 'error',
    result: `Exit code: 1\n${'x'.repeat(900)}\nboom`
  });
  assert.equal(shaped.exitCode, 1);
  assert.ok((shaped.result?.length || 0) <= 800);
  assert.equal(shaped.result?.includes('Exit code'), false);
  assert.equal(shaped.result?.endsWith('boom'), true);
}

assert.equal(
  redactRunLogText('C:\\Users\\Ada\\AppData\\Local\\x'),
  'C:\\Users\\<user>\\AppData\\Local\\x'
);
assert.equal(redactRunLogText('D:/Users/Bob/proj/file.ts'), 'D:\\Users\\<user>\\proj/file.ts');
assert.equal(redactRunLogText('c:\\users\\ada\\x'), 'c:\\Users\\<user>\\x');
assert.equal(redactRunLogText('C:\\Windows\\System32\\cmd.exe'), 'C:\\Windows\\System32\\cmd.exe');
assert.equal(
  redactRunLogText('C:\\Users\\Ada\\a D:\\Users\\Bob\\b'),
  'C:\\Users\\<user>\\a D:\\Users\\<user>\\b'
);

{
  const log = createRunLog({ now: () => 1 });
  log.add({ kind: 'error', text: 'token=sekret see C:\\Users\\Ada\\proj' });
  log.add({
    kind: 'tool',
    name: 'write_file',
    path: 'C:\\Users\\Ada\\proj\\a.ts',
    status: 'done',
    result: 'ok'
  });
  log.add({
    kind: 'swarm-assign',
    assignments: [{ file: 'a.ts', skippedReason: 'Bearer sekret.token' }]
  });
  log.startRun({ runId: 1, conversationId: 'c', settings: { note: 'api_key=sekret' } });
  const stored = log.events();
  const err = stored[0];
  const tool = stored[1];
  const swarm = stored[2];
  const start = stored[3];
  assert.equal(err?.kind, 'error');
  if (err?.kind === 'error') {
    assert.equal(err.text.includes('sekret'), false);
    assert.equal(err.text.includes('Ada'), false);
    assert.match(err.text, /token=\[redacted\]/);
    assert.match(err.text, /C:\\Users\\<user>\\/);
  }
  if (tool?.kind === 'tool') {
    assert.equal(tool.path, 'C:\\Users\\<user>\\proj\\a.ts');
    assert.equal(tool.path?.includes('Ada'), false);
  }
  if (swarm?.kind === 'swarm-assign') {
    assert.equal(swarm.assignments[0]?.skippedReason, 'Bearer [redacted]');
    assert.equal(swarm.assignments[0]?.skippedReason?.includes('sekret'), false);
  }
  if (start?.kind === 'run-start') assert.equal(start.settings?.note, 'api_key=[redacted]');
  const plain = log.formatPlain();
  assert.equal(plain.includes('sekret'), false);
  assert.equal(plain.includes('Ada'), false);
}

assert.equal(runLogFileName('chat/1'), 'run-chat_1.md');
assert.equal(runLogFileName('ok.id-1'), 'run-ok.id-1.md');
assert.equal(runLogFileName('a b'), 'run-a_b.md');
assert.equal(runLogPath('D:\\proj', 'chat/1'), 'D:\\proj\\.localagents\\logs\\run-chat_1.md');
assert.equal(runLogPath('D:\\proj\\', 'chat/1'), 'D:\\proj\\.localagents\\logs\\run-chat_1.md');
assert.equal(runLogPath('D:\\proj/sub', 'a'), 'D:\\proj/sub\\.localagents\\logs\\run-a.md');
assert.equal(runLogPath('/home/me/proj', 'chat/1'), '/home/me/proj/.localagents/logs/run-chat_1.md');
assert.equal(runLogPath('/home/me/proj/', 'ok'), '/home/me/proj/.localagents/logs/run-ok.md');
assert.equal(runLogPath('D:/proj', 'a'), 'D:/proj/.localagents/logs/run-a.md');

assert.deepEqual(summarizeStats(undefined), {});
assert.deepEqual(summarizeStats({ evalCount: Number.NaN, totalDuration: Number.POSITIVE_INFINITY }), {});
assert.deepEqual(
  summarizeStats({
    evalCount: 10,
    evalDuration: 500,
    promptEvalCount: 20,
    promptEvalDuration: 5,
    loadDuration: 7,
    totalDuration: 800,
    doneReason: 'stop',
    reasoningTokens: 3
  }),
  {
    promptEvalCount: 20,
    evalCount: 10,
    doneReason: 'stop',
    totalDurationNs: 800,
    evalDurationNs: 500,
    reasoningTokens: 3
  }
);

{
  const log = createRunLog({ maxEvents: 2, maxChars: 200_000, now: () => 1 });
  log.add({ kind: 'info', text: 'one' });
  log.add({ kind: 'info', text: 'two' });
  log.add({ kind: 'info', text: 'three' });
  assert.deepEqual(
    log.events().map(event => (event.kind === 'info' ? event.text : '')),
    ['two', 'three']
  );
  assert.equal(log.stats().dropped, 1);
  assert.match(log.formatMarkdown(), /^dropped: 1 \(oldest events removed\)$/m);
  log.add({ kind: 'info', text: 'four' });
  assert.equal(log.stats().dropped, 2);
  const snap = log.events();
  log.clear();
  assert.equal(snap.length, 2);
  assert.equal(log.events().length, 0);
  assert.equal(log.stats().dropped, 0);
  assert.match(log.formatMarkdown(), /^dropped: 0$/m);
}

{
  const log = createRunLog({ maxEvents: 10, maxChars: 100, now: () => 2 });
  log.add({ kind: 'info', text: `FIRST ${'a'.repeat(400)}` });
  log.add({ kind: 'info', text: `SECOND ${'b'.repeat(400)}` });
  const left = log.events();
  assert.equal(left.length, 1);
  assert.equal(left[0]?.kind, 'info');
  if (left[0]?.kind === 'info') assert.equal(left[0].text.startsWith('SECOND'), true);
  assert.equal(log.stats().dropped, 1);
  const md = log.formatMarkdown();
  assert.match(md, /^dropped: 1 \(oldest events removed\)$/m);
  assert.equal(md.includes('FIRST'), false);
  assert.equal(md.includes('SECOND'), true);
}

{
  const log = createRunLog({ maxEvents: 50, maxChars: 500, now: () => 3 });
  for (let i = 0; i < 10; i += 1) log.add({ kind: 'info', text: `item-${i} ${'x'.repeat(80)}` });
  assert.ok(log.events().length >= 1);
  assert.ok(log.events().length < 10);
  assert.ok(log.stats().dropped >= 1);
  const last = log.events().at(-1);
  assert.equal(last?.kind, 'info');
  if (last?.kind === 'info') assert.equal(last.text.includes('item-9'), true);
}

{
  const log = createRunLog({ maxEvents: 2, now: () => 1 });
  log.startRun({ runId: 3, conversationId: 'c', label: 'x' });
  log.add({ kind: 'info', text: 'a' });
  log.add({ kind: 'info', text: 'b' });
  const mid = log.events();
  assert.equal(mid.length, 2);
  assert.equal(mid[0]?.runId, 3);
  assert.equal(mid[0]?.conversationId, 'c');
  assert.equal(mid[1]?.runId, 3);
  if (mid[0]?.kind === 'info') assert.equal(mid[0].text, 'a');
  log.endRun(3, 'stop');
  log.add({ kind: 'info', text: 'after' });
  const after = log.events().find(event => event.kind === 'info' && event.text === 'after');
  assert.equal(after?.kind, 'info');
  assert.equal(after?.runId, undefined);
}

{
  const log = createRunLog({ now: () => 4 });
  log.add({ kind: 'tool', name: 'run_command', result: 'hello\nExit code: 2\nboom' });
  log.add({ kind: 'tool', name: 'run_command', exitCode: 0, result: 'Exit code: 5\nignored' });
  log.add({ kind: 'tool', name: 'run_command', result: `Exit code: 4\n${'z'.repeat(4000)}` });
  const events = log.events();
  const parsed = events[0];
  const explicit = events[1];
  const clipped = events[2];
  assert.equal(parsed?.kind, 'tool');
  if (parsed?.kind === 'tool') assert.equal(parsed.exitCode, 2);
  if (explicit?.kind === 'tool') {
    assert.equal(explicit.exitCode, 0);
    assert.equal(explicit.result?.includes('Exit code: 5'), true);
  }
  if (clipped?.kind === 'tool') {
    assert.equal(clipped.exitCode, 4);
    assert.equal((clipped.result?.length ?? 0) < 4000, true);
    assert.match(clipped.result ?? '', /\[clipped \d+ chars\]/);
    assert.match(clipped.result ?? '', /Exit code: 4/);
  }
}

{
  const log = createRunLog({ now: () => 5 });
  log.add({
    kind: 'turn',
    role: 'coder',
    model: 'qwen',
    wallMs: 2500,
    ...summarizeStats({
      evalCount: 100,
      evalDuration: 2_000_000_000,
      promptEvalCount: 40,
      totalDuration: 2_500_000_000,
      doneReason: 'stop',
      reasoningTokens: 6
    })
  });
  log.add({ kind: 'turn', role: 'coder', model: 'qwen', evalCount: 10 });
  log.add({ kind: 'turn', role: 'coder', model: 'qwen', evalCount: 10, evalDurationNs: 0 });
  const first = log.events()[0];
  const second = log.events()[1];
  const third = log.events()[2];
  assert.equal(first?.kind, 'turn');
  if (first?.kind === 'turn') {
    assert.equal(first.tokPerSec, 50);
    assert.equal(first.evalCount, 100);
    assert.equal(first.evalDurationNs, 2_000_000_000);
    assert.equal(first.totalDurationNs, 2_500_000_000);
    assert.equal(first.promptEvalCount, 40);
    assert.equal(first.doneReason, 'stop');
    assert.equal(first.reasoningTokens, 6);
  }
  if (second?.kind === 'turn') assert.equal(second.tokPerSec, undefined);
  if (third?.kind === 'turn') assert.equal(third.tokPerSec, undefined);
  assert.match(log.formatMarkdown(), /50 tok\/s/);
}

// Tiny samples must not produce absurd tok/s or poison the role average
assert.equal(computeTokPerSec(1, 1_000), undefined, 'eval=1 over 1 microsecond');
assert.equal(computeTokPerSec(15, 2_000_000_000), undefined, 'below the minimum eval count');
assert.equal(computeTokPerSec(100, 1_000_000), undefined, 'duration under 20 ms');
assert.equal(computeTokPerSec(100, 0), undefined);
assert.equal(computeTokPerSec(16, 1_000_000_000), 16);
assert.equal(computeTokPerSec(200, 2_000_000_000), 100);
{
  const log = createRunLog({ now: () => 5 });
  log.add({ kind: 'turn', role: 'coder', model: 'qwen', evalCount: 1, evalDurationNs: 1_000 });
  log.add({ kind: 'turn', role: 'coder', model: 'qwen', evalCount: 100, evalDurationNs: 2_000_000_000 });
  const turns = log.events().filter(e => e.kind === 'turn');
  if (turns[0]?.kind === 'turn') assert.equal(turns[0].tokPerSec, undefined);
  if (turns[1]?.kind === 'turn') assert.equal(turns[1].tokPerSec, 50);
  assert.doesNotMatch(log.formatMarkdown(), /1,?000,?000/);
  const stats = log.stats();
  assert.equal(stats.turns[0]?.avgTokPerSec, 50);
}

{
  const log = createRunLog({ now: () => 6 });
  log.add({ kind: 'tool', name: 'a', status: 'error', result: 'Exit code: 1\ntool-a-failed' });
  log.add({ kind: 'tool', name: 'b', status: 'done', exitCode: 3, result: 'Exit code: 3\ntool-b-failed' });
  log.add({ kind: 'tool', name: 'c', status: 'done', exitCode: 0, result: 'ok' });
  log.add({ kind: 'tool', name: 'd', status: 'failed', result: 'tool-d-failed' });
  log.add({ kind: 'verify', ok: false, output: 'bad verify' });
  log.add({ kind: 'verify', ok: true, output: 'good verify' });
  log.add({ kind: 'verdict', result: 'nay' });
  log.add({ kind: 'verdict', result: 'missing' });
  log.add({ kind: 'verdict', result: 'yay' });
  log.add({ kind: 'route', action: 'failover' });
  log.add({ kind: 'route', action: 'retry' });
  log.add({ kind: 'route', action: 'stream-retry' });
  log.add({ kind: 'route', action: 'pin' });
  log.add({
    kind: 'route',
    action: 'fallback',
    text: 'Coder pick unavailable (Computer offline). Using automatic routing.'
  });
  log.add({ kind: 'user', action: 'retry' });
  log.add({ kind: 'context', action: 'resubmit' });
  log.add({ kind: 'context', action: 'fit' });
  log.add({ kind: 'pause', text: 'hold' });
  log.add({ kind: 'error', text: 'error-event' });
  const stats = log.stats();
  assert.equal(stats.failures.toolErrors, 2);
  assert.equal(stats.failures.nonZeroExits, 2);
  assert.equal(stats.failures.verifyFailures, 1);
  assert.equal(stats.failures.nay, 1);
  assert.equal(stats.failures.missingVerdicts, 1);
  assert.equal(stats.failures.failovers, 1);
  assert.match(log.formatMarkdown(), /route fallback/);
  assert.equal(stats.failures.retries, 3);
  assert.equal(stats.failures.contextResubmits, 1);
  assert.equal(stats.failures.pauses, 1);
  assert.equal(stats.failures.errors, 1);
  assert.equal(stats.failureTotal, 13);
  assert.equal(stats.byKind.tool, 4);
  assert.equal(stats.byKind.verify, 2);
  assert.equal(stats.byKind.verdict, 3);
  assert.equal(stats.byKind.route, 5);
  assert.equal(stats.byKind.user, 1);
  assert.equal(stats.byKind.context, 2);
  assert.equal(stats.byKind.pause, 1);
  assert.equal(stats.byKind.error, 1);
  assert.equal(stats.byKind['run-start'], 0);
  assert.equal(stats.turns.length, 0);
  assert.equal(stats.repeatedErrors.length, 0);
  assert.equal(stats.dropped, 0);
  const once = createRunLog({ now: () => 9 });
  once.add({ kind: 'tool', name: 'run_command', status: 'error', result: 'Exit code: 2\nfailed' });
  assert.equal(once.stats().failures.toolErrors, 1);
  assert.equal(once.stats().failures.nonZeroExits, 1);
  assert.equal(once.stats().failureTotal, 1);
  let kindSum = 0;
  for (const value of Object.values(stats.byKind)) kindSum += value ?? 0;
  assert.equal(kindSum, log.events().length);
}

{
  const empty = createRunLog({ now: () => 0 });
  const md = empty.formatMarkdown();
  const plain = empty.formatPlain();
  assert.match(md, /^# Run log$/m);
  assert.match(md, /^## SUMMARY$/m);
  assert.match(md, /^## TIMELINE$/m);
  assert.match(md, /^dropped: 0$/m);
  assert.match(md, /turns: none/);
  assert.match(plain, /^SUMMARY$/m);
  assert.match(plain, /^TIMELINE$/m);
  assert.match(plain, /\(no events\)/);
  assert.match(plain, /tool-errors 0/);
  assert.doesNotMatch(plain, /```/);
  assert.doesNotMatch(plain, /^#{1,6} /m);
}

{
  let now = 1_700_000_000_000;
  const log = createRunLog({ now: () => now });
  log.startRun({ runId: 7, conversationId: 'conv-1', label: 'ship it', settings: { swarm: true } });
  now += 5_000;
  log.add({ kind: 'user', action: 'send' });
  now += 70_000;
  log.add({
    kind: 'turn',
    role: 'coder',
    model: 'qwen',
    phase: 'implement',
    nodeName: 'Main',
    numCtx: 16384,
    evalCount: 100,
    evalDurationNs: 2_000_000_000,
    wallMs: 70_000,
    doneReason: 'stop',
    error: 'connection refused'
  });
  log.add({ kind: 'error', text: 'connection refused' });
  now += 1_000;
  log.add({
    kind: 'verify',
    ok: false,
    fingerprint: 'fp1',
    output: 'error TS2304: missing name\n  second line'
  });
  now += 1_000;
  log.add({ kind: 'heal', stepId: 's1', attempt: 1, max: 3, fingerprint: 'fp1', note: 'tsc failed' });
  now += 1_000;
  log.add({
    kind: 'swarm-assign',
    assignments: [
      { file: 'src/a.ts', node: 'laptop', model: 'qwen', wave: 1 },
      { file: 'src/b.ts', node: 'cloud', model: 'gemini', wave: 2, frontierBackup: true },
      { file: 'src/c.ts', wave: 2, skippedReason: 'offline' }
    ]
  });
  log.endRun(7, 'done');

  const user = log.events().find(event => event.kind === 'user');
  assert.equal(user?.runId, 7);
  assert.equal(user?.conversationId, 'conv-1');

  const stats = log.stats();
  assert.equal(stats.turns[0]?.role, 'coder');
  assert.equal(stats.turns[0]?.model, 'qwen');
  assert.equal(stats.turns[0]?.count, 1);
  assert.equal(stats.turns[0]?.avgTokPerSec, 50);
  assert.equal(stats.turns[0]?.evalTokens, 100);
  assert.equal(stats.longestTurns[0]?.wallMs, 70_000);
  assert.equal(stats.repeatedErrors[0]?.text, 'connection refused');
  assert.equal(stats.repeatedErrors[0]?.count, 2);
  assert.equal(stats.failures.errors, 1);
  assert.equal(stats.failures.verifyFailures, 1);

  const opts = { title: 'Run log', header: { version: '1.3.1', workspace: 'D:\\work\\demo' } };
  const md = log.formatMarkdown(opts);
  const plain = log.formatPlain(opts);
  assert.match(md, /^# Run log$/m);
  assert.match(md, /^## SUMMARY$/m);
  assert.match(md, /^## TIMELINE$/m);
  assert.match(md, /^## Run #7 \(ship it\)$/m);
  assert.match(md, /^version: 1\.3\.1$/m);
  assert.match(md, /^workspace: demo$/m);
  assert.equal(md.includes('D:\\work\\demo'), false);
  assert.match(md, /^ {2}swarm: true$/m);
  assert.match(md, /^dropped: 0$/m);
  assert.match(md, /generated: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
  assert.match(md, /- coder \/ qwen x 1 \| avg 50 tok\/s \| eval 100/);
  assert.match(md, /- 2x connection refused/);
  assert.match(md, /longest-turns:\n- \+01:15 coder \/ qwen wall=70s eval=100 50 tok\/s done=stop/);
  assert.match(md, /\+00:00 run-start/);
  assert.match(md, /\+00:05 user send/);
  assert.match(md, /\+01:15 turn coder\/qwen @Main/);
  assert.doesNotMatch(md, /\+01:10 /);
  assert.match(md, /50 tok\/s/);
  assert.match(md, /wall=70s/);
  assert.match(md, /verify FAIL fp=fp1/);
  assert.match(md, /```\nerror TS2304: missing name\n {2}second line\n```/);
  assert.match(md, /heal step=s1 attempt=1\/3 fp=fp1 tsc failed/);
  assert.match(md, /swarm-assign 3/);
  assert.match(md, /\n {2}wave=2 file=src\/b\.ts node=cloud model=gemini frontier-backup/);
  assert.match(md, /run-stop done/);
  assert.match(md, /conversation: conv-1/);
  assert.match(plain, /^Run log$/m);
  assert.match(plain, /^SUMMARY$/m);
  assert.match(plain, /^TIMELINE$/m);
  assert.match(plain, /^Run #7 \(ship it\)$/m);
  assert.match(plain, /\+00:05 user send/);
  assert.match(plain, /\+01:15 turn coder\/qwen/);
  assert.match(plain, /\n {2}error TS2304: missing name\n {4}second line/);
  assert.doesNotMatch(plain, /```/);
  assert.doesNotMatch(plain, /^#{1,6} /m);
  assert.equal(plain.includes('```'), false);
}

// B-49: single-quoted keys and values are redacted
assert.doesNotMatch(redactRunLogText("{'api_key': 'supersecretvalue'}"), /supersecretvalue/);
assert.doesNotMatch(redactRunLogText("{'password': 'hunter2hunter2'}"), /hunter2/);
assert.doesNotMatch(redactRunLogText('password = "my secret value"'), /secret value/);
assert.equal(redactRunLogText('{"apiKey":"abc123xyz"}'), '{"apiKey":"[redacted]"}');

// B-50: redact before taking the tail, so a key cut at the boundary does not survive
const cutKeyBody = 'A1b2C3d4E5'.repeat(4);
const cutKeyOutput = 'Exit code: 1\nprefix sk-' + cutKeyBody + ' ' + 'p'.repeat(759);
const cutKeyShaped = shapeToolForRunLog({ name: 'run_command', result: cutKeyOutput });
assert.ok(!(cutKeyShaped.result || '').includes(cutKeyBody));

// Turn think / reasoning fields: optional, clean, rendered only when present
{
  const log = createRunLog({ now: () => 1_000 });
  log.add({ kind: 'turn', t: 1_000, role: 'coder', model: 'm', wallMs: 1000 });
  log.add({ kind: 'turn', t: 2_000, role: 'coder', model: 'm', think: true, reasoningTokens: 120, wallMs: 1000 });
  log.add({ kind: 'turn', t: 3_000, role: 'coder', model: 'm', think: false, wallMs: 1000 });
  log.add({ kind: 'turn', t: 4_000, role: 'coder', model: 'm', think: ' high ', wallMs: 1000 });
  log.add({ kind: 'turn', t: 5_000, role: 'coder', model: 'm', think: '  ', wallMs: 1000 });
  log.add({ kind: 'turn', t: 6_000, role: 'coder', model: 'm', think: 7 as unknown as string, wallMs: 1000 });
  const turns = log.events().filter(event => event.kind === 'turn');
  const thinkOf = (index: number): unknown => (turns[index] as { think?: unknown }).think;
  assert.equal('think' in (turns[0] as object), false);
  assert.equal(thinkOf(1), true);
  assert.equal(thinkOf(2), false);
  assert.equal(thinkOf(3), 'high');
  assert.equal('think' in (turns[4] as object), false);
  assert.equal('think' in (turns[5] as object), false);
  const md = log.formatMarkdown();
  const turnLines = md.split('\n').filter(line => / turn coder\/m/.test(line));
  assert.equal(turnLines.length, 6);
  assert.doesNotMatch(turnLines[0] ?? '', /think=|reasoning=/);
  assert.match(turnLines[1] ?? '', /reasoning=120 think=on /);
  assert.match(turnLines[2] ?? '', / think=off /);
  assert.match(turnLines[3] ?? '', / think=high /);
  assert.doesNotMatch(turnLines[4] ?? '', /think=/);
  assert.doesNotMatch(turnLines[5] ?? '', /think=/);
}

// analyzeRunWaste: synthetic events, one per waste pattern
{
  assert.equal(formatWasteDuration(0), '0s');
  assert.equal(formatWasteDuration(400), '<1s');
  assert.equal(formatWasteDuration(4_300), '4s');
  assert.equal(formatWasteDuration(372_000), '6m12s');
  assert.equal(formatWasteDuration(65_000), '1m05s');

  // Empty and clean logs report nothing wasted.
  const empty = analyzeRunWaste([]);
  assert.equal(empty.wastedMs, 0);
  assert.deepEqual(formatRunWasteLines(empty), ['waste: none']);
  assert.match(createRunLog({ now: () => 0 }).formatMarkdown(), /^waste: none$/m);

  const log = createRunLog({ now: () => 0 });
  let at = 0;
  const tick = (secs: number): number => {
    at += secs * 1000;
    return at;
  };
  log.startRun({ runId: 1, conversationId: 'c' });
  // (2) one swarm-assign naming the same file twice (leading folder, slashes, case) and one distinct file
  log.add({
    kind: 'swarm-assign',
    t: tick(1),
    assignments: [
      { wave: 0, file: 'src/scene/constants.ts', node: 'a', model: 'm' },
      { wave: 1, file: 'scene\\Constants.ts', node: 'a', model: 'm' },
      { wave: 2, file: 'src/scene/Board.tsx', node: 'a', model: 'm' },
      { wave: 3, file: 'Board.tsx', node: 'a', model: 'm', skippedReason: 'skipped' },
      { wave: 4, file: 'src/xscene/constants.ts', node: 'a', model: 'm' }
    ]
  });
  // (1) two rejected writes from one 10 s turn count twice but blame the turn once; plus one from a 5 s turn
  log.add({ kind: 'turn', t: tick(10), role: 'coder', model: 'm', phase: 'swarm-worker', evalCount: 500, wallMs: 10_000, doneReason: 'stop' });
  const rejected = 'Rejected scene/constants.ts: that module already exists as src/scene/constants.ts. Edit it instead of creating a second copy.';
  log.add({ kind: 'tool', t: at, name: 'write_file', path: 'scene/constants.ts', status: 'error', stepId: '1', result: rejected });
  log.add({ kind: 'tool', t: at, name: 'write_file', path: 'scene/constants.ts', status: 'error', stepId: '1', result: rejected });
  log.add({ kind: 'turn', t: tick(5), role: 'coder', model: 'm', phase: 'swarm-worker', evalCount: 300, wallMs: 5_000, doneReason: 'stop' });
  log.add({ kind: 'tool', t: at, name: 'write_file', path: 'scene/Board.tsx', status: 'error', stepId: '1', result: rejected });
  // a successful write is not waste
  log.add({ kind: 'tool', t: at, name: 'write_file', path: 'src/ok.ts', status: 'done', stepId: '1' });
  // (6) the same fingerprint failing three times, plus fp=none and a different fingerprint
  log.add({ kind: 'verify', t: tick(1), ok: false, fingerprint: 'fpA_2', stepId: '1', output: 'error TS6133' });
  log.add({ kind: 'verify', t: tick(1), ok: false, fingerprint: 'fpA_2', stepId: '1', output: 'error TS6133' });
  // (3a) reviewer turn spent while verify is red (4 s), nay that does not read yay->nay
  log.add({ kind: 'turn', t: tick(4), role: 'reviewer', model: 'cloud', phase: 'verdict', evalCount: 300, wallMs: 4_000, doneReason: 'stop' });
  log.add({ kind: 'verdict', t: tick(1), result: 'nay', stepId: '1', text: 'bugs remain' });
  log.add({ kind: 'verify', t: tick(1), ok: false, fingerprint: 'fpA_2', stepId: '1' });
  log.add({ kind: 'verify', t: tick(1), ok: false, fingerprint: 'fpB_1', stepId: '1' });
  log.add({ kind: 'verify', t: tick(1), ok: true, fingerprint: 'none', stepId: '1' });
  // (3b) verify green before review, but the post-review verify flips yay->nay (3 s turn)
  log.add({ kind: 'turn', t: tick(3), role: 'reviewer', model: 'cloud', phase: 'verdict', evalCount: 300, wallMs: 3_000, doneReason: 'stop' });
  log.add({ kind: 'verify', t: tick(1), ok: false, fingerprint: 'fpC_1', stepId: '1' });
  log.add({ kind: 'verdict', t: tick(0), result: 'nay', stepId: '1', text: 'yay->nay (verify failed)' });
  // (4) cut-off verdicts: done=length, tiny eval (2 s each; the tiny one while verify is red is also on-red)
  log.add({ kind: 'turn', t: tick(2), role: 'reviewer', model: 'cloud', phase: 'verdict', evalCount: 800, wallMs: 2_000, doneReason: 'length' });
  log.add({ kind: 'verdict', t: tick(0), result: 'missing', stepId: '1' });
  log.add({ kind: 'verify', t: tick(1), ok: true, stepId: '1' });
  log.add({ kind: 'turn', t: tick(2), role: 'reviewer', model: 'cloud', phase: 'verdict', evalCount: 9, wallMs: 2_000, doneReason: 'stop' });
  log.add({ kind: 'verdict', t: tick(0), result: 'missing', stepId: '1' });
  // (7) a coder turn where thinking ate the budget (6 s), and a healthy done=length turn that did not
  log.add({ kind: 'turn', t: tick(6), role: 'coder', model: 'm', phase: 'coder', evalCount: 4, wallMs: 6_000, doneReason: 'length', think: true });
  log.add({ kind: 'turn', t: tick(6), role: 'coder', model: 'm', phase: 'coder', evalCount: 1000, reasoningTokens: 100, wallMs: 6_000, doneReason: 'length' });
  // (5) no-op rework, duplicated across notice+info with the same text, and a REPEATED_EDIT tool error
  log.add({ kind: 'info', t: tick(1), stepId: '1', text: 'Rework changed nothing: the Coder wrote the same bytes again' });
  log.add({ kind: 'info', t: at, stepId: '1', text: 'Rework changed nothing: the Coder wrote the same bytes again' });
  log.add({ kind: 'turn', t: tick(3), role: 'coder', model: 'm', phase: 'swarm-worker', evalCount: 90, wallMs: 3_000, doneReason: 'stop' });
  log.add({ kind: 'tool', t: at, name: 'edit_file', path: 'src/x.ts', status: 'error', stepId: '1', result: 'REPEATED_EDIT: identical hunk' });

  const waste = analyzeRunWaste(log.events());
  assert.equal(waste.rejectedWrites.count, 3);
  assert.equal(waste.rejectedWrites.ms, 15_000);
  assert.equal(waste.duplicateDispatch.count, 1);
  assert.deepEqual(waste.duplicateDispatch.pairs, [{ file: 'scene\\Constants.ts', duplicateOf: 'src/scene/constants.ts' }]);
  assert.equal(waste.repeatedFingerprint.count, 2);
  assert.deepEqual(waste.repeatedFingerprint.fingerprints, [{ fingerprint: 'fpA_2', count: 2 }]);
  assert.equal(waste.reviewerOnRed.count, 3);
  assert.equal(waste.reviewerOnRed.redBeforeReview, 2);
  assert.equal(waste.reviewerOnRed.yayToNay, 1);
  assert.equal(waste.reviewerOnRed.ms, 4_000 + 3_000 + 2_000);
  assert.equal(waste.cutOffVerdicts.count, 2);
  assert.equal(waste.cutOffVerdicts.ms, 4_000);
  assert.equal(waste.thinkingAteBudget.count, 1);
  assert.equal(waste.thinkingAteBudget.ms, 6_000);
  assert.equal(waste.noOpReworks.changedNothing, 1);
  assert.equal(waste.noOpReworks.repeatedEdits, 1);
  assert.equal(waste.noOpReworks.count, 2);
  assert.equal(waste.noOpReworks.ms, 3_000);
  // Nine turns, 41 s. Every turn but the healthy done=length one (6 s) is blamed once: 35 s.
  assert.equal(waste.totalTurnMs, 41_000);
  assert.equal(waste.wastedMs, 35_000);

  const lines = formatRunWasteLines(waste);
  assert.match(
    lines[0] ?? '',
    /^waste: rejected-writes 3 \(~15s\), duplicate-dispatch 1, reviewer-on-red 3 \(~9s\), cut-off-verdicts 2 \(~4s\), no-op-reworks 2 \(~3s\), repeated-fingerprint 2, thinking-ate-budget 1 \(~6s\)$/
  );
  assert.equal(lines[1], 'est. wasted ~35s of 41s total');
  const md = log.formatMarkdown();
  assert.match(md, /^waste: rejected-writes 3 /m);
  assert.ok(md.indexOf('failures:') < md.indexOf('waste:'));
  assert.ok(md.indexOf('waste:') < md.indexOf('repeated-errors:'));

  // The report is pure: a second run over the same events agrees.
  assert.deepEqual(analyzeRunWaste(log.events()), waste);

  // Patterns zero out, and a run id change does not carry state across runs.
  const clean = analyzeRunWaste([
    { t: 1, runId: 1, kind: 'verify', ok: false, fingerprint: 'same' },
    { t: 2, runId: 2, kind: 'verify', ok: false, fingerprint: 'same' }
  ]);
  assert.equal(clean.repeatedFingerprint.count, 0);
  const noPriorTurn = analyzeRunWaste([
    { t: 1, runId: 1, kind: 'turn', role: 'coder', model: 'm', wallMs: 9_000 },
    { t: 2, runId: 2, kind: 'tool', name: 'write_file', status: 'error', result: rejected }
  ]);
  assert.equal(noPriorTurn.rejectedWrites.count, 1);
  assert.equal(noPriorTurn.rejectedWrites.ms, 0);

  // summarizeRunSteps: per-step time split and top turns
  const { steps, topTurns } = summarizeRunSteps(log.events(), 3);
  const stepOne = steps.find(row => row.stepId === '1');
  assert.ok(stepOne);
  assert.equal(steps[0]?.stepId, '-');
  assert.equal(stepOne.reviewMs, 4_000 + 3_000 + 2_000 + 2_000);
  assert.equal(stepOne.coderMs, 5_000 + 6_000 + 6_000 + 3_000);
  assert.deepEqual(stepOne.verdicts, ['nay', 'yay->nay', 'missing', 'missing']);
  assert.equal(topTurns.length, 3);
  assert.equal(topTurns[0]?.wallMs, 10_000);
  assert.equal(topTurns[0]?.stepId, '-');
}

console.log('runLog.selftest ok');
