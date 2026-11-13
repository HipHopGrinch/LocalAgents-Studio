/**
 * Run: npx --yes tsx src/lib/hygieneFix.selftest.ts
 */
import assert from 'node:assert/strict';
import { fixUnusedImports, isHygieneError, type HygieneError } from './hygieneFix';

const unused = (line: number, name: string, code = 'TS6133'): HygieneError => ({
  line,
  code,
  message: `'${name}' is declared but its value is never read.`
});
const neverUsed = (line: number, name: string): HygieneError => ({
  line,
  code: 'TS6196',
  message: `'${name}' is declared but never used.`
});
const allImports = (line: number): HygieneError => ({
  line,
  code: 'TS6192',
  message: 'All imports in import declaration are unused.'
});

// --- classification ---
assert.equal(isHygieneError(unused(1, 'a')), true);
assert.equal(isHygieneError(neverUsed(1, 'T')), true);
assert.equal(isHygieneError(allImports(1)), true);
assert.equal(isHygieneError({ line: 1, code: 'TS2322', message: "'a' is declared but its value is never read." }), false);
assert.equal(isHygieneError({ line: 1, code: 'TS6133', message: 'Something else entirely' }), false);
assert.equal(isHygieneError({ line: 1, code: 'TS6198', message: 'All destructured elements are unused.' }), false);

// --- single-line named specifier ---
{
  const src = `import { a, b, c } from 'x';\nconsole.log(a, c);\n`;
  const r = fixUnusedImports(src, [unused(1, 'b')]);
  assert.equal(r.text, `import { a, c } from 'x';\nconsole.log(a, c);\n`);
  assert.equal(r.removed, 1);
  assert.deepEqual(r.names, ['b']);
}

// --- first and last specifier, tight braces ---
{
  const r = fixUnusedImports(`import {a,b,c} from "x"\n`, [unused(1, 'a'), unused(1, 'c')]);
  assert.equal(r.text, `import {b} from "x"\n`);
  assert.equal(r.removed, 2);
}

// --- every named specifier unused -> the whole line goes ---
{
  const src = `import { a, b } from 'x';\nimport { c } from 'y';\nexport const v = c;\n`;
  const r = fixUnusedImports(src, [unused(1, 'a'), unused(1, 'b')]);
  assert.equal(r.text, `import { c } from 'y';\nexport const v = c;\n`);
  assert.equal(r.removed, 2);
}

// --- TS6192 removes the whole declaration ---
{
  const src = `import React, { useState } from 'react';\nexport const x = 1;\n`;
  const r = fixUnusedImports(src, [allImports(1)]);
  assert.equal(r.text, `export const x = 1;\n`);
  assert.equal(r.removed, 2);
  assert.deepEqual([...r.names].sort(), ['React', 'useState']);
}

// --- multi-line import with trailing comma ---
{
  const src = [
    `import {`,
    `  alpha,`,
    `  beta,`,
    `  gamma,`,
    `} from './mod';`,
    `use(alpha);`,
    ``
  ].join('\n');
  const r = fixUnusedImports(src, [unused(3, 'beta'), unused(4, 'gamma')]);
  assert.equal(r.text, [`import {`, `  alpha,`, `} from './mod';`, `use(alpha);`, ``].join('\n'));
  assert.equal(r.removed, 2);
}

// --- multi-line import without trailing comma, remove the first ---
{
  const src = [`import {`, `  alpha,`, `  beta`, `} from './mod';`, `use(beta);`, ``].join('\n');
  const r = fixUnusedImports(src, [unused(2, 'alpha')]);
  assert.equal(r.text, [`import {`, `  beta`, `} from './mod';`, `use(beta);`, ``].join('\n'));
}

// --- multi-line import where every specifier is unused ---
{
  const src = [`import {`, `  alpha,`, `  beta,`, `} from './mod';`, `export const q = 1;`, ``].join('\n');
  const r = fixUnusedImports(src, [unused(2, 'alpha'), unused(3, 'beta')]);
  assert.equal(r.text, `export const q = 1;\n`);
  assert.equal(r.removed, 2);
}

// --- inline `type` modifiers and import type ---
{
  const src = `import { type Foo, Bar, type Baz as Qux } from './t';\nuse(Bar);\n`;
  const r = fixUnusedImports(src, [neverUsed(1, 'Foo'), neverUsed(1, 'Qux')]);
  assert.equal(r.text, `import { Bar } from './t';\nuse(Bar);\n`);
  assert.equal(r.removed, 2);
}
{
  const src = `import type { A, B } from './types';\nlet x: A;\n`;
  const r = fixUnusedImports(src, [neverUsed(1, 'B')]);
  assert.equal(r.text, `import type { A } from './types';\nlet x: A;\n`);
}
{
  const src = `import type { A } from './types';\nexport {};\n`;
  const r = fixUnusedImports(src, [neverUsed(1, 'A')]);
  assert.equal(r.text, `export {};\n`);
}
{
  const src = `import type Def from './types';\nexport {};\n`;
  const r = fixUnusedImports(src, [neverUsed(1, 'Def')]);
  assert.equal(r.text, `export {};\n`);
}
{
  // a default import literally named `type`
  const src = `import type from './t';\nexport {};\n`;
  const r = fixUnusedImports(src, [unused(1, 'type')]);
  assert.equal(r.text, `export {};\n`);
}

// --- aliases: the compiler names the local binding ---
{
  const src = `import { original as local, keep } from 'm';\nuse(keep);\n`;
  const r = fixUnusedImports(src, [unused(1, 'local')]);
  assert.equal(r.text, `import { keep } from 'm';\nuse(keep);\n`);
  // naming the imported (not the local) name is not a match
  const miss = fixUnusedImports(src, [unused(1, 'original')]);
  assert.equal(miss.text, src);
  assert.equal(miss.removed, 0);
}

// --- default + named combinations ---
{
  const src = `import React, { useState, useEffect } from 'react';\nuseState();\n`;
  const noDefault = fixUnusedImports(src, [unused(1, 'React'), unused(1, 'useEffect')]);
  assert.equal(noDefault.text, `import { useState } from 'react';\nuseState();\n`);
  assert.equal(noDefault.removed, 2);

  const onlyDefault = fixUnusedImports(`import React, { useState } from 'react';\nuseState();\n`, [unused(1, 'React')]);
  assert.equal(onlyDefault.text, `import { useState } from 'react';\nuseState();\n`);

  const dropNamed = fixUnusedImports(`import React, { useState } from 'react';\nReact.x();\n`, [unused(1, 'useState')]);
  assert.equal(dropNamed.text, `import React from 'react';\nReact.x();\n`);
}

// --- default import alone (TS6133) ---
{
  const src = `import React from 'react';\nimport { render } from 'x';\nrender();\n`;
  const r = fixUnusedImports(src, [unused(1, 'React')]);
  assert.equal(r.text, `import { render } from 'x';\nrender();\n`);
}

// --- namespace imports ---
{
  const src = `import * as path from 'node:path';\nexport const a = 1;\n`;
  const r = fixUnusedImports(src, [unused(1, 'path')]);
  assert.equal(r.text, `export const a = 1;\n`);
  const combo = fixUnusedImports(`import D, * as N from 'm';\nuse(D);\n`, [unused(1, 'N')]);
  assert.equal(combo.text, `import D from 'm';\nuse(D);\n`);
  const comboDefault = fixUnusedImports(`import D, * as N from 'm';\nuse(N);\n`, [unused(1, 'D')]);
  assert.equal(comboDefault.text, `import * as N from 'm';\nuse(N);\n`);
}

// --- side-effect imports are never touched ---
{
  const src = `import './polyfill';\nimport "./styles.css"\nimport { a, b } from 'x';\nuse(a);\n`;
  const r = fixUnusedImports(src, [unused(3, 'b')]);
  assert.equal(r.text, `import './polyfill';\nimport "./styles.css"\nimport { a } from 'x';\nuse(a);\n`);
  assert.equal(fixUnusedImports(src, [allImports(1)]).text, src);
}

// --- import attributes survive ---
{
  const src = `import data, { x } from './d.json' with { type: 'json' };\nuse(data);\n`;
  const r = fixUnusedImports(src, [unused(1, 'x')]);
  assert.equal(r.text, `import data from './d.json' with { type: 'json' };\nuse(data);\n`);
}

// --- CRLF is preserved, including inside rewritten multi-line braces ---
{
  const src = `import {\r\n  alpha,\r\n  beta,\r\n} from './mod';\r\nuse(alpha);\r\n`;
  const r = fixUnusedImports(src, [unused(3, 'beta')]);
  assert.equal(r.text, `import {\r\n  alpha,\r\n} from './mod';\r\nuse(alpha);\r\n`);
  assert.equal(/(?<!\r)\n/.test(r.text), false);
  const whole = fixUnusedImports(`import { a } from 'x';\r\nexport const k = 1;\r\n`, [unused(1, 'a')]);
  assert.equal(whole.text, `export const k = 1;\r\n`);
}

// --- BOM, shebang, directives, and leading comments ---
{
  const src = `\uFEFF/* header */\n'use strict';\nimport { a, b } from 'x';\nuse(a);\n`;
  const r = fixUnusedImports(src, [unused(3, 'b')]);
  assert.equal(r.text, `\uFEFF/* header */\n'use strict';\nimport { a } from 'x';\nuse(a);\n`);
  const shebang = fixUnusedImports(`#!/usr/bin/env node\nimport { a, b } from 'x';\nuse(b);\n`, [unused(2, 'a')]);
  assert.equal(shebang.text, `#!/usr/bin/env node\nimport { b } from 'x';\nuse(b);\n`);
}

// --- several declarations in one pass ---
{
  const src = [
    `import React from 'react';`,
    `import { a, b } from './a';`,
    `import type { T, U } from './t';`,
    `use(a, {} as T);`,
    ``
  ].join('\n');
  const r = fixUnusedImports(src, [unused(1, 'React'), unused(2, 'b'), neverUsed(3, 'U')]);
  assert.equal(r.text, [`import { a } from './a';`, `import type { T } from './t';`, `use(a, {} as T);`, ``].join('\n'));
  assert.equal(r.removed, 3);
}

// --- unsure -> no-op ---
{
  // comment inside the binding clause
  const commented = `import {\n  a, // keep me\n  b,\n} from 'x';\nuse(a);\n`;
  assert.equal(fixUnusedImports(commented, [unused(3, 'b')]).text, commented);
  // stale line number: the name is not on that line
  const stale = `import { a, b } from 'x';\nuse(a);\n`;
  assert.equal(fixUnusedImports(stale, [unused(2, 'b')]).text, stale);
  // a local / parameter is never touched, even if it shares a name with nothing in the imports
  const local = `import { a } from 'x';\nexport function f(unusedParam: number) {\n  const tmp = 1;\n  return a;\n}\n`;
  assert.equal(fixUnusedImports(local, [unused(2, 'unusedParam'), unused(3, 'tmp')]).text, local);
  // an import that appears after other code is not part of the leading block
  const late = `export const k = 1;\nimport { a, b } from 'x';\nuse(a);\n`;
  assert.equal(fixUnusedImports(late, [unused(2, 'b')]).text, late);
  // string-named specifiers and `import x = require()` forms bail rather than guess
  const stringNamed = `import { "a-b" as ab, c } from 'x';\nuse(c);\n`;
  assert.equal(fixUnusedImports(stringNamed, [unused(1, 'ab')]).text, stringNamed);
  const equals = `import fs = require('fs');\nimport { a, b } from 'x';\nuse(a);\n`;
  assert.equal(fixUnusedImports(equals, [unused(2, 'b')]).text, `import fs = require('fs');\nimport { a } from 'x';\nuse(a);\n`);
  // an unrelated error code
  const other = `import { a } from 'x';\n`;
  assert.equal(
    fixUnusedImports(other, [{ line: 1, code: 'TS2305', message: "Module 'x' has no exported member 'a'." }]).text,
    other
  );
  // empty inputs
  assert.equal(fixUnusedImports('', [unused(1, 'a')]).text, '');
  assert.equal(fixUnusedImports(other, []).removed, 0);
  // dynamic import and import.meta are expressions, not declarations
  const dynamic = `import('./lazy');\nconst m = import.meta;\n`;
  assert.equal(fixUnusedImports(dynamic, [unused(1, 'lazy')]).text, dynamic);
}

// --- text after `import` inside strings or later code is never rewritten ---
{
  const src = `import { a, b } from 'x';\nconst s = "import { a, b } from 'x';";\nuse(a, s);\n`;
  const r = fixUnusedImports(src, [unused(1, 'b')]);
  assert.equal(r.text, `import { a } from 'x';\nconst s = "import { a, b } from 'x';";\nuse(a, s);\n`);
}

// --- a statement sharing the line with the removed import keeps its code ---
{
  const src = `import { a } from 'x'; import { b } from 'y';\nuse(b);\n`;
  const r = fixUnusedImports(src, [unused(1, 'a')]);
  assert.equal(r.text, `import { b } from 'y';\nuse(b);\n`);
}

console.log('hygieneFix selftest passed');
