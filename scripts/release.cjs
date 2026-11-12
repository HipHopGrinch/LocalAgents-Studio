/**
 * Local unsigned release.
 *   npm run release -- [patch|minor|major|x.y.z] [--publish]
 *
 * Reads git status only. Does not commit, push, or print GH_TOKEN.
 * Publish runs scripts/publish-github-release.ps1 only when --publish is set
 * and GH_TOKEN is present.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const knownFlags = new Set(['--publish', '--help', '-h']);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function usage() {
  console.log(`Usage: npm run release -- [patch|minor|major|x.y.z] [--publish]

Checks a clean git tree, optionally bumps package.json and package-lock.json
together, runs typecheck and tests, then builds unsigned installers into
release-<version>\\ (CSC_IDENTITY_AUTO_DISCOVERY=false).

--publish   upload via scripts/publish-github-release.ps1
            Requires GH_TOKEN. The token is never printed.
            The publish script refuses to replace an existing tag unless -Force.
`);
}

if (args.includes('--help') || args.includes('-h')) {
  usage();
  process.exit(0);
}

const unknown = args.filter(arg => arg.startsWith('-') && !knownFlags.has(arg));
if (unknown.length) fail(`Unknown arguments: ${unknown.join(' ')}`);

const positionals = args.filter(arg => !arg.startsWith('-'));
if (positionals.length > 1) fail('Pass one version or bump type (patch, minor, major, or x.y.z).');

const publish = args.includes('--publish');
const versionArg = positionals[0];

function runNode(script, scriptArgs, extraEnv) {
  const result = spawnSync(process.execPath, [script, ...scriptArgs], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv }
  });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) process.exit(result.status || 1);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function parseSemver(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function bumpVersion(current, kind) {
  const parts = parseSemver(current);
  if (!parts) fail(`package.json version is not x.y.z: ${current}`);
  if (kind === 'major') return `${parts[0] + 1}.0.0`;
  if (kind === 'minor') return `${parts[0]}.${parts[1] + 1}.0`;
  if (kind === 'patch') return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
  return null;
}

const status = spawnSync('git', ['status', '--porcelain'], {
  cwd: root,
  encoding: 'utf8'
});
if (status.error) fail(status.error.message);
if (status.status !== 0) fail('git status --porcelain failed.');
if ((status.stdout || '').trim()) {
  console.error('Refusing to release: git working tree is not clean.');
  process.stderr.write(status.stdout);
  process.exit(1);
}

const pkgPath = path.join(root, 'package.json');
const lockPath = path.join(root, 'package-lock.json');
const pkg = readJson(pkgPath);
const current = String(pkg.version || '');
if (!parseSemver(current)) fail(`package.json version is not x.y.z: ${current}`);

let next = current;
if (versionArg) {
  const bumped = bumpVersion(current, versionArg);
  if (bumped) next = bumped;
  else if (parseSemver(versionArg)) next = versionArg;
  else fail('Version must be patch, minor, major, or x.y.z.');
}

if (next !== current) {
  pkg.version = next;
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  const lockText = fs.readFileSync(lockPath, 'utf8');
  const needle = `"version": "${current}"`;
  let replacements = 0;
  const updated = lockText.replaceAll(needle, () => {
    replacements += 1;
    return replacements <= 2 ? `"version": "${next}"` : needle;
  });
  if (replacements < 2) {
    fail('package-lock.json is missing the root version fields (top-level and packages[""]).');
  }
  fs.writeFileSync(lockPath, updated);
  console.log(`Version ${current} -> ${next}`);
} else {
  console.log(`Releasing ${current} without a version bump.`);
}

const tscBin = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const builderBin = path.join(root, 'node_modules', 'electron-builder', 'cli.js');
for (const bin of [tscBin, viteBin, builderBin]) {
  if (!fs.existsSync(bin)) fail(`Missing ${path.relative(root, bin)}. Run npm install.`);
}

runNode(tscBin, ['--noEmit']);
runNode(path.join(root, 'scripts', 'run-selftests.cjs'), []);

const outDir = `release-${next}`;
const buildEnv = { CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
console.log(`Building unsigned installers into ${outDir}\\`);
runNode(viteBin, ['build'], buildEnv);
runNode(builderBin, ['--win', `--config.directories.output=${outDir}`], buildEnv);

if (!publish) {
  console.log(`Build complete: ${outDir}\\`);
  console.log('Pass --publish with GH_TOKEN set to upload. The token is never printed.');
  process.exit(0);
}

if (!process.env.GH_TOKEN) {
  fail('Refusing to publish: --publish was set but GH_TOKEN is not set.');
}

const publishScript = path.join(root, 'scripts', 'publish-github-release.ps1');
const published = spawnSync(
  'powershell.exe',
  ['-NoProfile', '-NonInteractive', '-File', publishScript, '-OutputDir', outDir],
  { cwd: root, stdio: 'inherit', env: process.env }
);
if (published.error) fail(published.error.message);
if (published.status !== 0) process.exit(published.status || 1);
