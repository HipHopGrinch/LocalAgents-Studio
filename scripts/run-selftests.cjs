/**
 * Run every local selftest and stop on the first failure.
 * Discovers src/lib/*.selftest.ts and scripts/*.selftest.cjs at runtime.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function listMatching(dir, pattern) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(name => pattern.test(name))
    .map(name => path.join(dir, name))
    .sort((a, b) => a.localeCompare(b));
}

const mcpSelftest = path.join(root, 'scripts', 'mcp-selftest.cjs');
const scriptTests = listMatching(path.join(root, 'scripts'), /\.selftest\.cjs$/);
const tsTests = listMatching(path.join(root, 'src', 'lib'), /\.selftest\.ts$/);

const tests = [];
const seen = new Set();
for (const file of [mcpSelftest, ...scriptTests, ...tsTests]) {
  const key = path.normalize(file).toLowerCase();
  if (!fs.existsSync(file) || seen.has(key)) continue;
  seen.add(key);
  tests.push(file);
}

if (tests.length === 0) {
  console.error('No selftests found.');
  process.exit(1);
}

let tsxCli;
try {
  tsxCli = require.resolve('tsx/cli');
} catch {
  console.error('tsx is not installed. Run npm install.');
  process.exit(1);
}

function rel(file) {
  return path.relative(root, file);
}

console.log(`Running ${tests.length} selftest(s)...`);

const passed = [];
for (const file of tests) {
  const isTs = file.endsWith('.ts');
  const args = isTs ? [tsxCli, file] : [file];
  console.log(`\n> ${rel(file)}`);
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env
  });
  if (result.error || result.status !== 0) {
    const code = result.status == null ? 1 : result.status;
    const remaining = tests.slice(passed.length + 1).map(rel);
    console.error('\nSelftest failed.');
    console.error(`  passed: ${passed.length}`);
    for (const name of passed) console.error(`    ok   ${name}`);
    console.error(`  failed: ${rel(file)} (exit ${code})`);
    if (result.error) console.error(`  error:  ${result.error.message}`);
    console.error(`  not run: ${remaining.length}`);
    for (const name of remaining) console.error(`    skip ${name}`);
    process.exit(code || 1);
  }
  passed.push(rel(file));
}

console.log(`\nOK ${passed.length} selftest(s).`);
