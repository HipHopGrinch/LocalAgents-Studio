/**
 * Run: npx --yes tsx src/lib/buildGate.selftest.ts
 */
import assert from 'node:assert/strict';
import {
  contextWasExhausted,
  fitPromptToContext,
  promptFillsContext,
  shrinkUserPacket
} from './contextMonitor';
import {
  indexHtmlIsBlankShell,
  webEntryGateDeferred,
  webEntryVerifyErrors,
  webRunHint
} from './webEntryGate';

const blank = `<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>`;
const visible = `<!doctype html><html><body style="background:#111"><h1>3D Checkers</h1></body></html>`;
assert.equal(indexHtmlIsBlankShell(blank), true);
assert.equal(indexHtmlIsBlankShell(visible), false);

const errors = webEntryVerifyErrors({
  delivery: 'web',
  indexHtml: blank,
  css: '* { box-sizing: border-box; }',
  sourceSample: 'className="flex bg-slate-900 text-white"'
});
assert.match(errors, /TS9001/);
assert.match(errors, /TS9002/);
assert.equal(webEntryVerifyErrors({ delivery: 'electron', indexHtml: blank }), '');
assert.match(errors, /^index\.html\(1,1\): error TS9001: .*inside the mount element.*background.*npm run dev/m);
assert.equal(errors.split(/\r?\n/).filter(l => l.includes('TS9001')).length, 1);
// Following the TS9001 advice (loading text inside #root, a body background) clears the gate.
const adviceFollowed =
  '<!doctype html><html><body style="background:#111"><div id="root">Loading…</div><script type="module" src="/src/main.tsx"></script></body></html>';
assert.equal(indexHtmlIsBlankShell(adviceFollowed), false);
assert.equal(webEntryVerifyErrors({ delivery: 'web', indexHtml: adviceFollowed }), '');

// A dark body from a <style> block plus a loading line is not a blank page (the connect4 run
// failed four steps on this exact file).
const splash = `<!doctype html>
<html lang="en">
  <head>
    <title>3D Connect 4</title>
    <style>
      html, body, #root { margin: 0; height: 100%; }
      body { font-family: system-ui; background-color: #0f172a; color: #f8fafc; }
      .loading { text-align: center; }
    </style>
  </head>
  <body>
    <div id="root"><div class="loading">Loading 3D Connect 4…</div></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`;
assert.equal(indexHtmlIsBlankShell(splash), false);
assert.equal(webEntryVerifyErrors({ delivery: 'web', indexHtml: splash }), '');
// The title alone does not count as visible content.
assert.equal(
  indexHtmlIsBlankShell(
    '<!doctype html><html><head><title>A long enough page title here</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>'
  ),
  true
);
// A mount node with no script can never render.
assert.match(
  webEntryVerifyErrors({
    delivery: 'web',
    indexHtml: '<!doctype html><html><body style="background:#000"><div id="root"></div></body></html>'
  }),
  /index\.html\(1,1\): error TS9003/
);

// @tailwind directives without a PostCSS config ship unprocessed: the error names the missing file.
const twSource = 'className="flex h-full w-full bg-slate-900"';
const twCss = '@tailwind base;\n@tailwind components;\n@tailwind utilities;';
const pkgModule = '{ "type": "module", "devDependencies": { "tailwindcss": "^3.4.1" } }';
const noPostcss = webEntryVerifyErrors({
  delivery: 'web',
  indexHtml: splash,
  css: twCss,
  sourceSample: twSource,
  postcssConfig: { path: 'postcss.config.js', content: '' },
  tailwindConfig: { path: 'tailwind.config.js', content: '' },
  viteConfig: '',
  packageJson: pkgModule
});
assert.match(noPostcss, /^postcss\.config\.js\(1,1\): error TS9002/m);
assert.match(noPostcss, /export default/);
assert.match(noPostcss, /^tailwind\.config\.js\(1,1\): error TS9002/m);
const wired = webEntryVerifyErrors({
  delivery: 'web',
  indexHtml: splash,
  css: twCss,
  sourceSample: twSource,
  postcssConfig: { path: 'postcss.config.js', content: 'export default { plugins: { tailwindcss: {}, autoprefixer: {} } }' },
  tailwindConfig: { path: 'tailwind.config.js', content: "export default { content: ['./index.html', './src/**/*.{ts,tsx}'] }" },
  viteConfig: '',
  packageJson: pkgModule
});
assert.equal(wired, '');
assert.match(
  webEntryVerifyErrors({
    delivery: 'web',
    indexHtml: splash,
    css: twCss,
    sourceSample: twSource,
    postcssConfig: { path: 'postcss.config.js', content: 'module.exports = { plugins: { tailwindcss: {} } }' },
    tailwindConfig: { path: 'tailwind.config.js', content: "export default { content: ['./src/**/*.tsx'] }" },
    packageJson: pkgModule
  }),
  /type": "module".*module\.exports/
);
assert.equal(
  webEntryVerifyErrors({
    delivery: 'web',
    indexHtml: splash,
    css: '@import "tailwindcss";',
    sourceSample: twSource,
    viteConfig: "import tailwindcss from '@tailwindcss/vite'",
    postcssConfig: null
  }),
  ''
);
// Callers that do not pass the config files keep the old directive-only check.
assert.equal(webEntryVerifyErrors({ delivery: 'web', indexHtml: splash, css: twCss, sourceSample: twSource }), '');

// The gate belongs to the step that owns the entry files.
assert.equal(webEntryGateDeferred(['src/types.ts', 'src/game/logic.ts'], ['src/index.css', 'index.html']), true);
assert.equal(webEntryGateDeferred(['src/index.css', 'index.html'], []), false);
assert.equal(webEntryGateDeferred(['src/App.tsx'], ['src/game/ai.ts']), false);

assert.match(webRunHint('web', { dev: 'vite' }), /npm run dev/);
assert.equal(webRunHint('electron', { dev: 'vite' }), '');
assert.equal(webRunHint('web', { build: 'vite build' }), '');

const fat = `REPO MAP\n${'file.ts\n'.repeat(4000)}\n## Task\n${'x'.repeat(20000)}`;
const shrunk = shrinkUserPacket(fat, 2);
assert.ok(shrunk.length < fat.length);
assert.match(shrunk, /Context monitor/);

const fitted = fitPromptToContext({
  system: 'sys',
  userContent: fat,
  history: [
    { role: 'user', content: 'a'.repeat(8000) },
    { role: 'assistant', content: 'b'.repeat(8000) }
  ],
  maxCtx: 4096
});
assert.ok(fitted.shrinks > 0);
assert.equal(fitted.history.length, 0);
assert.equal(promptFillsContext(100, 4096), false);
assert.equal(contextWasExhausted({ doneReason: 'length', evalCount: 10 }, 16384), true);
assert.equal(contextWasExhausted({ promptEvalCount: 15000, evalCount: 10 }, 16384), true);
assert.equal(contextWasExhausted({ promptEvalCount: 1000, evalCount: 400, doneReason: 'stop' }, 16384), false);

console.log('buildGate.selftest ok');
