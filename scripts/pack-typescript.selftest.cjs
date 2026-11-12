/**
 * Packaged tsc must run from lib/tsc.js + lib/_tsc.js + lib.*.d.ts, without typescript.js.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const files = pkg.build.files;
assert.ok(
  files.includes('!node_modules/typescript/lib/typescript.js'),
  'typescript.js must be excluded from the installer'
);
assert.equal(pkg.build.onNodeModuleFile, './scripts/pack-node-module-file.cjs');

const keepLibDts = require(path.join(root, 'scripts', 'pack-node-module-file.cjs'));
const libDir = path.join(root, 'node_modules', 'typescript', 'lib');
assert.equal(keepLibDts(path.join(libDir, 'lib.dom.d.ts')), true);
assert.equal(keepLibDts(path.join(libDir, 'typescript.d.ts')), undefined);
assert.equal(keepLibDts(path.join(libDir, 'typescript.js')), undefined);
assert.equal(keepLibDts(path.join(libDir, '_tsc.js')), undefined);

const shim = fs.readFileSync(path.join(libDir, 'tsc.js'), 'utf8');
assert.match(shim, /require\("\.\/_tsc\.js"\)/);
assert.doesNotMatch(shim, /typescript\.js/);

const { getNodeModuleFileMatcher } = require('app-builder-lib/out/fileMatcher');
const matcher = getNodeModuleFileMatcher(root, path.join(root, 'release-match-test'), s => s, {}, {
  config: pkg.build,
  debugLogger: { isEnabled: false }
});
const filter = matcher.createFilter();

function kept(rel) {
  const full = path.join(root, rel);
  return filter(full, fs.statSync(full));
}

assert.equal(kept('node_modules/typescript/lib/tsc.js'), true);
assert.equal(kept('node_modules/typescript/lib/_tsc.js'), true);
assert.equal(kept('node_modules/typescript/lib'), true, 'lib directory must match so .d.ts bypass the default exclusion');
assert.equal(kept('node_modules/typescript/lib/lib.es5.d.ts'), true);
assert.equal(kept('node_modules/typescript/lib/lib.dom.d.ts'), true);
assert.equal(kept('node_modules/typescript/package.json'), true);
assert.equal(kept('node_modules/typescript/bin/tsc'), true);
assert.equal(kept('node_modules/typescript/lib/typescript.js'), false);
assert.equal(kept('node_modules/typescript/lib/_tsserver.js'), false);
assert.equal(kept('node_modules/typescript/bin/tsserver'), false);
assert.equal(
  kept('node_modules/typescript/lib/de/diagnosticMessages.generated.json'),
  false
);

const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'las-tsc-'));
function copyRel(rel) {
  const from = path.join(root, 'node_modules', 'typescript', rel);
  const to = path.join(dest, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}
copyRel('package.json');
copyRel('bin/tsc');
copyRel('lib/tsc.js');
copyRel('lib/_tsc.js');
for (const name of fs.readdirSync(libDir)) {
  if (name.startsWith('lib.') && name.endsWith('.d.ts')) copyRel(path.join('lib', name));
}
const sample = path.join(dest, 'sample.ts');
fs.writeFileSync(sample, 'const el: HTMLElement | null = null;\nexport const n: number = el ? 1 : 0;\n');
const compiled = spawnSync(process.execPath, [path.join(dest, 'bin', 'tsc'), '--strict', '--lib', 'es2022,dom', '--noEmit', sample], {
  encoding: 'utf8'
});
assert.equal(compiled.status, 0, `${compiled.stdout}\n${compiled.stderr}`);

console.log('pack-typescript selftest ok');
