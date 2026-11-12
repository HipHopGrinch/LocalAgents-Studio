/**
 * Run: npx --yes tsx src/lib/repoMap.selftest.ts
 */
import assert from 'node:assert/strict';
import {
  extractSymbols,
  formatRepoMap,
  invalidateRepoMap,
  isSkippedRepoDir,
  pathHasSkippedRepoDir,
  relevantFilesForTask,
  repoMapNeedsRebuild,
  symbolHitsForQuery,
  type RepoMap
} from './repoMap';

for (const name of ['node_modules', 'dist', 'build', 'out', 'coverage', '.git', '.localagents', 'release', 'release-104']) {
  assert.equal(isSkippedRepoDir(name), true, name);
}
assert.equal(isSkippedRepoDir('src'), false);
assert.equal(isSkippedRepoDir('App.tsx'), false);
assert.equal(pathHasSkippedRepoDir('node_modules/leftpad/index.js'), true);
assert.equal(pathHasSkippedRepoDir('dist/app.js'), true);
assert.equal(pathHasSkippedRepoDir('release-12/win-unpacked/app.js'), true);
assert.equal(pathHasSkippedRepoDir('src/lib/repoMap.ts'), false);
assert.equal(pathHasSkippedRepoDir('.gitignore'), false);

const symbols = extractSymbols(
  'src/keep/TaskTarget.ts',
  'export function TaskTarget() {}\nfunction helper() {}\n'
);
assert.ok(symbols.some(s => s.name === 'TaskTarget'));

const junk = Array.from({ length: 40 }, (_, i) => `junk/f${i}.ts`);
const map: RepoMap = {
  files: ['node_modules/leftpad/index.js', 'dist/bundle.js', ...junk, 'src/keep/TaskTarget.ts', 'package.json'],
  symbols: [{ file: 'src/keep/TaskTarget.ts', name: 'TaskTarget' }],
  builtAt: 50
};
const ranked = relevantFilesForTask(map, 'update TaskTarget and leave the rest', 8);
assert.equal(ranked[0], 'src/keep/TaskTarget.ts');
assert.ok(ranked.length <= 8);
assert.ok(!ranked.some(f => f.includes('node_modules') || f.includes('junk/')));

const tight = formatRepoMap(map, 'tight', 'update TaskTarget');
assert.match(tight, /src\/keep\/TaskTarget\.ts/);
assert.match(tight, /TaskTarget/);
assert.doesNotMatch(tight, /leftpad/);
assert.doesNotMatch(tight, /junk\/f0/);
assert.doesNotMatch(tight, /package\.json/);

const named: RepoMap = {
  files: ['src/App.tsx', 'src/game/Board.tsx', 'package.json'],
  symbols: [
    { file: 'src/App.tsx', name: 'App' },
    { file: 'src/game/Board.tsx', name: 'Board' }
  ],
  builtAt: 1
};
const namedTight = formatRepoMap(named, 'tight', 'wire App.tsx to the board');
assert.match(namedTight, /src\/App\.tsx/);
assert.match(namedTight, /App/);
assert.doesNotMatch(namedTight, /package\.json/);
const wide = formatRepoMap(named, 'wide', '');
assert.match(wide, /package\.json/);
assert.match(wide, /Board/);
assert.match(symbolHitsForQuery(named, 'Board'), /src\/game\/Board\.tsx/);

const stale = invalidateRepoMap(named);
assert.equal(stale?.builtAt, 0);
assert.equal(repoMapNeedsRebuild(stale), true);
assert.equal(repoMapNeedsRebuild(null), true);
assert.equal(repoMapNeedsRebuild(named), false);
assert.equal(invalidateRepoMap(null), null);

console.log('repoMap.selftest ok');
