/**
 * Run: npx --yes tsx src/lib/compactChat.selftest.ts
 */
import assert from 'node:assert/strict';
import { compactMessages, shouldCompact } from './compactChat';
import type { ChatMessage } from '../types';

function msg(id: string, role: 'user' | 'assistant', text: string, extra?: Partial<ChatMessage>): ChatMessage {
  return {
    id,
    role,
    raw: text,
    display: text,
    timestamp: '12:00',
    ...extra
  };
}

const body = '<write_file path="src/a.ts">\nSECRET_BODY\nconst value = 1;\n</write_file>';
const messages: ChatMessage[] = [
  msg('u1', 'user', 'please build the board'),
  msg('a1', 'assistant', 'starting'),
  msg('u2', 'user', 'continue'),
  msg('a2', 'assistant', 'still working'),
  msg('u3', 'user', 'finish src/a.ts'),
  msg('a3', 'assistant', body, {
    toolCalls: [
      {
        id: 't1',
        name: 'write_file',
        args: { path: 'src/a.ts' },
        body: 'SECRET_BODY\nconst value = 1;\n',
        status: 'done',
        result: 'SECRET_BODY wrote the file'
      }
    ]
  })
];

assert.equal(shouldCompact(messages.slice(0, 5), 8192), false);
const bulky = Array.from({ length: 6 }, (_, i) =>
  msg(`b${i}`, i % 2 ? 'assistant' : 'user', 'x'.repeat(3000))
);
assert.equal(shouldCompact(bulky, 8192), true);
assert.equal(shouldCompact(bulky, 200000), false);
assert.equal(shouldCompact(Array.from({ length: 6 }, (_, i) => msg(`s${i}`, 'user', 'short')), 4096), false);

const folded = compactMessages(messages, {
  planSummary: 'PLAN_ALPHA wire the board',
  contractPath: '.localagents/contract.ts',
  workLog: 'step 1 done'
});
assert.ok(folded.length < messages.length);
const summary = folded.find(m => m.raw.includes('[Compacted earlier chat]'));
assert.ok(summary, 'missing compacted summary');
assert.match(summary!.raw, /Plan: PLAN_ALPHA wire the board/);
assert.match(summary!.raw, /Contract: \.localagents\/contract\.ts/);
assert.match(summary!.raw, /Work log:\nstep 1 done/);
assert.ok(summary!.raw.indexOf('Plan:') < summary!.raw.indexOf('[Compacted earlier chat]'));

const lastAssistant = [...folded].reverse().find(m => m.role === 'assistant' && m.id === 'a3');
assert.ok(lastAssistant);
assert.doesNotMatch(lastAssistant!.raw, /SECRET_BODY/);
assert.doesNotMatch(lastAssistant!.display, /SECRET_BODY/);
assert.match(`${lastAssistant!.raw}\n${lastAssistant!.display}`, /src\/a\.ts/);
const write = lastAssistant!.toolCalls?.find(t => t.name === 'write_file');
assert.ok(write);
assert.equal(write!.args.path, 'src/a.ts');
assert.equal(write!.body, undefined);
assert.equal(write!.result, undefined);

const withCommand: ChatMessage[] = [
  msg('c1', 'user', 'run the tests'),
  msg('c2', 'assistant', 'one'),
  msg('c3', 'user', 'go'),
  msg('c4', 'assistant', 'ran it', {
    toolCalls: [
      {
        id: 'tc',
        name: 'run_command',
        args: { command: 'npm test' },
        body: 'npm test',
        status: 'done',
        result: 'Exit code: 0\nall passed'
      }
    ]
  }),
  msg('c5', 'user', 'again'),
  msg('c6', 'assistant', 'done')
];
const foldedCommand = compactMessages(withCommand);
const commandText = foldedCommand.map(m => `${m.raw}\n${m.display}`).join('\n');
assert.match(commandText, /Ran command \(exit 0\) — npm test/);
assert.doesNotMatch(commandText, /— Exit code: 0/);

console.log('compactChat.selftest ok');
