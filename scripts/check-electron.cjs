/**
 * Syntax-check the privileged Electron scripts. Type-aware checking is opt-in
 * via tsconfig.electron.json (checkJs is off); this is the CI gate.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'electron');
const files = fs
  .readdirSync(dir)
  .filter(name => name.endsWith('.cjs') || name.endsWith('.js'))
  .sort((a, b) => a.localeCompare(b));

if (files.length === 0) {
  console.error('No electron/*.cjs scripts found.');
  process.exit(1);
}

let failed = 0;
for (const name of files) {
  const full = path.join(dir, name);
  const result = spawnSync(process.execPath, ['--check', full], { encoding: 'utf8' });
  if (result.status !== 0) {
    failed += 1;
    console.error(`Syntax error: electron/${name}`);
    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  } else {
    console.log(`ok electron/${name}`);
  }
}

if (failed) {
  console.error(`${failed} electron script(s) failed node --check.`);
  process.exit(1);
}

console.log(`node --check passed for ${files.length} electron script(s).`);
