/**
 * Run: node node_modules/tsx/dist/cli.mjs src/lib/deliveryIntent.selftest.ts
 */
import assert from 'node:assert/strict';
import { inferDeliveryStack, stackFromFilePaths } from './deliveryIntent';

// B-92: negated native stacks and a named TS/React stack are not native-win32
assert.equal(inferDeliveryStack('Build a TypeScript React app, not a C# WinForms program'), 'typescript');
assert.equal(inferDeliveryStack('Build a React app, no WPF please'), 'typescript');
assert.equal(inferDeliveryStack('Build a TypeScript React dashboard instead of a C++ program'), 'typescript');
assert.equal(inferDeliveryStack('Make a WinForms app in C#'), 'native-win32');
assert.equal(inferDeliveryStack('Write a WPF calculator, not React'), 'native-win32');
assert.equal(inferDeliveryStack('Win32 C++ notepad clone'), 'native-win32');
assert.equal(inferDeliveryStack('Build a native Windows application'), 'native-win32');
assert.equal(inferDeliveryStack('Build me a static website for a shop'), 'static-web');

// B-97: backslash paths
assert.equal(stackFromFilePaths(['src\\build.bat']), 'native-win32');
assert.equal(stackFromFilePaths(['src/build.bat']), 'native-win32');
assert.equal(stackFromFilePaths(['src\\App.tsx']), 'typescript');
assert.equal(stackFromFilePaths(['src\\mybuild.bat']), null);

console.log('deliveryIntent.selftest ok');
