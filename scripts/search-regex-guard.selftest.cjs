/**
 * Agent `search` regex guard (B-74, narrowed by F-11). electron/main.cjs needs Electron and
 * cannot be required, so this loads the real guard source from it and runs it in a vm.
 * Run: node scripts/search-regex-guard.selftest.cjs
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
const start = src.indexOf('const SEARCH_REGEX_LINE_CAP');
const end = src.indexOf('async function toolSearch');
assert.ok(start >= 0 && end > start, 'guard source not found in electron/main.cjs');
const ctx = vm.createContext({});
vm.runInContext(
  `${src.slice(start, end)}\nthis.guard = hasNestedQuantifier; this.lineCap = SEARCH_REGEX_LINE_CAP; this.maxLen = SEARCH_REGEX_MAX_LENGTH;`,
  ctx
);
const { guard, lineCap, maxLen } = ctx;

assert.equal(lineCap, 4000, 'line cap stays 4000');
assert.equal(maxLen, 500, 'pattern length cap stays 500');
assert.ok(/query\.length > SEARCH_REGEX_MAX_LENGTH/.test(src), 'toolSearch still enforces the length cap');
assert.ok(/SEARCH_REGEX_LINE_CAP/.test(src.slice(end)), 'toolSearch still applies the line cap');

const reject = [
  '(a+)+$',
  '(a+)*b',
  '(\\w+\\s*)+$',
  '(.*)*x',
  '(a*)*',
  '(a+){2,}',
  '(a|b+)+',
  '(a+|b)*c',
  '(\\w+\\s?)+$',
  '(?:a+)+',
  '((a+))+',
  '((a+)+)',
  '(x(a+))+',
  '([ab]+)+c',
  '(a+?)+'
];
const allow = [
  '(\\d+\\.)+',
  '(foo|bar)+',
  '(a+)?b',
  'function\\s+\\w+',
  '^import .* from',
  '(a+)',
  '(a+)b',
  '(a+b)+',
  '((x*)y)*',
  '(a+){2,5}',
  '(a+){3}',
  '(a+)?',
  '[(a+)]+',
  '\\(a+\\)+',
  '(?:foo|bar)+baz',
  '(\\w+@\\w+\\.)+com',
  'a+b*c?',
  'foo.*bar',
  '(?<n>\\d+,)+'
];

for (const p of reject) assert.equal(guard(p), true, `should reject ${p}`);
for (const p of allow) {
  new RegExp(p); // vectors must be valid regexes
  assert.equal(guard(p), false, `should allow ${p}`);
}
assert.equal(guard(''), false);
assert.equal(guard('((('), false, 'unbalanced input does not throw');
assert.equal(guard('a)+'), false, 'unbalanced close does not throw');

console.log(`search-regex-guard-selftest ok (${reject.length} rejected, ${allow.length} allowed)`);
