/**
 * Run: npx --yes tsx src/lib/agentLoop.selftest.ts
 */
import assert from 'node:assert/strict';
import type { ChatMessage, ToolCall } from '../types';
import {
  buildContinuationUserPrompt,
  capToolResultText,
  createEditRepeatGuard,
  editOutcomeKey,
  formatEditMismatch,
  fulfillInOrder,
  historyForModel,
  isRepeatedEditStop,
  nearestSearchHint,
  REPEATED_EDIT_STOP,
  rememberEditOutcome,
  resetEditRepeatGuard,
  shouldContinueFromTools,
  stripThinkingForHistory,
  isDestructiveCommand
} from './agentLoop';

const file = ['alpha', 'beta', 'gamma line', 'delta'].join('\n');
const hint = nearestSearchHint(file, 'gamme line');
assert.match(hint, /Nearest lines/);
assert.match(hint, /gamma line/);

const body = `<<<<<<< SEARCH
gamme line
=======
gamma line
>>>>>>> REPLACE`;
const mismatch = formatEditMismatch(file, body, 'Block 1: SEARCH text not found in the file.');
assert.match(mismatch, /Diff failed/);
assert.match(mismatch, /gamma line/);
assert.equal(formatEditMismatch(file, body, 'Block 1: SEARCH text matches 2 places.'), 'Diff failed: Block 1: SEARCH text matches 2 places.');

const guard = createEditRepeatGuard();
const search = body;
const after = 'alpha\nbeta\ngamma line\ndelta';
const key = editOutcomeKey('src/App.tsx', search, after);
assert.equal(rememberEditOutcome(guard, key), false);
assert.equal(rememberEditOutcome(guard, key), true);
const changed = editOutcomeKey('src/App.tsx', search, after + '\nmore');
assert.equal(rememberEditOutcome(guard, changed), false);
resetEditRepeatGuard(guard);
assert.equal(rememberEditOutcome(guard, key), false);

const repeatTool = {
  id: 'e1',
  name: 'edit_file',
  args: { path: 'src/App.tsx' },
  status: 'error',
  result: REPEATED_EDIT_STOP
} as ToolCall;
assert.equal(isRepeatedEditStop(repeatTool.result), true);
assert.equal(shouldContinueFromTools([repeatTool]), true);
assert.equal(shouldContinueFromTools([repeatTool], { writeFixAttempts: 1 }), false);
assert.match(buildContinuationUserPrompt([repeatTool]), /repeated an edit/i);
assert.equal(
  shouldContinueFromTools([
    { id: 'w', name: 'write_file', args: { path: 'a.ts' }, status: 'error', result: 'disk full' } as ToolCall
  ]),
  true
);

const fat = Array.from({ length: 120 }, (_, i) => (i === 50 ? 'error TS2322: nope' : `row ${i} ${'x'.repeat(80)}`)).join(
  '\n'
);
const capped = capToolResultText(fat, 'tight');
assert.ok(capped.length <= 8000 + 64);
assert.match(capped, /error TS2322/);
assert.match(capped, /row 0/);
assert.match(capped, /row 119/);
assert.match(capped, /more lines/);
assert.equal(capToolResultText('short ok', 'tight'), 'short ok');
const tightPrompt = buildContinuationUserPrompt(
  [{ id: 'r', name: 'read_file', args: { path: 'a.ts' }, status: 'done', result: fat } as ToolCall],
  { tier: 'tight' }
);
assert.ok(tightPrompt.length < 9000);
assert.match(tightPrompt, /error TS2322/);

assert.equal(stripThinkingForHistory('<think>hidden forever'), '');
assert.equal(stripThinkingForHistory('<think>hidden</think> visible'), 'visible');

const history = historyForModel(
  [
    {
      id: '1',
      role: 'assistant',
      raw: '<think>secret reasoning that is not closed\nUNIQUE_THOUGHT',
      display: '',
      timestamp: '',
      toolCalls: [
        {
          id: 'r',
          name: 'read_file',
          args: { path: 'src/App.tsx' },
          status: 'done',
          result: `UNIQUE_BODY_LINE\n${'z'.repeat(200)}`
        }
      ]
    } as ChatMessage,
    {
      id: '2',
      role: 'assistant',
      raw: '<write_file path="src/App.tsx">FULL_BODY_SECRET\nline2</write_file>\nDone.',
      display: '',
      timestamp: ''
    } as ChatMessage
  ],
  text => text
);
assert.equal(history.some(m => m.content.includes('UNIQUE_THOUGHT')), false);
assert.equal(history.some(m => m.content.includes('UNIQUE_BODY_LINE')), false);
assert.match(history[0].content, /Read src\/App\.tsx \(2 lines\)/);
assert.equal(history.some(m => m.content.includes('FULL_BODY_SECRET')), false);
assert.match(history[1].content, /body omitted/);
assert.match(history[1].content, /Done\./);

const order: number[] = [];
void fulfillInOrder(['a', 'b', 'c'], [
  {
    index: 0,
    run: async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
      order.push(0);
      return 'A';
    }
  },
  {
    index: 2,
    run: async () => {
      order.push(2);
      return 'C';
    }
  }
]).then(placed => {
  assert.deepEqual(placed, ['A', 'b', 'C']);
  assert.deepEqual(order, [2, 0]);
  console.log('agentLoop.selftest ok');
}).catch(err => {
  console.error(err);
  process.exit(1);
});

// B-42 / B-43 / B-44: destructive-command policy (shared with electron/sandbox.cjs)
for (const cmd of [
  'rm -Recurse -Force .\\src',
  'del -Recurse -Force .\\src',
  'Remove-Item -Recurse .\\src',
  'rd /s /q src',
  'rmdir -r src',
  'erase -Recurse x',
  'ri -r x',
  'git.exe reset --hard',
  'git -C . reset --hard',
  'git -c core.x=y reset --hard HEAD~1',
  'git checkout HEAD -- .',
  'git checkout main -- .',
  'Format-Volume -DriveLetter C -Force',
  'Clear-Disk -Number 1',
  'Initialize-Disk 1',
  'Remove-Partition -DriveLetter D',
  'Remove-Item -Recurse -Force .\\src',
  'rm -rf src',
  'git reset --hard',
  'git push --force origin main',
  'git clean -fd',
  'git checkout -- .',
  'format C:',
  'diskpart'
]) {
  assert.equal(isDestructiveCommand(cmd), true, 'should block: ' + cmd);
}
for (const cmd of [
  'Remove-Item .\\dist\\old.js',
  'rm .\\tmp.txt',
  'git status',
  'git checkout -b feature',
  'git checkout src/app.ts',
  'npm run format',
  'git reset src/app.ts',
  'docker run --rm -it node',
  'git rm -r --cached dist'
]) {
  assert.equal(isDestructiveCommand(cmd), false, 'should allow: ' + cmd);
}
