/**
 * Desktop pane sizes. Stored widths are what we persist. Rendered widths are
 * clamped to the current row and are not written back on window resize.
 */

export const EXPLORER_MIN = 160;
export const EXPLORER_MAX = 800;
export const EXPLORER_DEFAULT = 240;

export const EDITOR_MIN = 300;
export const EDITOR_MAX_STORED = 2400;
export const EDITOR_DEFAULT = 640;

export const TRANSCRIPT_MIN = 320;
export const CONTROL_MIN = 200;
export const CONTROL_MAX = 560;
export const CONTROL_DEFAULT = 270;
export const NODE_WORK_MIN = 200;
export const NODE_WORK_MAX = 480;
export const NODE_WORK_DEFAULT = 280;
export const NODE_WORK_RAIL = 36;

/** Used when the caller does not know the conductor / node-work columns. */
export const AGENT_MIN_FALLBACK = 720;

/**
 * Each splitter is an 8px hit target with negative margin, so the flex row
 * only spends 1px on the visible line.
 */
export const SPLIT_LAYOUT_PX = 1;
export const OUTER_HANDLE_COUNT = 2;
export const INNER_HANDLE_COUNT = 2;

export const TERMINAL_MIN = 120;
export const TERMINAL_DEFAULT = 256;
export const TERMINAL_CHROME = 160;

export const PANE_RESET = {
  explorerWidth: EXPLORER_DEFAULT,
  editorWidth: EDITOR_DEFAULT,
  agentControlWidth: CONTROL_DEFAULT,
  agentNodeWorkWidth: NODE_WORK_DEFAULT,
  terminalHeight: TERMINAL_DEFAULT
} as const;

export function clampInt(value: number, min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  if (!Number.isFinite(value)) return lo;
  return Math.round(Math.min(hi, Math.max(lo, value)));
}

/** Transcript + conductor + node work + the two inner splitters. */
export function agentPaneMin(control: number, nodeWork: number): number {
  return TRANSCRIPT_MIN + control + nodeWork + INNER_HANDLE_COUNT * SPLIT_LAYOUT_PX;
}

export interface DesktopPaneInput {
  explorerWidth: number;
  editorWidth: number;
  /** Omit both column widths to reserve the 720px fallback instead. */
  controlWidth?: number;
  nodeWorkWidth?: number;
  editorHidden?: boolean;
}

export interface DesktopPaneLayout {
  rowWidth: number;
  explorer: number;
  editor: number;
  agent: number;
  agentMin: number;
  explorerMax: number;
  editorMax: number;
  /** Storage-clamped preferences. A narrow row does not change these. */
  persistedExplorer: number;
  persistedEditor: number;
  handlePx: number;
}

/** Shown chrome, including the 36px rail. Not the 200px storage clamp. */
function shownSpan(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.round(value));
}

function columnAgentMin(input: DesktopPaneInput): number {
  if (input.controlWidth == null && input.nodeWorkWidth == null) return AGENT_MIN_FALLBACK;
  return agentPaneMin(
    shownSpan(input.controlWidth, CONTROL_DEFAULT),
    shownSpan(input.nodeWorkWidth, NODE_WORK_DEFAULT)
  );
}

/**
 * Give leftover width to the agent pane. Shrink the editor toward its minimum
 * before the explorer, so a wide explorer cannot crush the code column.
 */
export function resolveDesktopPaneLayout(rowWidth: number, input: DesktopPaneInput): DesktopPaneLayout {
  const width = Number.isFinite(rowWidth) ? Math.max(0, Math.round(rowWidth)) : 0;
  const persistedExplorer = clampInt(input.explorerWidth, EXPLORER_MIN, EXPLORER_MAX);
  const persistedEditor = clampInt(
    Number.isFinite(input.editorWidth) ? input.editorWidth : EDITOR_DEFAULT,
    EDITOR_MIN,
    EDITOR_MAX_STORED
  );
  const agentMin = columnAgentMin(input);

  if (input.editorHidden) {
    // The explorer splitter stays. The agent pane absorbs whatever is left and
    // can shrink its own columns; the tree never renders below 160px.
    const handlePx = SPLIT_LAYOUT_PX;
    let explorer = persistedExplorer;
    const maxFit = Math.max(0, width - handlePx);
    if (explorer > maxFit) explorer = Math.max(EXPLORER_MIN, maxFit);
    if (width >= EXPLORER_MIN + handlePx) explorer = Math.max(EXPLORER_MIN, explorer);
    const agent = Math.max(0, width - explorer - handlePx);
    const explorerMax = Math.min(EXPLORER_MAX, Math.max(explorer, maxFit));
    return {
      rowWidth: width,
      explorer,
      editor: 0,
      agent,
      agentMin,
      explorerMax,
      editorMax: 0,
      persistedExplorer,
      persistedEditor,
      handlePx
    };
  }

  const handlePx = OUTER_HANDLE_COUNT * SPLIT_LAYOUT_PX;
  let explorer = persistedExplorer;
  let editor = persistedEditor;
  let agent = agentMin;
  let extra = explorer + editor + agent + handlePx - width;

  if (extra > 0) {
    const cut = Math.min(extra, Math.max(0, editor - EDITOR_MIN));
    editor -= cut;
    extra -= cut;
  }
  if (extra > 0) {
    const cut = Math.min(extra, Math.max(0, explorer - EXPLORER_MIN));
    explorer -= cut;
    extra -= cut;
  }
  if (extra > 0) {
    const cut = Math.min(extra, Math.max(0, agent));
    agent -= cut;
    extra -= cut;
  }
  if (extra > 0) {
    editor = Math.max(0, editor - extra);
  }

  agent = Math.max(0, width - explorer - editor - handlePx);

  const roomForExplorer = width - EDITOR_MIN - agentMin - handlePx;
  const explorerMax = Math.min(EXPLORER_MAX, Math.max(explorer, roomForExplorer));
  const roomForEditor = width - explorer - agentMin - handlePx;
  const editorMax =
    roomForEditor >= EDITOR_MIN
      ? Math.min(EDITOR_MAX_STORED, roomForEditor)
      : Math.max(0, editor);

  return {
    rowWidth: width,
    explorer,
    editor,
    agent,
    agentMin,
    explorerMax: Math.max(0, explorerMax),
    editorMax,
    persistedExplorer,
    persistedEditor,
    handlePx
  };
}

/**
 * Room left for the conductor after the transcript floor and the node column.
 * Can be below 200 when the pane is narrow — callers must not snap back up to the storage min.
 */
export function controlColumnMax(
  paneWidth: number,
  nodeWorkShown: number,
  transcriptMin = TRANSCRIPT_MIN
): number {
  const room =
    paneWidth - nodeWorkShown - transcriptMin - INNER_HANDLE_COUNT * SPLIT_LAYOUT_PX;
  if (!Number.isFinite(room)) return CONTROL_MAX;
  return Math.min(CONTROL_MAX, Math.max(0, Math.round(room)));
}

/** Room left for Node Work. Can be below 200. A collapsed rail does not use this as a floor. */
export function nodeWorkColumnMax(
  paneWidth: number,
  controlShown: number,
  transcriptMin = TRANSCRIPT_MIN
): number {
  const room =
    paneWidth - controlShown - transcriptMin - INNER_HANDLE_COUNT * SPLIT_LAYOUT_PX;
  if (!Number.isFinite(room)) return NODE_WORK_MAX;
  return Math.min(NODE_WORK_MAX, Math.max(0, Math.round(room)));
}

export interface FittedColumns {
  shownControl: number;
  shownNode: number;
  /** Drag floor. Equals the fitted width when the 200px storage min would overflow. */
  controlMin: number;
  controlMax: number;
  nodeMin: number;
  nodeMax: number;
  /** 320 when the pane can hold it, otherwise whatever is left (the transcript uses min-w-0). */
  transcriptMin: number;
}

/**
 * Fit conductor + node work inside the agent pane.
 * Shrink an expanded node column first, then the conductor.
 * `nodeForControl` freezes the node width used while that column is being dragged.
 */
export function fitInnerColumns(
  paneWidth: number,
  controlPref: number,
  nodePref: number,
  collapsed = false,
  nodeForControl?: number
): FittedColumns {
  const pane = Number.isFinite(paneWidth) ? Math.max(0, Math.round(paneWidth)) : 0;
  const handles = INNER_HANDLE_COUNT * SPLIT_LAYOUT_PX;
  const body = Math.max(0, pane - handles);
  const controlWant = Math.max(0, Math.min(CONTROL_MAX, Math.round(shownSpan(controlPref, CONTROL_DEFAULT))));
  const nodeWant = collapsed
    ? NODE_WORK_RAIL
    : Math.max(0, Math.min(NODE_WORK_MAX, Math.round(shownSpan(nodePref, NODE_WORK_DEFAULT))));
  const basis = collapsed
    ? NODE_WORK_RAIL
    : Math.max(
        0,
        Math.min(NODE_WORK_MAX, Math.round(shownSpan(nodeForControl ?? nodeWant, nodeWant)))
      );

  let transcript = Math.min(TRANSCRIPT_MIN, body);
  let budget = body - transcript;
  let control = controlWant;
  let reserved = basis;

  if (!collapsed) {
    const overflow = Math.max(0, control + reserved - budget);
    reserved = Math.max(0, reserved - overflow);
    control = Math.max(0, control - Math.max(0, control + reserved - budget));
  } else {
    const overflow = Math.max(0, control + NODE_WORK_RAIL - budget);
    control = Math.max(0, control - overflow);
    const still = Math.max(0, control + NODE_WORK_RAIL - budget);
    if (still > 0) {
      const steal = Math.min(transcript, still);
      transcript -= steal;
      budget += steal;
    }
    reserved = Math.min(NODE_WORK_RAIL, Math.max(0, budget - control));
  }

  const roomForNode = Math.max(0, budget - control);
  const shownNode = collapsed ? reserved : Math.min(nodeWant, roomForNode);
  const roomForControl = Math.max(0, budget - shownNode);
  const controlMax = Math.min(CONTROL_MAX, roomForControl);
  control = Math.min(control, controlMax);
  const controlMin = Math.min(CONTROL_MIN, controlMax);
  const nodeMax = collapsed ? shownNode : Math.min(NODE_WORK_MAX, Math.max(0, budget - control));
  const nodeShown = Math.min(shownNode, nodeMax);
  const nodeMin = collapsed ? nodeShown : Math.min(NODE_WORK_MIN, nodeMax);

  return {
    shownControl: control,
    shownNode: nodeShown,
    controlMin,
    controlMax,
    nodeMin,
    nodeMax,
    transcriptMin: transcript
  };
}

/** Terminal cap is the editor column height minus chrome. There is no 720px cap. */
export function terminalMaxHeight(columnHeight: number): number {
  if (!Number.isFinite(columnHeight) || columnHeight <= 0) return TERMINAL_MIN;
  return Math.max(TERMINAL_MIN, Math.round(columnHeight - TERMINAL_CHROME));
}

export function renderedTerminalHeight(stored: number, columnHeight: number): number {
  const max = terminalMaxHeight(columnHeight);
  const preferred = Number.isFinite(stored) ? stored : TERMINAL_DEFAULT;
  return clampInt(preferred, TERMINAL_MIN, max);
}
