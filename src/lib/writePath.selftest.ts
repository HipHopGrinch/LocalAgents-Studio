/**
 * Run: npx --yes tsx src/lib/writePath.selftest.ts
 */
import assert from 'node:assert/strict';
import { clampWritePath } from './writePath';

const root = 'D:/work/app';

assert.equal(clampWritePath(root, 'src/README.md'), 'src/README.md');
assert.equal(clampWritePath(root, 'src/../README.md'), null);
assert.equal(clampWritePath(root, 'src/../../Windows/notepad.exe'), null);
assert.equal(clampWritePath(root, 'D:/work/app/src/a.ts'), 'src/a.ts');
assert.equal(clampWritePath(root, 'D:/work/other/a.ts'), null);
assert.equal(clampWritePath(root, '\\\\?\\D:\\work\\app\\a.ts'), null);
assert.equal(clampWritePath(root, '\\\\.\\C:\\Windows\\notepad.exe'), null);
assert.equal(clampWritePath(root, '//?/D:/work/app/a.ts'), null);
assert.equal(clampWritePath(root, 'CON'), null);
assert.equal(clampWritePath(root, 'src/NUL'), null);
assert.equal(clampWritePath(root, 'src/COM1.txt'), null);
assert.equal(clampWritePath(root, 'src/console.ts'), 'src/console.ts');
assert.equal(clampWritePath(root, 'src/a.ts:Zone.Identifier'), null);
assert.equal(clampWritePath(root, 'src/./b.ts'), 'src/b.ts');
assert.equal(clampWritePath(root, ''), 'file');
assert.equal(clampWritePath('', 'a.ts'), null);
assert.equal(clampWritePath(root, 'a.ts\0hidden'), null);

console.log('writePath.selftest ok');
