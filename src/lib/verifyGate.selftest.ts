/**
 * Run: npx --yes tsx src/lib/verifyGate.selftest.ts
 */
import assert from 'node:assert/strict';
import { NODE_VERIFY_COMMAND, TYPESCRIPT_VERIFY_COMMAND, verifyCommandForStack } from './deliveryIntent';
import {
  annotateMissingDependencies,
  beginVerify,
  errorFingerprint,
  filesFromErrors,
  formatErrorsForCoder,
  parseCompilerErrors,
  isNpmInstallCommand,
  isNpxTscCommand,
  localTscPowerShellCommand,
  planStackVerify,
  resolveVerifyCommand,
  typesCannotResolve,
  typescriptVerifyUsesCompiler,
  VERIFY_ERROR_PREVIEW,
  commandOutputFailed,
  verifyOutputFailed
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

// B-45: timeouts and non-zero / null / negative exit codes fail the gate
assert.equal(verifyOutputFailed('Exit code: null (timed out and was killed)'), true);
assert.equal(verifyOutputFailed('Exit code: -1\nspawn powershell.exe ENOENT'), true);
assert.equal(verifyOutputFailed('Exit code: 2\nboom'), true);
assert.equal(verifyOutputFailed('Exit code: 0'), false);
assert.equal(commandOutputFailed('Exit code: 0\nall good'), false);
assert.equal(commandOutputFailed('Exit code: -1'), true);
assert.equal(commandOutputFailed('command timed out'), true);

// A Reviewer Nay sentence before the path must not become the "file"
const nay =
  'Type mismatch between App.tsx and Board3D.tsx: Board3D props expects `onCellClick: (col: number, layer: number) => void`, but App.tsx passed a different shape, causing compilation errors: src/App.tsx(56,30): error TS2322: Type X is not assignable to type Y.';
const nayErrors = parseCompilerErrors(nay);
assert.equal(nayErrors.length, 1);
assert.equal(nayErrors[0].file, 'src/App.tsx');
assert.equal(nayErrors[0].line, 56);
assert.equal(nayErrors[0].code, 'TS2322');
assert.deepEqual(filesFromErrors(nayErrors), ['src/App.tsx']);
assert.equal(parseCompilerErrors('see `src/App.tsx(3,4): error TS2304: Cannot find name x.')[0].file, 'src/App.tsx');

const winSpaces = parseCompilerErrors("D:\\cursor\\LocalAgents Studio\\src\\x.ts(1,2): error TS2304: Cannot find name 'y'.");
assert.equal(winSpaces[0].file, 'D:/cursor/LocalAgents Studio/src/x.ts');
assert.equal(parseCompilerErrors("C:/Program Files/foo/bar.ts(7,1): error TS1005: ';' expected.")[0].file, 'C:/Program Files/foo/bar.ts');
assert.equal(parseCompilerErrors('/home/me/my proj/a.ts(7,1): error TS1005: x.')[0].file, '/home/me/my proj/a.ts');

const plain = parseCompilerErrors("src\\game\\logic.ts(10,5): error TS2339: Property 'a' does not exist.");
assert.equal(plain[0].file, 'src/game/logic.ts');
assert.equal(parseCompilerErrors('src/a.ts(1,1): error TS2304: x')[0].file, 'src/a.ts');

// Prose prefix with spaces and no separator falls back to the trailing path token
assert.equal(parseCompilerErrors('The build failed in src/b.ts(2,3): error TS2304: x')[0].file, 'src/b.ts');
// Generic path:line: form gets the same cleanup
assert.equal(parseCompilerErrors('Check the results in src/c.py:12: cannot import name x')[0].file, 'src/c.py');
// Nothing path-like left: no entry, and filesFromErrors skips sentence "files"
assert.equal(parseCompilerErrors('Something went wrong badly (1,2): error TS2304: x').length, 0);
assert.deepEqual(
  filesFromErrors([
    { file: 'Type mismatch between App and Board', line: 1, message: 'x' },
    { file: 'src/ok.ts', line: 1, message: 'x' }
  ]),
  ['src/ok.ts']
);

console.log('verifyGate.selftest ok');
