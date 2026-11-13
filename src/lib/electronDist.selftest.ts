/**
 * Run: npx --yes tsx src/lib/electronDist.selftest.ts
 */
import assert from 'node:assert/strict';
import {
  decideElectronDist,
  distCommandFailed,
  electronOutputDirs,
  endElectronDist,
  exePathsFromDistOutput,
  shouldRunElectronDist,
  summarizeElectronDist,
  terminalLooksLikeRunningDist,
  tryBeginElectronDist
} from './electronDist';

const studioDist = {
  dist: 'npm run build && cross-env CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder --win'
};

assert.equal(shouldRunElectronDist('electron', studioDist), true);
assert.equal(shouldRunElectronDist('web', studioDist), true);
assert.equal(shouldRunElectronDist('web', { dist: 'vite build' }), false);
assert.equal(shouldRunElectronDist('python', { dist: 'python -m build' }), false);
assert.equal(shouldRunElectronDist('rust', null), false);
assert.equal(shouldRunElectronDist('go', {}), false);
assert.equal(shouldRunElectronDist('node', { dist: 'tsc -p .' }), false);
assert.equal(shouldRunElectronDist('native', { build: 'cargo build' }), false);
assert.equal(shouldRunElectronDist('electron', { start: 'electron .' }), false);
assert.equal(shouldRunElectronDist('electron', { dist: 'vite build' }), true);
assert.equal(
  shouldRunElectronDist('web', { 'build:desktop': 'electron-builder --win' }),
  true
);

const decision = decideElectronDist('electron', studioDist);
assert.equal(decision.run, true);
if (decision.run) {
  assert.equal(decision.scriptName, 'dist');
  assert.equal(
    decision.command,
    `$env:CSC_IDENTITY_AUTO_DISCOVERY='false'; npm run "dist"`
  );
}

const named = decideElectronDist('electron', { 'dist:win': 'electron-builder --win' });
assert.equal(named.run, true);
if (named.run) {
  assert.equal(named.scriptName, 'dist:win');
  assert.equal(named.command, `$env:CSC_IDENTITY_AUTO_DISCOVERY='false'; npm run "dist:win"`);
}

const preferDist = decideElectronDist('web', {
  build: 'electron-builder --win',
  dist: 'electron-builder --win'
});
assert.equal(preferDist.run, true);
if (preferDist.run) assert.equal(preferDist.scriptName, 'dist');

const packOnly = decideElectronDist('python', { pack: 'electron-builder --win' });
assert.equal(packOnly.run, true);
if (packOnly.run) assert.equal(packOnly.scriptName, 'pack');

assert.equal(decideElectronDist('electron', { 'dist;calc': 'electron-builder' }).run, false);

assert.deepEqual(electronOutputDirs({ build: { directories: { output: 'release' } } }), [
  'release',
  'dist'
]);
assert.deepEqual(electronOutputDirs({ build: { directories: { output: '../release' } } }), [
  'release',
  'dist'
]);
assert.deepEqual(
  electronOutputDirs({ build: { directories: { output: 'node_modules/out' } } }),
  ['release', 'dist']
);

const sample = [
  '• building        target=nsis file=release\\LocalAgents Studio Setup 1.2.20.exe',
  '• building block map  blockMapFile=release\\LocalAgents Studio Setup 1.2.20.exe.blockmap',
  'file=node_modules\\electron\\dist\\electron.exe',
  'file=release\\win-unpacked\\App.exe'
].join('\n');
assert.deepEqual(exePathsFromDistOutput(sample), [
  'release/LocalAgents Studio Setup 1.2.20.exe'
]);

assert.equal(distCommandFailed('Exit code: 0\nbuilt'), false);
assert.equal(distCommandFailed('Exit code: 1\nnpm ERR!'), true);
assert.equal(distCommandFailed('Exit code: null (timed out and was killed)'), true);
assert.equal(distCommandFailed(''), true);

const failed = summarizeElectronDist({
  ok: false,
  scriptName: 'dist',
  output: 'Exit code: 1\nfile=release\\App.exe\nnpm ERR! failed',
  listedExes: ['release/App.exe']
});
assert.match(failed, /no installer was produced/);
assert.doesNotMatch(failed, /installer ready/i);

const missing = summarizeElectronDist({
  ok: true,
  scriptName: 'dist',
  output: 'Exit code: 0\nbuilt ok',
  listedExes: []
});
assert.match(missing, /no \.exe/i);
assert.doesNotMatch(missing, /ready/i);

const listed = summarizeElectronDist({
  ok: true,
  scriptName: 'dist',
  output: 'Exit code: 0\n',
  listedExes: ['release/App.exe']
});
assert.match(listed, /release\/App.exe/);

const runningLine = `> $env:CSC_IDENTITY_AUTO_DISCOVERY='false'; npm run "dist"`;
assert.equal(terminalLooksLikeRunningDist(`${runningLine}\nstill going`, true), true);
assert.equal(terminalLooksLikeRunningDist(runningLine, false), false);
assert.equal(terminalLooksLikeRunningDist('> npm test', true), false);
assert.equal(
  terminalLooksLikeRunningDist('> npm run "package"\n> node scripts/make-installer.js\nbuilding', true),
  true
);
assert.equal(terminalLooksLikeRunningDist('> npm run dist:win\nbuilding', true), true);
assert.equal(terminalLooksLikeRunningDist('> npm run package\nbuilding', false), false);
assert.equal(terminalLooksLikeRunningDist('> npm run packager-docs\nbuilding', true), false);
assert.equal(
  terminalLooksLikeRunningDist('> npm run dist\ndone\n> npm run dev\n> app@1.0.0 dev\n> vite\nready', true),
  false
);
assert.equal(
  terminalLooksLikeRunningDist("> $env:CSC_IDENTITY_AUTO_DISCOVERY='false'; npm run dist\n> app@1.0.0 dist\n> electron-builder", true),
  true
);

assert.equal(tryBeginElectronDist('C:\\Work\\App'), true);
assert.equal(tryBeginElectronDist('C:/work/app'), false);
endElectronDist('c:/work/app');
assert.equal(tryBeginElectronDist('C:\\Work\\App'), true);
endElectronDist('C:\\Work\\App');

console.log('electronDist.selftest ok');
