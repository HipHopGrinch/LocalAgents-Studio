/**
 * Run: npx --yes tsx src/lib/verifyGate.selftest.ts
 */
import assert from 'node:assert/strict';
import { NODE_VERIFY_COMMAND, TYPESCRIPT_VERIFY_COMMAND, verifyCommandForStack } from './deliveryIntent';
import {
  annotateMissingDependencies,
  beginVerify,
  errorFingerprint,
  formatErrorsForCoder,
  isNpmInstallCommand,
  isNpxTscCommand,
  localTscPowerShellCommand,
  planStackVerify,
  resolveVerifyCommand,
  typesCannotResolve,
  typescriptVerifyUsesCompiler,
  VERIFY_ERROR_PREVIEW
} from './verifyGate';

const moved = errorFingerprint([
  { file: 'src/App.tsx', line: 10, code: 'TS2322', message: 'Type string is not assignable to type number' }
]);
const movedAgain = errorFingerprint([
  { file: 'src\\App.tsx', line: 240, code: 'ts2322', message: 'Type string is not assignable to type number (240,8)' }
]);
const different = errorFingerprint([
  { file: 'src/App.tsx', line: 10, code: 'TS2322', message: 'Type boolean is not assignable to type number' }
]);
assert.equal(moved, movedAgain);
assert.notEqual(moved, different);
assert.equal(errorFingerprint([]), 'none');

assert.equal(isNpmInstallCommand('npm install'), true);
assert.equal(isNpmInstallCommand('npm ci'), true);
assert.equal(isNpmInstallCommand('npm run build'), false);
assert.equal(resolveVerifyCommand('typescript'), TYPESCRIPT_VERIFY_COMMAND);
assert.match(TYPESCRIPT_VERIFY_COMMAND, /tsc --noEmit --incremental/);
assert.match(TYPESCRIPT_VERIFY_COMMAND, /\.localagents\/tsconfig\.tsbuildinfo/);
assert.doesNotMatch(TYPESCRIPT_VERIFY_COMMAND, /\bnpx\b/);
assert.equal(isNpxTscCommand('npx tsc --noEmit'), true);
assert.equal(resolveVerifyCommand('typescript', 'npx tsc --noEmit'), TYPESCRIPT_VERIFY_COMMAND);
assert.equal(typescriptVerifyUsesCompiler(TYPESCRIPT_VERIFY_COMMAND), true);
assert.equal(typescriptVerifyUsesCompiler('npm run build'), false);
assert.equal(typesCannotResolve("src/a.ts(1,1): error TS2307: Cannot find module 'react'."), true);
assert.match(annotateMissingDependencies("error TS2307: Cannot find module 'react'."), /npm install/);
assert.match(localTscPowerShellCommand('node_modules/.bin/tsc.cmd'), /tsc\.cmd/);
assert.doesNotMatch(localTscPowerShellCommand('node_modules/.bin/tsc.cmd'), /npx/);
assert.doesNotMatch(resolveVerifyCommand('typescript') || '', /npm run build/);
assert.equal(resolveVerifyCommand('typescript', 'npm run build'), 'npm run build');
assert.equal(resolveVerifyCommand('typescript', 'npm install'), TYPESCRIPT_VERIFY_COMMAND);
assert.equal(resolveVerifyCommand('node'), NODE_VERIFY_COMMAND);
assert.equal(resolveVerifyCommand('node', 'npm install'), NODE_VERIFY_COMMAND);
assert.doesNotMatch(verifyCommandForStack('node') || '', /npm\s+install/i);
assert.equal(resolveVerifyCommand('rust'), 'cargo check');
const planned = planStackVerify('typescript');
assert.equal(planned.runSeparateTypecheck, false);
assert.equal(planned.command, TYPESCRIPT_VERIFY_COMMAND);
assert.equal(
  (planned.command || '').includes('npm run build') && (planned.command || '').includes('tsc'),
  false
);

const missing = beginVerify({ workspacePath: '  ', stack: 'typescript' });
assert.ok('failure' in missing);
if ('failure' in missing) {
  assert.equal(missing.failure.ok, false);
  assert.equal(missing.failure.fingerprint, 'no-workspace');
}
const ready = beginVerify({ workspacePath: 'D:/proj', stack: 'typescript' });
assert.ok('command' in ready);
if ('command' in ready) {
  assert.equal(ready.runSeparateTypecheck, false);
  assert.match(ready.command, /--incremental/);
}

const errors = Array.from({ length: 30 }, (_, i) => ({
  file: `src/f${i}.ts`,
  line: i + 1,
  code: 'TS1000',
  message: `unique-error-${i}`
}));
const listed = formatErrorsForCoder(errors, 'ignored tail that must not be the only feedback');
assert.match(listed, /unique-error-0/);
assert.match(listed, new RegExp(`unique-error-${VERIFY_ERROR_PREVIEW - 1}`));
assert.doesNotMatch(listed, /unique-error-29/);
assert.match(listed, /…and 5 more/);
assert.doesNotMatch(listed, /ignored tail/);

const raw = Array.from({ length: 100 }, (_, i) => `line-${i}`).join('\n');
const head = formatErrorsForCoder([], raw);
assert.match(head, /line-0/);
assert.doesNotMatch(head, /line-99/);
assert.match(head, /…and 75 more/);

console.log('verifyGate.selftest ok');
