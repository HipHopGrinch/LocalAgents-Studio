/**
 * Run: npx --yes tsx src/lib/buildGate.selftest.ts
 */
import assert from 'node:assert/strict';
import {
  contextWasExhausted,
  fitPromptToContext,
  promptFillsContext,
  shrinkUserPacket
} from './contextMonitor';
import { indexHtmlIsBlankShell, webEntryVerifyErrors } from './webEntryGate';

const blank = `<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>`;
const visible = `<!doctype html><html><body style="background:#111"><h1>3D Checkers</h1></body></html>`;
assert.equal(indexHtmlIsBlankShell(blank), true);
assert.equal(indexHtmlIsBlankShell(visible), false);

const errors = webEntryVerifyErrors({
  delivery: 'web',
  indexHtml: blank,
  css: '* { box-sizing: border-box; }',
  sourceSample: 'className="flex bg-slate-900 text-white"'
});
assert.match(errors, /TS9001/);
assert.match(errors, /TS9002/);
assert.equal(webEntryVerifyErrors({ delivery: 'electron', indexHtml: blank }), '');

const fat = `REPO MAP\n${'file.ts\n'.repeat(4000)}\n## Task\n${'x'.repeat(20000)}`;
const shrunk = shrinkUserPacket(fat, 2);
assert.ok(shrunk.length < fat.length);
assert.match(shrunk, /Context monitor/);

const fitted = fitPromptToContext({
  system: 'sys',
  userContent: fat,
  history: [
    { role: 'user', content: 'a'.repeat(8000) },
    { role: 'assistant', content: 'b'.repeat(8000) }
  ],
  maxCtx: 4096
});
assert.ok(fitted.shrinks > 0);
assert.equal(fitted.history.length, 0);
assert.equal(promptFillsContext(100, 4096), false);
assert.equal(contextWasExhausted({ doneReason: 'length', evalCount: 10 }, 16384), true);
assert.equal(contextWasExhausted({ promptEvalCount: 15000, evalCount: 10 }, 16384), true);
assert.equal(contextWasExhausted({ promptEvalCount: 1000, evalCount: 400, doneReason: 'stop' }, 16384), false);

console.log('buildGate.selftest ok');
