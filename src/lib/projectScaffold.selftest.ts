/**
 * Run: npx --yes tsx src/lib/projectScaffold.selftest.ts
 */
import assert from 'node:assert/strict';
import {
  APP_DEFAULT_EXPORT_NOTE,
  MAIN_TSX_NOTE,
  VITE_PACKAGE_TASK_NOTE,
  manifestNeedsWebScaffold,
  mergeEssentialWebPackageJson,
  planWebScaffoldWrites,
  promptRequestsWebScaffold,
  scaffoldFilesForStack,
  scaffoldMainTsx,
  inferDeliveryFromText
} from './projectScaffold';

assert.equal(promptRequestsWebScaffold('create a 3d connect four webapp with a ai opponent'), true);
assert.equal(promptRequestsWebScaffold('build a browser game'), true);
assert.equal(promptRequestsWebScaffold('make a website'), true);
assert.equal(promptRequestsWebScaffold('a web app for notes'), true);
assert.equal(promptRequestsWebScaffold('3d print a bracket'), false);
assert.equal(promptRequestsWebScaffold('typescript node cli'), false);
assert.equal(promptRequestsWebScaffold('c# 3d game'), false);
assert.equal(promptRequestsWebScaffold('electron app'), false);
assert.equal(promptRequestsWebScaffold('write a python script that sorts files'), false);
assert.equal(promptRequestsWebScaffold('python website with flask'), false);
assert.equal(promptRequestsWebScaffold('rust cli that prints hello'), false);

assert.equal(
  manifestNeedsWebScaffold({
    stack: 'typescript',
    tasks: [{ filePath: 'src/index.ts', instructions: 'cli entry' }]
  }),
  false
);
assert.equal(
  manifestNeedsWebScaffold({
    stack: 'node',
    tasks: [{ filePath: 'src/index.ts', instructions: 'electron main' }]
  }),
  false
);
assert.equal(
  manifestNeedsWebScaffold({
    stack: 'python',
    tasks: [{ filePath: 'src/components/Board3D.tsx', instructions: 'board' }]
  }),
  true
);
assert.equal(
  manifestNeedsWebScaffold({
    stack: 'python',
    contractCode: 'use vite and react',
    tasks: [{ filePath: 'main.py', instructions: 'game' }]
  }),
  true
);
assert.equal(
  manifestNeedsWebScaffold({
    stack: 'python',
    tasks: [
      { filePath: 'package.json', instructions: 'dependencies for three and react' },
      { filePath: 'main.py', instructions: 'unused' }
    ]
  }),
  true
);
assert.equal(
  manifestNeedsWebScaffold({
    stack: 'python',
    tasks: [{ filePath: 'main.py', instructions: 'print hello' }]
  }),
  false
);
assert.equal(
  manifestNeedsWebScaffold({
    stack: 'go',
    tasks: [{ filePath: 'main.go', instructions: 'server' }]
  }),
  false
);

const plan = planWebScaffoldWrites([
  { filePath: 'package.json', instructions: 'package.json for the game', requiredExports: [] },
  { filePath: 'src/App.tsx', instructions: 'root view', requiredExports: ['export function Board(): JSX.Element'] },
  { filePath: 'src/game/logic.ts', instructions: 'rules', requiredExports: [] }
]);
assert.equal(plan.toWrite.some(file => file.path === 'package.json'), false);
assert.equal(plan.toWrite.some(file => file.path === 'src/App.tsx'), false);
assert.equal(plan.toWrite.some(file => file.path === 'tsconfig.json'), true);
assert.equal(plan.toWrite.some(file => file.path === 'vite.config.ts'), true);
assert.equal(plan.toWrite.some(file => file.path === 'index.html'), true);
assert.equal(plan.toWrite.some(file => file.path === 'src/main.tsx'), true);
assert.ok(plan.ownedSkips.includes('package.json'));
assert.ok(plan.ownedSkips.includes('src/App.tsx'));
assert.equal(plan.notes.find(note => note.path === 'package.json')?.note, VITE_PACKAGE_TASK_NOTE);
assert.equal(plan.notes.find(note => note.path === 'src/App.tsx')?.note, APP_DEFAULT_EXPORT_NOTE);

const ownedMain = planWebScaffoldWrites([{ filePath: 'src/main.tsx', instructions: 'entry' }]);
assert.equal(ownedMain.toWrite.some(file => file.path === 'src/main.tsx'), false);
assert.equal(ownedMain.notes.find(note => note.path === 'src/main.tsx')?.note, MAIN_TSX_NOTE);

const specified = planWebScaffoldWrites([
  { filePath: 'src/App.tsx', requiredExports: ['export default function App(): JSX.Element'] }
]);
assert.equal(specified.notes.some(note => note.path === 'src/App.tsx'), false);

const main = scaffoldMainTsx();
assert.match(main, /import \* as AppModule from '\.\/App'/);
assert.match(main, /\.default/);
assert.match(main, /named App/);
assert.equal(scaffoldFilesForStack('typescript').find(file => file.path === 'src/main.tsx')?.content, main);

const merged = mergeEssentialWebPackageJson(
  JSON.stringify({
    name: 'connect-four',
    dependencies: { react: '18.2.0', three: '^0.170.0' },
    scripts: { start: 'node index.js' }
  })
);
assert.equal(merged.changed, true);
const pkg = JSON.parse(merged.content);
assert.equal(pkg.dependencies.react, '18.2.0');
assert.equal(pkg.dependencies.three, '^0.170.0');
assert.ok(pkg.dependencies['react-dom']);
assert.ok(pkg.devDependencies.vite);
assert.ok(pkg.devDependencies['@vitejs/plugin-react']);
assert.ok(pkg.devDependencies.typescript);
assert.ok(pkg.devDependencies['@types/react']);
assert.equal(pkg.scripts.dev, 'vite');
assert.match(pkg.scripts.build, /vite build/);
assert.equal(pkg.scripts.start, 'node index.js');
assert.equal(pkg.dependencies['@react-three/fiber'], undefined);
assert.ok(pkg.devDependencies['@types/react-dom']);

const hinted = mergeEssentialWebPackageJson('{"name":"app"}', 'use @react-three/fiber and @react-three/drei');
const hintedPkg = JSON.parse(hinted.content);
assert.ok(hintedPkg.dependencies.three);
assert.ok(hintedPkg.dependencies['@react-three/fiber']);
assert.ok(hintedPkg.dependencies['@react-three/drei']);

const same = mergeEssentialWebPackageJson(merged.content);
assert.equal(same.changed, false);
assert.equal(same.content, merged.content);

const broken = mergeEssentialWebPackageJson('{not json');
assert.equal(broken.changed, false);
assert.equal(broken.content, '{not json');

// B-47: the verb "go" is not the Go language
assert.notEqual(inferDeliveryFromText('go build a react website'), 'go');
assert.equal(inferDeliveryFromText('go build a react website'), 'web');
assert.equal(inferDeliveryFromText('build a CLI in Go'), 'go');
assert.equal(inferDeliveryFromText('write a golang service'), 'go');
assert.equal(inferDeliveryFromText('go ahead and make a web page'), 'web');
