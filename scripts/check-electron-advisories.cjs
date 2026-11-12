/**
 * CI advisory check for the electron package.
 * npm audit --omit=dev skips electron because it is a devDependency.
 * Exits 1 when electron has a high or critical advisory. The workflow
 * marks this step continue-on-error so a new advisory is visible without
 * failing the rest of CI.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function electronVersion() {
  try {
    return require('electron/package.json').version;
  } catch {
    return 'unknown';
  }
}

function runAudit() {
  // Node 24 rejects spawning npm.cmd without a shell (EINVAL). Prefer npm's JS entry.
  const cli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const useCli = fs.existsSync(cli);
  const result = spawnSync(useCli ? process.execPath : 'npm', useCli ? [cli, 'audit', '--json'] : ['audit', '--json'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
    shell: !useCli
  });
  if (result.stdout) return result.stdout;
  if (result.error) throw result.error;
  throw new Error(result.stderr || `npm audit exited ${result.status}`);
}

function main() {
  console.log(`electron ${electronVersion()}`);
  let raw;
  try {
    raw = runAudit();
  } catch (err) {
    console.error(`electron advisory check failed to run npm audit: ${err.message}`);
    process.exit(1);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    console.error('electron advisory check: npm audit did not return JSON');
    process.exit(1);
  }
  const vuln = data.vulnerabilities && data.vulnerabilities.electron;
  if (!vuln) {
    console.log('No npm audit advisories for electron.');
    return;
  }
  const via = (Array.isArray(vuln.via) ? vuln.via : [])
    .map(entry =>
      typeof entry === 'string'
        ? entry
        : `${entry.severity || ''} ${entry.title || entry.name || ''} ${entry.url || ''}`.trim()
    )
    .filter(Boolean);
  console.log(`electron advisory severity=${vuln.severity}`);
  for (const line of via) console.log(`  ${line}`);
  if (vuln.severity === 'high' || vuln.severity === 'critical') process.exit(1);
}

main();
