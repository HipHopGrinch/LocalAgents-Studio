/**
 * Run: npx --yes tsx src/lib/renderGate.selftest.ts
 */
import assert from 'node:assert/strict';
import {
  evaluateRenderCheck,
  hasRenderCheckErrors,
  isRenderRelevantFile,
  sourceFileFromUrl,
  type RenderCheckRaw
} from './renderGate';
import { parseCompilerErrors, verifyOutputFailed } from './verifyGate';

const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const viewport = { width: 1280, height: 800 };

/** The generated Connect 4 game: R3F Canvas inside a min-height flex column renders at 1280x150. */
function connect4(over: Partial<NonNullable<RenderCheckRaw['metrics']>> = {}): RenderCheckRaw {
  return {
    ok: true,
    skipped: false,
    viewport,
    console: [],
    pageErrors: [],
    loadFailures: [],
    screenshotPath: 'D:\\proj\\.localagents\\render\\last.png',
    metrics: {
      viewport,
      textLength: 64,
      textSample: 'Connect 4 Red to move',
      visibleCount: 14,
      canvases: [
        {
          el: 'canvas',
          rect: rect(0, 120, 1280, 150),
          visible: true,
          parent: rect(0, 120, 1280, 150),
          chain: [{ el: 'div', rect: rect(0, 120, 1280, 150), height: '150px', position: 'static', display: 'block' }]
        }
      ],
      mount: { el: 'div#root', childElementCount: 1, textLength: 64 },
      largest: { el: 'div.min-h', rect: rect(0, 0, 1280, 800) },
      styles: { sheetCount: 1, sampled: 3, unmatched: [], unusedDefined: ['canvas-container', 'hud'], definedCount: 2 },
      ...over
    }
  };
}

// 1. Connect 4: canvas strip is a failing, actionable TS9105 on the App file.
{
  const r = evaluateRenderCheck(connect4(), { files: ['src/main.tsx', 'src/App.tsx', 'src/index.css'] });
  assert.equal(r.ok, false);
  assert.equal(r.skipped, false);
  const e = r.errors.find(x => x.code === 'TS9105');
  assert.ok(e, 'canvas finding');
  assert.equal(e?.file, 'src/App.tsx');
  assert.match(e!.message, /canvas is 1280x150 in a 1280x800 viewport \(19% of it\)/);
  assert.match(e!.message, /height: 100vh/);
  assert.match(e!.message, /position: fixed; inset: 0/);
  assert.equal(r.summary, 'render check: canvas 1280x150 (19% of viewport)');
  assert.equal(r.screenshotPath, 'D:\\proj\\.localagents\\render\\last.png');
  // Unused index.css classes (.canvas-container, .hud) surface as a warning, not a failure.
  assert.ok(r.warnings.some(w => w.code === 'TS9113' && /\.canvas-container, \.hud/.test(w.message)));
  assert.match(r.notes, /TS9113/);
  // The verify text rides the existing compiler plumbing.
  assert.match(r.verifyText, /^src\/App\.tsx\(1,1\): error TS9105: /);
  assert.equal(verifyOutputFailed(r.verifyText), true);
  const parsed = parseCompilerErrors(r.verifyText);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].file, 'src/App.tsx');
  assert.equal(parsed[0].code, 'TS9105');
  assert.equal(hasRenderCheckErrors(r.verifyText), true);
  assert.ok(r.findings[0].startsWith('error TS9105'));
  assert.ok(r.findings.some(f => f.startsWith('warning TS9113')));
  // Warnings alone never fail verify text.
  assert.equal(verifyOutputFailed(r.notes), false);
}

// Without a file list the layout findings default to src/App.tsx.
{
  const r = evaluateRenderCheck(connect4());
  assert.equal(r.errors[0].file, 'src/App.tsx');
}
// With a file list that has no App file, the file is omitted and the verify line falls back to index.html.
{
  const r = evaluateRenderCheck(connect4(), { files: ['src/main.tsx'] });
  assert.equal(r.errors[0].file, undefined);
  assert.match(r.verifyText, /^index\.html\(1,1\): error TS9105/);
}

// 2. The fixed game: a viewport-filling canvas passes.
{
  const fixed = connect4({
    canvases: [{ el: 'canvas', rect: rect(0, 0, 1280, 800), visible: true, parent: rect(0, 0, 1280, 800) }],
    styles: { sheetCount: 1, sampled: 3, unmatched: [], unusedDefined: [], definedCount: 0 }
  });
  const r = evaluateRenderCheck(fixed);
  assert.equal(r.ok, true);
  assert.equal(r.verifyText, '');
  assert.equal(r.errors.length, 0);
  assert.match(r.summary, /^render check: ok \(canvas 1280x800 \(100% of viewport\)/);
}

// 3. A canvas next to a lot of text (a chart on a dashboard) is not "the page" and does not fail.
{
  const dash = connect4({
    textLength: 2400,
    canvases: [{ el: 'canvas', rect: rect(20, 300, 500, 150), visible: true, parent: rect(20, 300, 500, 150) }]
  });
  const r = evaluateRenderCheck(dash);
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some(w => w.code === 'TS9114'));
}
// A mid-sized chart canvas is not a strip.
{
  const chart = connect4({
    textLength: 40,
    canvases: [{ el: 'canvas', rect: rect(100, 100, 600, 300), visible: true }]
  });
  assert.equal(evaluateRenderCheck(chart).ok, true);
}

// 4. Blank page and an app that never mounted.
{
  const blank: RenderCheckRaw = {
    skipped: false,
    viewport,
    metrics: {
      viewport,
      textLength: 0,
      visibleCount: 0,
      canvases: [],
      mount: { el: 'div#root', childElementCount: 1, textLength: 0 },
      largest: null
    }
  };
  const r = evaluateRenderCheck(blank);
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, 'TS9101');
  assert.match(r.summary, /blank page/);

  const placeholder: RenderCheckRaw = {
    skipped: false,
    metrics: {
      viewport,
      textLength: 8,
      textSample: 'Loading…',
      visibleCount: 1,
      canvases: [],
      mount: { el: 'div#root', childElementCount: 0, textLength: 8 },
      largest: null
    }
  };
  const p = evaluateRenderCheck(placeholder);
  assert.equal(p.ok, false);
  assert.equal(p.errors[0].code, 'TS9101');
  assert.match(p.errors[0].message, /never mounted/);
  assert.match(p.errors[0].message, /Loading/);
}

// 5. Uncaught exceptions: deduped, capped, file taken from the console source.
{
  const raw = connect4({
    canvases: [{ el: 'canvas', rect: rect(0, 0, 1280, 800), visible: true }],
    styles: { sheetCount: 1, sampled: 0, unmatched: [] }
  });
  raw.pageErrors = [
    { message: 'Uncaught TypeError: Cannot read properties of undefined (reading "board") at 12', source: 'http://127.0.0.1:5123/src/Board.tsx?t=1', line: 12 },
    { message: 'Uncaught TypeError: Cannot read properties of undefined (reading "board") at 99', source: 'http://127.0.0.1:5123/src/Board.tsx?t=1', line: 99 }
  ];
  raw.console = [
    { level: 'error', message: raw.pageErrors[0].message },
    { level: 'error', message: 'The above error occurred in the <Board> component' },
    { level: 'warning', message: 'Each child in a list should have a unique "key" prop.' }
  ];
  const r = evaluateRenderCheck(raw);
  assert.equal(r.ok, false);
  const u = r.errors.find(e => e.code === 'TS9102');
  assert.ok(u);
  assert.equal(u?.file, 'src/Board.tsx');
  assert.equal((u!.message.match(/Cannot read properties/g) || []).length, 1, 'duplicate exceptions collapse');
  assert.equal(r.errors.filter(e => e.code === 'TS9103').length, 1);
  assert.ok(r.warnings.some(w => w.code === 'TS9111' && /unique "key"/.test(w.message)));
  assert.equal(parseCompilerErrors(r.verifyText).length, 2);
}

// 6. Console errors alone fail; noise does not.
{
  const base = connect4({
    canvases: [{ el: 'canvas', rect: rect(0, 0, 1280, 800), visible: true }],
    styles: { sheetCount: 1, sampled: 0, unmatched: [] }
  });
  base.console = [
    { level: 'error', message: 'Failed to load resource: the server responded with a status of 404 (Not Found)' },
    { level: 'error', message: '[vite] failed to connect to websocket (Error: x).' },
    { level: 'error', message: 'Failed to load resource: net::ERR_BLOCKED_BY_CLIENT' }
  ];
  const quiet = evaluateRenderCheck(base);
  assert.equal(quiet.ok, true, 'a missing favicon / blocked CDN font is not a failure');
  assert.ok(quiet.warnings.some(w => w.code === 'TS9111'));

  base.console = Array.from({ length: 9 }, (_, i) => ({ level: 'error' as const, message: `Failed to compile shader ${i}: bad token ${'x'.repeat(i)}` }));
  const loud = evaluateRenderCheck(base);
  assert.equal(loud.ok, false);
  const c = loud.errors.find(e => e.code === 'TS9103');
  assert.ok(c);
  assert.match(c!.message, /\(\+\d+ more\)/);
  assert.ok(c!.message.length < 1600);
}

// 7. WebGL missing in the check window is an environment warning, not a project failure.
{
  const raw = connect4({ canvases: [{ el: 'canvas', rect: rect(0, 0, 1280, 800), visible: true }], styles: { sheetCount: 1, sampled: 0, unmatched: [] } });
  raw.pageErrors = [{ message: 'Uncaught Error: Error creating WebGL context.', source: '' }];
  const r = evaluateRenderCheck(raw);
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some(w => /WebGL/.test(w.message)));
}

// 8. Vite error overlay and failed loads.
{
  const raw: RenderCheckRaw = {
    skipped: false,
    metrics: {
      viewport,
      textLength: 0,
      visibleCount: 0,
      canvases: [],
      mount: { el: 'div#root', childElementCount: 0, textLength: 0 },
      largest: null,
      overlay: { message: 'Failed to resolve import "./Cell" from "src/Board.tsx". Does the file exist?', file: '/proj/src/Board.tsx:3:20' }
    }
  };
  const r = evaluateRenderCheck(raw);
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, 'TS9102');
  assert.match(r.errors[0].message, /Failed to resolve import/);
  assert.ok(!r.errors.some(e => e.code === 'TS9101'), 'overlay explains the blank page');

  const dead = evaluateRenderCheck({ skipped: false, loadFailures: [{ code: -102, description: 'ERR_CONNECTION_REFUSED', mainFrame: true }] });
  assert.equal(dead.ok, false);
  assert.equal(dead.errors[0].code, 'TS9104');
  assert.equal(evaluateRenderCheck({ skipped: false, crashed: true }).errors[0].code, 'TS9104');
}

// 9. Unstyled classes: a warning when a few miss, an error when most miss.
{
  const withStyles = (unmatched: string[], sampled: number) =>
    connect4({
      canvases: [{ el: 'canvas', rect: rect(0, 0, 1280, 800), visible: true }],
      styles: { sheetCount: 1, sampled, unmatched, unusedDefined: [] }
    });
  const few = evaluateRenderCheck(withStyles(['active', 'selected'], 20), { files: ['src/App.tsx', 'src/index.css'] });
  assert.equal(few.ok, true);
  assert.ok(few.warnings.some(w => w.code === 'TS9112' && /\.active, \.selected/.test(w.message)));

  const most = evaluateRenderCheck(
    withStyles(['flex', 'bg-slate-900', 'text-white', 'p-4', 'rounded', 'grid', 'gap-2'], 10),
    { files: ['src/App.tsx', 'src/index.css'] }
  );
  assert.equal(most.ok, false);
  const e = most.errors.find(x => x.code === 'TS9107');
  assert.ok(e);
  assert.equal(e?.file, 'src/index.css');
  assert.match(e!.message, /7 of 10 sampled class names/);

  // A tiny sample (3 of 3 unmatched) is too thin to fail on.
  assert.equal(evaluateRenderCheck(withStyles(['a', 'b', 'c'], 3)).ok, true);
  // No stylesheet at all: the script reports nothing, so nothing is claimed here.
  assert.equal(
    evaluateRenderCheck(
      connect4({
        canvases: [{ el: 'canvas', rect: rect(0, 0, 1280, 800), visible: true }],
        styles: { sheetCount: 0, sampled: 6, unmatched: [] }
      })
    ).ok,
    true
  );
}

// 10. Collapsed content: error only when there is nothing substantial; a small real page is a warning.
{
  const collapsed: RenderCheckRaw = {
    skipped: false,
    metrics: {
      viewport,
      textLength: 12,
      visibleCount: 3,
      canvases: [],
      mount: { el: 'div#root', childElementCount: 1, textLength: 12 },
      largest: { el: 'div.board', rect: rect(0, 0, 1280, 90) }
    }
  };
  const r = evaluateRenderCheck(collapsed);
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, 'TS9106');

  const counter: RenderCheckRaw = {
    skipped: false,
    metrics: {
      viewport,
      textLength: 140,
      visibleCount: 6,
      canvases: [],
      mount: { el: 'div#root', childElementCount: 1, textLength: 140 },
      largest: { el: 'div.counter', rect: rect(400, 100, 480, 140) }
    }
  };
  const c = evaluateRenderCheck(counter);
  assert.equal(c.ok, true);
  assert.ok(c.warnings.some(w => w.code === 'TS9114'));
}

// 11. Infrastructure problems are a pass, never a failure.
{
  for (const raw of [
    null,
    undefined,
    { ok: true, skipped: true, reason: 'vite is not installed in node_modules (render check never runs npm install)' },
    { ok: false, skipped: true, reason: 'Workspace root missing' },
    { skipped: false, metrics: null }
  ] as Array<RenderCheckRaw | null | undefined>) {
    const r = evaluateRenderCheck(raw);
    assert.equal(r.ok, true);
    assert.equal(r.skipped, true);
    assert.equal(r.verifyText, '');
    assert.equal(r.errors.length, 0);
    assert.match(r.summary, /^render check skipped:/);
  }
}

// helpers
assert.equal(sourceFileFromUrl('http://127.0.0.1:5173/src/App.tsx?t=17'), 'src/App.tsx');
assert.equal(sourceFileFromUrl('http://127.0.0.1:5173/node_modules/.vite/deps/react.js'), '');
assert.equal(sourceFileFromUrl('http://127.0.0.1:5173/@vite/client'), '');
assert.equal(sourceFileFromUrl(''), '');
assert.equal(isRenderRelevantFile('src/Board.tsx'), true);
assert.equal(isRenderRelevantFile('src/index.css'), true);
assert.equal(isRenderRelevantFile('src/logic.ts'), false);
assert.equal(isRenderRelevantFile('package.json'), false);
assert.equal(hasRenderCheckErrors('src/App.tsx(1,1): error TS2304: x'), false);
assert.equal(hasRenderCheckErrors('index.html(1,1): error TS9001: blank'), false);

console.log('renderGate.selftest ok');
