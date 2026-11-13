/**
 * Run: node node_modules/tsx/dist/cli.mjs src/lib/npmDeps.selftest.ts
 * Asserts the TypeScript and CommonJS twins behave identically.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { sanitizeDepMap, sanitizePackageJsonContent } from './npmDeps';

const require = createRequire(import.meta.url);
const cjs = require('../../electron/npmDeps.cjs') as {
  sanitizeDepMap: typeof sanitizeDepMap;
  sanitizePackageJsonContent: typeof sanitizePackageJsonContent;
};

const impls = { ts: { sanitizeDepMap }, cjs: { sanitizeDepMap: cjs.sanitizeDepMap } };

for (const [label, impl] of Object.entries(impls)) {
  // B-85: an existing scoped entry is never overwritten by its alias
  assert.deepEqual(
    impl.sanitizeDepMap({ '@react-three/fiber': '^9.2.0', 'react-three-fiber': '*' }).deps,
    { '@react-three/fiber': '^9.2.0' },
    `${label}: scoped ^9 kept over alias *`
  );
  assert.deepEqual(
    impl.sanitizeDepMap({ '@react-three/fiber': '^8.17.10', 'react-three-fiber': '0.1.0' }).deps,
    { '@react-three/fiber': '^8.17.10' },
    `${label}: scoped ^8.17.10 kept over alias 0.1.0`
  );
  // Alias listed first: the explicit scoped entry still wins
  assert.deepEqual(
    impl.sanitizeDepMap({ 'react-three-fiber': '0.1.0', '@react-three/fiber': '^8.17.10' }).deps,
    { '@react-three/fiber': '^8.17.10' },
    `${label}: scoped after alias wins`
  );
  // Alias alone still defaults and rewrites
  assert.deepEqual(
    impl.sanitizeDepMap({ 'react-three-fiber': '*' }).deps,
    { '@react-three/fiber': '^8.15.0' },
    `${label}: lone alias gets default version`
  );
  assert.deepEqual(
    impl.sanitizeDepMap({ 'react-three-fiber': '^8.0.0' }).deps,
    { '@react-three/fiber': '^8.0.0' },
    `${label}: lone alias keeps explicit range`
  );
  const dup = impl.sanitizeDepMap({ '@react-three/fiber': '^9.2.0', 'react-three-fiber': '*' });
  assert.equal(dup.changed.length, 1, `${label}: dropped alias is reported`);
}

// Twins agree on a mixed set
const mixed = {
  'react-three-fiber': '*',
  'react-three-drei': '^9.0.0',
  '@react-three/drei': '^10.0.0',
  react: '^19.0.0'
};
assert.deepEqual(sanitizeDepMap(mixed), cjs.sanitizeDepMap(mixed));

const pkg = JSON.stringify({ dependencies: { '@react-three/fiber': '^9.2.0', 'react-three-fiber': '*' } });
assert.equal(
  JSON.parse(sanitizePackageJsonContent(pkg).content).dependencies['@react-three/fiber'],
  '^9.2.0'
);
assert.equal(
  JSON.parse(cjs.sanitizePackageJsonContent(pkg).content).dependencies['@react-three/fiber'],
  '^9.2.0'
);

console.log('npmDeps selftest ok');
