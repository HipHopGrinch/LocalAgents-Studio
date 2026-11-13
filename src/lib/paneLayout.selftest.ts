/**
 * Run: npx --yes tsx src/lib/paneLayout.selftest.ts
 */
import assert from 'node:assert/strict';
import {
  AGENT_MIN_FALLBACK,
  EDITOR_DEFAULT,
  EDITOR_MIN,
  EXPLORER_DEFAULT,
  EXPLORER_MAX,
  EXPLORER_MIN,
  INNER_HANDLE_COUNT,
  NODE_WORK_RAIL,
  PANE_RESET,
  SPLIT_LAYOUT_PX,
  TRANSCRIPT_MIN,
  agentPaneMin,
  controlColumnMax,
  fitInnerColumns,
  nodeWorkColumnMax,
  renderedTerminalHeight,
  resolveDesktopPaneLayout,
  terminalMaxHeight
} from './paneLayout';

const columns = { controlWidth: 270, nodeWorkWidth: 280 };
const agentMin = agentPaneMin(270, 280);

function at(rowWidth: number, explorerWidth = EXPLORER_DEFAULT, editorWidth = EDITOR_DEFAULT) {
  return resolveDesktopPaneLayout(rowWidth, { explorerWidth, editorWidth, ...columns });
}

// Defaults at the widths people actually maximize to. The agent pane, not the editor, takes the slack.
const w1500 = at(1500);
assert.equal(w1500.explorer, 240);
assert.equal(w1500.editor, 1500 - 240 - agentMin - w1500.handlePx);
assert.equal(w1500.agent, agentMin);
assert.ok(w1500.editor >= EDITOR_MIN);
assert.ok(w1500.editor < 1500 * 0.4);

const w1920 = at(1920);
assert.equal(w1920.explorer, 240);
assert.equal(w1920.editor, 640);
assert.equal(w1920.agent, 1920 - 240 - 640 - w1920.handlePx);

const w2560 = at(2560);
assert.equal(w2560.editor, 640);
assert.equal(w2560.agent, 2560 - 240 - 640 - w2560.handlePx);

const w3840 = at(3840);
assert.equal(w3840.explorer, 240);
assert.equal(w3840.editor, 640);
assert.equal(w3840.agent, 3840 - 240 - 640 - w3840.handlePx);
assert.ok(w3840.editor / 3840 < 0.2);

// A stored editor wider than the row still reports the stored preference.
const narrow = at(1100, 240, 900);
assert.equal(narrow.persistedEditor, 900);
assert.equal(narrow.persistedExplorer, 240);
assert.ok(narrow.editor < 900);
assert.ok(narrow.editor >= EDITOR_MIN);

// Explorer cannot push the code column under its minimum.
const squeezed = at(1500, 800, 640);
assert.equal(squeezed.persistedExplorer, 800);
assert.ok(squeezed.explorer < 800);
assert.ok(squeezed.explorer <= EXPLORER_MAX);
assert.ok(squeezed.editor >= EDITOR_MIN);
assert.equal(squeezed.editor, EDITOR_MIN);

// No measured columns: reserve the constant fallback instead of the column sum.
const fallback = resolveDesktopPaneLayout(1920, { explorerWidth: 240, editorWidth: 640 });
assert.equal(fallback.agentMin, AGENT_MIN_FALLBACK);
assert.equal(fallback.editor, 640);
assert.equal(fallback.agent, 1920 - 240 - 640 - fallback.handlePx);

// Hidden editor keeps the explorer splitter (1px) and never draws the tree under 160.
const hidden = resolveDesktopPaneLayout(1920, {
  explorerWidth: 240,
  editorWidth: 640,
  editorHidden: true,
  ...columns
});
assert.equal(hidden.editor, 0);
assert.equal(hidden.handlePx, SPLIT_LAYOUT_PX);
assert.equal(hidden.explorer, 240);
assert.equal(hidden.agent, 1920 - 240 - SPLIT_LAYOUT_PX);
assert.equal(hidden.persistedEditor, 640);
const hiddenTight = resolveDesktopPaneLayout(200, {
  explorerWidth: 800,
  editorWidth: 640,
  editorHidden: true,
  ...columns
});
assert.ok(hiddenTight.explorer >= EXPLORER_MIN);
assert.equal(hiddenTight.explorer + hiddenTight.agent + hiddenTight.handlePx, 200);

assert.deepEqual(PANE_RESET, {
  explorerWidth: 240,
  editorWidth: 640,
  agentControlWidth: 270,
  agentNodeWorkWidth: 280,
  terminalHeight: 256
});

// Inner columns leave the transcript its minimum, and report real room below the 200px storage floor.
assert.equal(controlColumnMax(1200, 280), 560);
assert.equal(controlColumnMax(800, 280), 198);
assert.ok(controlColumnMax(800, 280) < 200);
assert.equal(nodeWorkColumnMax(1200, 270), 480);
assert.equal(nodeWorkColumnMax(700, 270), 108);

function assertNoOverflow(rowWidth: number, nodeWorkWidth: number) {
  const row = resolveDesktopPaneLayout(rowWidth, {
    explorerWidth: 240,
    editorWidth: 640,
    controlWidth: 270,
    nodeWorkWidth
  });
  assert.equal(row.explorer + row.editor + row.agent + row.handlePx, rowWidth);
  assert.ok(row.explorer >= EXPLORER_MIN);
  const inner = fitInnerColumns(row.agent, 270, nodeWorkWidth, nodeWorkWidth === NODE_WORK_RAIL);
  const used =
    inner.transcriptMin +
    inner.shownControl +
    inner.shownNode +
    INNER_HANDLE_COUNT * SPLIT_LAYOUT_PX;
  assert.ok(used <= row.agent, `inner ${used} overflowed agent ${row.agent} at ${rowWidth}`);
  assert.ok(inner.controlMin <= inner.controlMax);
  assert.ok(inner.nodeMin <= inner.nodeMax);
  return { row, inner };
}

// 1100px is the window minimum. Expanded node work must shrink instead of clipping.
const at1100 = assertNoOverflow(1100, 280);
assert.equal(at1100.row.editor, EDITOR_MIN);
assert.equal(at1100.inner.transcriptMin, TRANSCRIPT_MIN);
assert.ok(at1100.inner.shownNode < 280);

// Zoomed web console can measure a 1000px row. Same guarantee.
const at1000 = assertNoOverflow(1000, 280);
assert.ok(at1000.inner.shownControl < 270 || at1000.inner.shownNode < 280);
assert.ok(at1000.inner.transcriptMin <= TRANSCRIPT_MIN);

// Collapsed rail is 36, not a full 280 column: a 1500px row keeps a ~630px editor.
const collapsed1500 = assertNoOverflow(1500, NODE_WORK_RAIL);
assert.equal(collapsed1500.row.explorer, 240);
assert.equal(collapsed1500.row.editor, 630);
assert.equal(collapsed1500.inner.shownNode, NODE_WORK_RAIL);
assert.equal(collapsed1500.inner.shownControl, 270);

// Terminal cap follows the column and does not persist a smaller render.
assert.equal(terminalMaxHeight(900), 740);
assert.equal(renderedTerminalHeight(400, 900), 400);
assert.equal(renderedTerminalHeight(400, 500), 340);
assert.equal(renderedTerminalHeight(80, 2000), 120);
assert.ok(terminalMaxHeight(4000) > 720);

assert.equal(EXPLORER_MIN, 160);
assert.equal(EXPLORER_MAX, 800);
