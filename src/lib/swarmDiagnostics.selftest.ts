/**
 * Run: node node_modules/tsx/dist/cli.mjs src/lib/swarmDiagnostics.selftest.ts
 */
import assert from 'node:assert/strict';
import { assignSwarmDiagnostics } from '../components/agent/swarmDiagnostics';

// B-93: only the importer whose specifier resolves to the failing file gets the errors
const bodies = new Map<string, string>([
  ['src/app.tsx', "import { Button } from './components/button';\nexport const App = () => null;\n"],
  ['src/forms/editor.tsx', "import { Button } from '../ui/button';\nexport const Editor = () => null;\n"],
  ['src/pages/home.tsx', "import { Button } from '@/ui/button';\n"],
  ['src/ui/index.tsx', "import { Button } from './button';\n"]
]);
const byFile = new Map<string, string>([['src/ui/button.tsx', 'src/ui/button.tsx(3,1): error TS2322: bad']]);
const owned = ['src/app.tsx', 'src/forms/editor.tsx', 'src/pages/home.tsx', 'src/ui/index.tsx'];
const result = assignSwarmDiagnostics(byFile, owned, bodies);
assert.deepEqual([...result.owned.keys()].sort(), ['src/forms/editor.tsx', 'src/pages/home.tsx', 'src/ui/index.tsx']);
assert.equal(result.owned.has('src/app.tsx'), false);
assert.deepEqual(result.unmatched, []);

// Windows paths and absolute tsc paths still resolve
const win = assignSwarmDiagnostics(
  new Map([['D:\\proj\\src\\ui\\button.tsx', 'err']]),
  ['src\\forms\\editor.tsx'],
  new Map([['src\\forms\\editor.tsx', "import { Button } from '../ui/button';"]])
);
assert.deepEqual([...win.owned.keys()], ['src\\forms\\editor.tsx']);

// Nobody imports it: unmatched
const none = assignSwarmDiagnostics(byFile, ['src/app.tsx'], new Map([['src/app.tsx', bodies.get('src/app.tsx')!]]));
assert.equal(none.owned.size, 0);
assert.equal(none.unmatched.length, 1);

console.log('swarmDiagnostics.selftest ok');
