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
  pickExistingProjectExports,
  rankExistingProjectFiles,
  relevantFilesForTask,
  repoMapNeedsRebuild,
  scanTopLevelDeclarations,
  summarizeModuleExports,
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

const appMap: RepoMap = {
  files: ['src/App.tsx', 'src/styles.css', 'src/button.tsx'],
  symbols: [{ file: 'src/App.tsx', name: 'App' }],
  builtAt: 60
};
assert.deepEqual(relevantFilesForTask(appMap, 'apply the padding change', 8), []);
assert.deepEqual(relevantFilesForTask(appMap, 'the application looks happy', 8), []);
assert.equal(relevantFilesForTask(appMap, 'fix the App layout', 8)[0], 'src/App.tsx');
assert.equal(relevantFilesForTask(appMap, 'edit src/App.tsx please', 8)[0], 'src/App.tsx');

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

// Module export summaries: props interfaces + signatures, never bodies
const board3d = `import { Piece3D } from './Piece3D';
import type { Board } from '../game/gameLogic';

interface Board3DProps {
  board: Board;
  onColumnClick: (col: number) => void;
}

const SECRET_LOCAL = 42;

export function Board3D({ board, onColumnClick }: Board3DProps) {
  const BODY_MARKER = SECRET_LOCAL;
  return <group>{BODY_MARKER}</group>;
}

export const COLUMNS = 7;
export const makeBoard = (rows: number, cols: number): Board => {
  return BODY_ONLY;
};
export type Player = 'red' | 'yellow';
export default Board3D;
`;
const board3dSummary = summarizeModuleExports('src/components/Board3D.tsx', board3d, 2000);
assert.match(board3dSummary, /interface Board3DProps \{/);
assert.match(board3dSummary, /onColumnClick: \(col: number\) => void;/);
assert.match(board3dSummary, /export function Board3D\(\{ board, onColumnClick \}: Board3DProps\) \{ … \}/);
assert.match(board3dSummary, /export const COLUMNS = 7/);
assert.match(board3dSummary, /export const makeBoard = \(rows: number, cols: number\): Board => …/);
assert.match(board3dSummary, /export type Player = 'red' \| 'yellow';/);
assert.match(board3dSummary, /export default Board3D;/);
assert.doesNotMatch(board3dSummary, /BODY_MARKER|BODY_ONLY|SECRET_LOCAL/);
assert.equal(summarizeModuleExports('src/main.tsx', 'import x from "x";\nrender(x);\n'), '');
assert.equal(summarizeModuleExports('src/styles.css', 'export {}'), '');
assert.ok(summarizeModuleExports('src/components/Board3D.tsx', board3d, 120).length <= 125);
const multiLine = scanTopLevelDeclarations(
  'export function Piece3D({\n  position,\n  player\n}: Piece3DProps) {\n  return null;\n}\n'
);
assert.equal(multiLine[0].name, 'Piece3D');
assert.match(multiLine[0].text, /player\n\}: Piece3DProps\) \{ … \}$/);

// Which earlier-step files a task should integrate
const projectFiles = [
  { path: 'src/game/gameLogic.ts', content: 'export type Cell = 0 | 1 | 2;\nexport function dropPiece(board: Cell[][], col: number): Cell[][] {\n  return board;\n}\n' },
  { path: 'src/game/aiWorker.ts', content: 'export function bestMove(board: number[][]): number {\n  return 3;\n}\n' },
  {
    path: 'src/components/Board3D.tsx',
    content: 'interface Board3DProps { board: number[][]; onColumnClick: (c: number) => void }\nexport function Board3D(props: Board3DProps) {\n  return null;\n}\n'
  },
  { path: 'src/components/HUD.tsx', content: 'export function HUD(props: { turn: number }) {\n  return null;\n}\n' },
  { path: 'src/utils/format.ts', content: 'export const fmt = (n: number) => String(n);\n' },
  { path: 'src/main.tsx', content: 'import "./App";\n' },
  { path: 'src/App.test.tsx', content: 'export const t = 1;\n' },
  { path: 'package.json', content: '{}' }
];
const appPick = pickExistingProjectExports({
  taskPath: 'src/App.tsx',
  brief: 'Create src/App.tsx that renders the 3D Connect 4 game with an AI opponent.',
  files: projectFiles,
  excludePaths: ['src/components/HUD.tsx'],
  maxChars: 4000
});
const appPaths = appPick.map(p => p.path);
assert.deepEqual([...appPaths].sort(), [
  'src/components/Board3D.tsx',
  'src/game/aiWorker.ts',
  'src/game/gameLogic.ts',
  'src/utils/format.ts'
]);
assert.ok(appPick.every(p => p.summary.length > 0));
assert.match(appPick.find(p => p.path === 'src/game/gameLogic.ts')?.summary ?? '', /export function dropPiece\(board: Cell\[\]\[\], col: number\): Cell\[\]\[\] \{ … \}/);
assert.match(appPick.find(p => p.path === 'src/components/Board3D.tsx')?.summary ?? '', /interface Board3DProps/);
assert.ok(!appPaths.includes('src/main.tsx') && !appPaths.includes('src/App.test.tsx'));

// A non-entry file only gets what its imports would hit; named files rank first
const hudPick = pickExistingProjectExports({
  taskPath: 'src/components/HUD.tsx',
  brief: 'Show whose turn it is using the types from src/game/gameLogic.ts',
  files: projectFiles,
  maxChars: 4000
});
assert.equal(hudPick[0].path, 'src/game/gameLogic.ts');
assert.ok(hudPick.some(p => p.path === 'src/components/Board3D.tsx'), 'same folder');
assert.ok(!hudPick.some(p => p.path === 'src/components/HUD.tsx'), 'never its own file');
assert.ok(!hudPick.some(p => p.path === 'src/main.tsx' || p.path === 'package.json'));
assert.ok(
  hudPick.findIndex(p => p.path === 'src/components/Board3D.tsx') <
    hudPick.findIndex(p => p.path === 'src/game/aiWorker.ts'),
  'same-folder file outranks a generic game/ file'
);
assert.deepEqual(
  rankExistingProjectFiles({ taskPath: 'src/x.ts', brief: 'unrelated', paths: ['docs/readme.md', 'other/y.ts'] }),
  []
);

// Total budget is honoured
const tinyBudget = pickExistingProjectExports({
  taskPath: 'src/App.tsx',
  brief: 'wire it up',
  files: projectFiles,
  maxChars: 200
});
assert.ok(tinyBudget.reduce((n, p) => n + p.path.length + p.summary.length, 0) <= 200);
assert.deepEqual(
  pickExistingProjectExports({ taskPath: 'src/App.tsx', brief: 'x', files: projectFiles, maxChars: 40 }),
  []
);

console.log('repoMap.selftest ok');
