/**
 * git:run argument guard and a temp-repo probe that repo config cannot run.
 * Run: node scripts/git-run.selftest.cjs
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { validateGitArgs, buildGitArgv, scrubGitEnv } = require('../electron/gitGuard.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'la-git-guard-'));
const hooksDir = path.join(root, 'empty hooks');
fs.mkdirSync(hooksDir);

function denial(args) {
  return validateGitArgs(args, root);
}

function assertDenied(args) {
  const err = denial(args);
  assert.ok(err, `expected denial for ${JSON.stringify(args)}`);
}

function assertAllowed(args) {
  const err = denial(args);
  assert.equal(err, null, `expected allow for ${JSON.stringify(args)} but got ${err}`);
}

try {
  assertAllowed(['status', '-sb']);
  assertAllowed(['diff', 'HEAD', '--stat']);
  assertAllowed(['diff', 'HEAD']);
  assertAllowed(['diff']);
  assertAllowed(['diff', '--stat']);
  assertAllowed(['diff', '-c']);
  assertAllowed(['diff', '-C']);
  assertAllowed(['diff', '-C5']);
  assertAllowed(['diff', '--no-textconv']);
  assertAllowed(['diff', '--no-ext-diff']);
  assertAllowed(['log', '--oneline', '-n', '5']);
  assertAllowed(['log', 'HEAD..main']);
  assertAllowed(['rev-parse', '--show-toplevel']);
  assertAllowed(['rev-parse', '--is-inside-work-tree']);
  assertAllowed(['branch', '--show-current']);
  assertAllowed(['add', '-A']);
  assertAllowed(['add', '.']);
  assertAllowed(['add', '--', 'src/file.txt']);
  assertAllowed(['commit', '-m', 'see ../notes and C:\\secret']);
  assertAllowed(['commit', '-m', 'ok']);
  assertAllowed(['status', '--output-indicator-new=x']);

  assertDenied(['-c', 'core.fsmonitor=true', 'status']);
  assertDenied(['-C', root, 'status']);
  assertDenied(['--git-dir', root, 'status']);
  assertDenied(['push', 'origin', 'main']);
  assertDenied(['status', '--output', 'C:\\out.patch']);
  assertDenied(['status', '--output=C:\\out.patch']);
  assertDenied(['diff', '-o', 'C:\\out.patch']);
  assertDenied(['diff', '--no-index', 'a', 'b']);
  assertDenied(['status', '--upload-pack=evil']);
  assertDenied(['status', '--receive-pack=evil']);
  assertDenied(['status', '--exec-path=/tmp']);
  assertDenied(['diff', '--ext-diff']);
  assertDenied(['diff', '--textconv']);
  assertDenied(['status', '--git-dir=.git']);
  assertDenied(['status', '--work-tree=/tmp']);
  assertDenied(['status', '--namespace=foo']);
  assertDenied(['status', '--config-env=foo=BAR']);
  assertDenied(['diff', '--', '..']);
  assertDenied(['diff', '--', '../outside']);
  assertDenied(['add', 'C:\\Windows\\notepad.exe']);
  assertDenied(['add', '/etc/passwd']);
  assertDenied(['log', '-L', '1,5:../secret']);

  const built = buildGitArgv(['status', '-sb'], { workspaceRoot: root, hooksDir });
  assert.equal(built.error, undefined);
  const statusAt = built.argv.indexOf('status');
  const locksAt = built.argv.indexOf('--no-optional-locks');
  assert.ok(statusAt > 0 && locksAt > 0 && locksAt < statusAt, 'no-optional-locks must precede status');
  assert.ok(built.argv.includes('core.fsmonitor=false'));
  assert.ok(built.argv.includes('diff.external='));
  assert.ok(built.argv.includes('core.pager=cat'));
  assert.ok(built.argv.includes('core.sshCommand='));
  assert.ok(built.argv.includes('credential.helper='));
  assert.ok(built.argv.some(part => part.startsWith('core.hooksPath=') && part.includes('empty hooks')));
  assert.ok(!built.argv.slice(0, statusAt).includes('-c') || built.argv.filter(part => part === '-c').length > 0);
  assert.deepEqual(built.argv.slice(statusAt), ['status', '-sb']);

  const diffArgv = buildGitArgv(['diff', '-c', 'HEAD'], { workspaceRoot: root, hooksDir });
  assert.equal(diffArgv.error, undefined);
  const diffAt = diffArgv.argv.indexOf('diff');
  assert.ok(diffArgv.argv.slice(diffAt).includes('-c'));
  assert.ok(diffArgv.argv.slice(diffAt).includes('--no-textconv'));
  assert.ok(diffArgv.argv.slice(diffAt).includes('--no-ext-diff'));

  const dirty = {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.fsmonitor',
    GIT_CONFIG_VALUE_0: 'evil',
    GIT_CONFIG_PARAMETERS: "'core.fsmonitor=evil'",
    GIT_SSH_COMMAND: 'evil',
    GIT_SSH: 'evil',
    GIT_ASKPASS: 'evil',
    GIT_EXTERNAL_DIFF: 'evil',
    GIT_PAGER: 'evil',
    GIT_DIR: 'C:\\elsewhere',
    GIT_WORK_TREE: 'C:\\elsewhere',
    GIT_EXEC_PATH: 'C:\\elsewhere',
    KEEP_ME: 'yes'
  };
  const clean = scrubGitEnv(dirty);
  for (const key of Object.keys(dirty)) {
    if (key === 'KEEP_ME') assert.equal(clean.KEEP_ME, 'yes');
    else assert.equal(Object.prototype.hasOwnProperty.call(clean, key), false, key);
  }
  assert.equal(clean.GIT_TERMINAL_PROMPT, '0');

  const git = spawnSync('git', ['--version'], { encoding: 'utf8' });
  if (git.error || git.status !== 0) {
    throw new Error('git is not available for the functional probe');
  }

  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  const marker = path.join(root, 'marker.txt');
  const markerSh = marker.replace(/\\/g, '/');
  const writeSh = (file, word) => {
    fs.writeFileSync(file, `#!/bin/sh\necho ${word} >> '${markerSh}'\nexit 0\n`, 'utf8');
  };
  const fsmon = path.join(root, 'fsmon.sh');
  const extdiff = path.join(root, 'extdiff.sh');
  writeSh(fsmon, 'fsmon');
  writeSh(extdiff, 'diff');
  const run = (args, extraEnv = {}) => {
    const res = spawnSync('git', args, {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, ...extraEnv }
    });
    return res;
  };
  assert.equal(run(['init', '-q']).status, 0, 'git init');
  assert.equal(run(['config', 'user.email', 't@example.com']).status, 0);
  assert.equal(run(['config', 'user.name', 'Guard Test']).status, 0);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
  assert.equal(run(['add', 'a.txt']).status, 0);
  assert.equal(run(['commit', '-m', 'init']).status, 0, 'seed commit');

  run(['config', 'core.fsmonitor', fsmon.replace(/\\/g, '/')]);
  run(['config', 'diff.external', extdiff.replace(/\\/g, '/')]);
  run(['config', 'alias.status', `!echo alias >> '${markerSh}'`]);
  const hookDir = path.join(repo, '.git', 'hooks');
  fs.mkdirSync(hookDir, { recursive: true });
  writeSh(path.join(hookDir, 'pre-commit'), 'hook');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'two\n');

  const guarded = (userArgs, extraEnv = {}) => {
    const builtArgs = buildGitArgv(userArgs, { workspaceRoot: repo, hooksDir });
    assert.equal(builtArgs.error, undefined, builtArgs.error);
    const res = spawnSync('git', builtArgs.argv, {
      cwd: repo,
      encoding: 'utf8',
      env: scrubGitEnv({ ...process.env, ...extraEnv })
    });
    return res;
  };
  const readMarker = () => (fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : '');
  const clearMarker = () => {
    try { fs.unlinkSync(marker); } catch { /* none */ }
  };

  clearMarker();
  const status = guarded(['status', '-sb'], {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.fsmonitor',
    GIT_CONFIG_VALUE_0: fsmon.replace(/\\/g, '/'),
    GIT_EXTERNAL_DIFF: extdiff.replace(/\\/g, '/')
  });
  assert.equal(status.status, 0, `status failed\n${status.stderr}`);
  assert.match(status.stdout, /## /);
  assert.equal(readMarker(), '', `status created a marker:\n${readMarker()}\n${status.stderr}`);

  clearMarker();
  const diff = guarded(['diff']);
  assert.equal(diff.status, 0, `diff failed\n${diff.stderr}`);
  assert.match(diff.stdout, /two/);
  assert.equal(readMarker(), '', `diff created a marker:\n${readMarker()}\n${diff.stderr}`);

  clearMarker();
  const added = guarded(['add', 'a.txt']);
  assert.equal(added.status, 0, `add failed\n${added.stderr}`);
  assert.equal(readMarker(), '', `add created a marker:\n${readMarker()}`);

  clearMarker();
  const committed = guarded(['commit', '-m', 'guarded']);
  assert.equal(committed.status, 0, `commit failed\n${committed.stdout}\n${committed.stderr}`);
  assert.equal(readMarker(), '', `commit created a marker:\n${readMarker()}\n${committed.stderr}`);

  const logged = guarded(['log', '-1', '--oneline']);
  assert.equal(logged.status, 0, logged.stderr);
  assert.match(logged.stdout, /guarded/);

  const parsed = guarded(['rev-parse', '--is-inside-work-tree']);
  assert.equal(parsed.status, 0, parsed.stderr);
  assert.match(parsed.stdout, /true/);

  const branch = guarded(['branch', '--show-current']);
  assert.equal(branch.status, 0, branch.stderr);
  assert.ok(branch.stdout.trim().length > 0);

  console.log('git-run-selftest ok');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
