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

  assert.ok(built.argv.includes('commit.gpgsign=false'));
  assert.ok(built.argv.includes('tag.gpgsign=false'));
  assert.ok(built.argv.includes('gpg.program='));

  const filterRoot = path.join(root, 'filter-ws');
  fs.mkdirSync(path.join(filterRoot, '.git', 'info'), { recursive: true });
  fs.writeFileSync(path.join(filterRoot, '.git', 'config'), '[filter "lfsx"]\n\tclean = evil-clean\n[filter "other y"]\n\tsmudge = evil\n');
  fs.writeFileSync(path.join(filterRoot, '.gitattributes'), '# filter=ignored\n*.txt filter=attrfilter\n');
  fs.writeFileSync(path.join(filterRoot, '.git', 'info', 'attributes'), '*.bin filter=infofilter -text\n');
  const filtered = buildGitArgv(['add', '-A'], { workspaceRoot: filterRoot, hooksDir });
  assert.equal(filtered.error, undefined);
  for (const name of ['lfsx', 'other y', 'attrfilter', 'infofilter']) {
    for (const key of ['clean', 'smudge', 'process']) {
      assert.ok(filtered.argv.includes(`filter.${name}.${key}=`), `${name}.${key}`);
    }
    assert.ok(filtered.argv.includes(`filter.${name}.required=false`), `${name}.required`);
  }
  assert.ok(!filtered.argv.includes('filter.ignored.clean='));

  // F-10: filters defined in an include.path / includeIf file must be neutralized too.
  const incRoot = path.join(root, 'include-ws');
  fs.mkdirSync(path.join(incRoot, '.git'), { recursive: true });
  fs.mkdirSync(path.join(incRoot, '.git', 'sub'), { recursive: true });
  fs.writeFileSync(
    path.join(incRoot, '.git', 'config'),
    '[core]\n\tbare = false\n[include]\n\tpath = extra.config\n[includeIf "gitdir:/nowhere/"]\n\tpath = "sub/cond.config" ; trailing comment\n'
  );
  fs.writeFileSync(path.join(incRoot, '.git', 'extra.config'), '[filter "evil"]\n\tclean = evil-clean\n[include]\n\tpath = sub/nested.config\n');
  fs.writeFileSync(path.join(incRoot, '.git', 'sub', 'cond.config'), '[filter "condevil"]\n\tsmudge = evil\n');
  fs.writeFileSync(path.join(incRoot, '.git', 'sub', 'nested.config'), '[filter "nestedevil"]\n\tprocess = evil\n[include]\n\tpath = ../extra.config\n');
  const incNames = require('../electron/gitGuard.cjs').discoverFilterNames(incRoot).sort();
  assert.deepEqual(incNames, ['condevil', 'evil', 'nestedevil'], 'include files are followed (and cycles stop)');
  const incBuilt = buildGitArgv(['add', '-A'], { workspaceRoot: incRoot, hooksDir });
  assert.equal(incBuilt.error, undefined);
  for (const name of incNames) {
    for (const key of ['clean', 'smudge', 'process']) {
      assert.ok(incBuilt.argv.includes(`filter.${name}.${key}=`), `included ${name}.${key}`);
    }
  }

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
  const gpgStub = path.join(root, 'gpg-stub.sh');
  const cleanStub = path.join(root, 'clean-stub.sh');
  writeSh(gpgStub, 'gpg');
  fs.writeFileSync(cleanStub, `#!/bin/sh\necho clean >> '${markerSh}'\ncat\n`, 'utf8');
  run(['config', 'commit.gpgsign', 'true']);
  run(['config', 'gpg.program', gpgStub.replace(/\\/g, '/')]);
  run(['config', 'filter.probe.clean', cleanStub.replace(/\\/g, '/')]);
  fs.writeFileSync(path.join(repo, '.gitattributes'), '*.txt filter=probe\n');
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

  // F-10 real run: the filter is only reachable through an include file and an attributes
  // file named in config (neither is scanned by name), so discovery alone must catch it.
  const incRepo = path.join(root, 'include-repo');
  fs.mkdirSync(incRepo);
  const incGit = (args, cwd = incRepo) => spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env } });
  assert.equal(incGit(['init', '-q']).status, 0, 'git init (include repo)');
  const incMarker = path.join(root, 'include-marker.txt');
  const incMarkerSh = incMarker.replace(/\\/g, '/');
  const incClean = path.join(root, 'include-clean.sh');
  fs.writeFileSync(incClean, `#!/bin/sh\necho includeclean >> '${incMarkerSh}'\ncat\n`, 'utf8');
  const incAttrs = path.join(root, 'include-attrs');
  fs.writeFileSync(incAttrs, '*.txt filter=evil\n');
  fs.writeFileSync(
    path.join(incRepo, '.git', 'extra.config'),
    `[filter "evil"]\n\tclean = ${incClean.replace(/\\/g, '/')}\n[core]\n\tattributesFile = ${incAttrs.replace(/\\/g, '/')}\n`
  );
  fs.appendFileSync(path.join(incRepo, '.git', 'config'), '[include]\n\tpath = extra.config\n');
  fs.writeFileSync(path.join(incRepo, 'x.txt'), 'data\n');
  // Control: unguarded git runs the included filter, so the probe is meaningful.
  try { fs.unlinkSync(incMarker); } catch { /* none */ }
  assert.equal(incGit(['add', 'x.txt']).status, 0, 'unguarded add');
  assert.ok(fs.existsSync(incMarker), 'control: included clean filter runs without the guard');
  assert.equal(incGit(['reset', '-q']).status, 0);
  try { fs.unlinkSync(incMarker); } catch { /* none */ }
  const incArgv = buildGitArgv(['add', 'x.txt'], { workspaceRoot: incRepo, hooksDir });
  assert.equal(incArgv.error, undefined, incArgv.error);
  const incRes = spawnSync('git', incArgv.argv, { cwd: incRepo, encoding: 'utf8', env: scrubGitEnv({ ...process.env }) });
  assert.equal(incRes.status, 0, `guarded add failed\n${incRes.stderr}`);
  assert.equal(fs.existsSync(incMarker), false, 'included clean filter ran through the guard');

  console.log('git-run-selftest ok');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
