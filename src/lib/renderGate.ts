/**
 * Render smoke check analysis. `tsc`, the web entry gate and the Reviewer are static; this turns the
 * raw measurements from the main-process render check (`electron/renderCheck.cjs`: a hidden window
 * loading the project's own Vite dev server) into compiler-shaped findings, so the existing
 * `parseCompilerErrors` / heal / Nay plumbing carries them like any other verify error.
 *
 * Codes (TS91xx, next to the web entry gate's TS9001-9003):
 *   errors   TS9101 blank page / app never mounted      TS9102 uncaught exception / Vite error overlay
 *            TS9103 console errors                       TS9104 page failed to load / renderer crashed
 *            TS9105 canvas undersized                    TS9106 main content collapsed
 *            TS9107 page mostly unstyled
 *   warnings TS9111 console warnings                     TS9112 some class names have no CSS rule
 *            TS9113 CSS classes defined but never used   TS9114 content short but present
 */

export interface RenderRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RenderCanvasMetric {
  el?: string;
  rect: RenderRect;
  visible?: boolean;
  attrWidth?: number;
  attrHeight?: number;
  parent?: RenderRect | null;
  chain?: Array<{ el?: string; rect: RenderRect; height?: string; minHeight?: string; position?: string; display?: string }>;
}

export interface RenderMetrics {
  viewport?: { width: number; height: number };
  scroll?: { width: number; height: number };
  textLength?: number;
  textSample?: string;
  visibleCount?: number;
  canvases?: RenderCanvasMetric[];
  mount?: { el?: string; childElementCount: number; textLength: number; isBody?: boolean } | null;
  largest?: { el?: string; rect: RenderRect } | null;
  styles?: {
    sheetCount: number;
    ruleCount?: number;
    sampled: number;
    unmatched: string[];
    unusedDefined?: string[];
    definedCount?: number;
  };
  overlay?: { message?: string; file?: string } | null;
}

/** What `workspace:renderCheck` returns. It never throws across IPC. */
export interface RenderCheckRaw {
  ok?: boolean;
  skipped?: boolean;
  reason?: string;
  url?: string;
  viewport?: { width: number; height: number };
  durationMs?: number;
  console?: Array<{ level: 'error' | 'warning'; message: string; source?: string; line?: number }>;
  pageErrors?: Array<{ message: string; source?: string; line?: number }>;
  loadFailures?: Array<{ code: number; description?: string; url?: string; mainFrame?: boolean }>;
  crashed?: boolean;
  blockedExternalRequests?: number;
  metrics?: RenderMetrics | null;
  screenshotPath?: string;
  screenshotRel?: string;
}

export interface RenderIssue {
  file?: string;
  code: string;
  message: string;
}

export interface RenderEvaluation {
  /** False only when a real finding failed. A skipped check (no vite, timeout, server down) is ok. */
  ok: boolean;
  skipped: boolean;
  /** Every finding as one line: `error TS9105: …` then `warning TS9112: …`. */
  findings: string[];
  errors: RenderIssue[];
  warnings: RenderIssue[];
  /** Compiler-shaped error lines (`file(1,1): error TS9105: …`) for the verify output. Empty when ok. */
  verifyText: string;
  /** Warnings as text for the Reviewer prompt. Empty when there are none. */
  notes: string;
  /** One run-log line: `render check: canvas 1280x150 (19% of viewport)`. */
  summary: string;
  screenshotPath?: string;
}

export interface RenderEvalOptions {
  /** Workspace-relative source files, used to name the likely App / stylesheet file. */
  files?: string[];
}

const CANVAS_MIN_SHARE = 0.35;
const COLLAPSED_MIN_SHARE = 0.2;
const UNSTYLED_RATIO = 0.6;
const UNSTYLED_MIN_SAMPLE = 5;
const MAX_LISTED = 5;
const MAIN_TEXT_LIMIT = 600;
const FALLBACK_APP_FILE = 'src/App.tsx';

function pct(share: number): number {
  return Math.round(share * 100);
}

function clip(text: string, max: number): string {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** `http://127.0.0.1:5000/src/App.tsx?t=1` -> `src/App.tsx`. '' for node_modules / non-source URLs. */
export function sourceFileFromUrl(source: string | undefined): string {
  let s = (source || '').trim();
  if (!s) return '';
  s = s.replace(/^[a-z]+:\/\/[^/]+/i, '').split(/[?#]/)[0].replace(/\\/g, '/');
  s = s.replace(/^\/+/, '');
  if (!s || /(?:^|\/)(?:node_modules|@vite|@fs|@id|@react-refresh)(?:\/|$)/.test(s)) return '';
  return /\.(?:[cm]?[jt]sx?|vue|svelte|css|scss|html)$/i.test(s) ? s : '';
}

function pickFile(files: string[] | undefined, kind: 'app' | 'style'): string | undefined {
  const list = (files || []).map(f => f.replace(/\\/g, '/').replace(/^\.\//, ''));
  if (kind === 'app') {
    const hit =
      list.find(f => /^src\/App\.(?:tsx|jsx|vue|svelte)$/i.test(f)) ||
      list.find(f => /(?:^|\/)App\.(?:tsx|jsx|vue|svelte)$/i.test(f));
    return hit || (list.length ? undefined : FALLBACK_APP_FILE);
  }
  return (
    list.find(f => /^src\/(?:index|styles?|globals?)\.css$/i.test(f)) ||
    list.find(f => /^(?:index|styles?)\.css$/i.test(f)) ||
    list.find(f => /^src\/App\.css$/i.test(f))
  );
}

const IGNORED_CONSOLE = [/\[vite\]\s*(?:failed to connect to websocket|server connection lost)/i, /ERR_BLOCKED_BY_CLIENT/];
/** The page can still be fine; the message has no URL so it cannot be pinned on a source file. */
const SOFT_CONSOLE_ERROR = [/^Failed to load resource\b/i];
/** The check window may not get a GPU context: an environment limit, not a project bug. */
const ENVIRONMENT_ERROR = [/\bWebGL\b.*\b(?:context|not supported|unavailable|disabled)\b/i, /Error creating WebGL context/i];

function dedupeMessages(messages: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of messages) {
    const key = clip(raw, 200).replace(/\d+/g, '#');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clip(raw, 240));
  }
  return out;
}

function listMore(items: string[], shown: number): string {
  return items.length > shown ? ` (+${items.length - shown} more)` : '';
}

function rectLabel(rect: RenderRect): string {
  return `${rect.width}x${rect.height}`;
}

function formatLine(issue: RenderIssue, level: 'error' | 'warning'): string {
  return `${issue.file || 'index.html'}(1,1): ${level} ${issue.code}: ${issue.message}`;
}

/**
 * Turn a raw render-check result into findings. Pure: no I/O, no clock.
 * A skipped or missing result is a pass (infrastructure never blocks a plan).
 */
export function evaluateRenderCheck(raw: RenderCheckRaw | null | undefined, options: RenderEvalOptions = {}): RenderEvaluation {
  const empty = (summary: string, skipped: boolean): RenderEvaluation => ({
    ok: true,
    skipped,
    findings: [],
    errors: [],
    warnings: [],
    verifyText: '',
    notes: '',
    summary
  });
  if (!raw || typeof raw !== 'object') return empty('render check skipped: no result', true);
  if (raw.skipped || !raw.metrics) {
    const failedLoad = (raw.loadFailures || []).some(f => f.mainFrame !== false) || raw.crashed;
    if (raw.skipped || !failedLoad) {
      return empty(`render check skipped: ${clip(raw.reason || 'no measurements', 160)}`, true);
    }
  }

  const errors: RenderIssue[] = [];
  const warnings: RenderIssue[] = [];
  const metrics = raw.metrics || null;
  const vw = metrics?.viewport?.width || raw.viewport?.width || 1280;
  const vh = metrics?.viewport?.height || raw.viewport?.height || 800;
  const appFile = pickFile(options.files, 'app');
  const styleFile = pickFile(options.files, 'style');
  const summaryBits: string[] = [];

  // Page never loaded / renderer died.
  const mainFailures = (raw.loadFailures || []).filter(f => f.mainFrame !== false);
  if (raw.crashed || mainFailures.length) {
    const why = raw.crashed ? 'the renderer process crashed' : `${mainFailures[0].description || 'load failed'} (${mainFailures[0].code})`;
    errors.push({
      code: 'TS9104',
      message: `The page failed to load in the render check: ${why}. Fix the startup error so the dev server serves a working page.`
    });
    summaryBits.push(`page failed to load (${clip(why, 60)})`);
  }

  // Uncaught exceptions and the Vite error overlay.
  const overlay = metrics?.overlay;
  if (overlay && (overlay.message || overlay.file)) {
    const file = sourceFileFromUrl(overlay.file) || (overlay.file ? overlay.file.replace(/:\d+(?::\d+)?$/, '') : undefined);
    errors.push({
      file: file || undefined,
      code: 'TS9102',
      message: `Vite is showing its error overlay instead of the app: ${clip(overlay.message || overlay.file || '', 240)}`
    });
    summaryBits.push('Vite error overlay');
  }
  const uncaught = dedupeMessages((raw.pageErrors || []).map(e => e.message).filter(Boolean));
  const environmental = uncaught.filter(m => ENVIRONMENT_ERROR.some(re => re.test(m)));
  const realUncaught = uncaught.filter(m => !ENVIRONMENT_ERROR.some(re => re.test(m)));
  if (realUncaught.length) {
    const firstSource = (raw.pageErrors || []).map(e => sourceFileFromUrl(e.source)).find(Boolean);
    errors.push({
      file: firstSource || undefined,
      code: 'TS9102',
      message: `Uncaught exception while the page loaded: ${realUncaught.slice(0, MAX_LISTED).join(' | ')}${listMore(realUncaught, MAX_LISTED)}`
    });
    summaryBits.push(`${realUncaught.length} uncaught exception(s)`);
  }
  if (environmental.length) {
    warnings.push({
      code: 'TS9111',
      message: `WebGL was not available in the headless check window (${clip(environmental[0], 120)}); canvas contents were not verified.`
    });
  }

  // Console errors / warnings, minus what the uncaught list already says.
  const uncaughtSet = new Set((raw.pageErrors || []).map(e => clip(e.message, 240)));
  const consoleEntries = (raw.console || []).filter(
    c => c && c.message && !IGNORED_CONSOLE.some(re => re.test(c.message)) && !uncaughtSet.has(clip(c.message, 240))
  );
  const hardErrors = consoleEntries.filter(
    c =>
      c.level === 'error' &&
      !SOFT_CONSOLE_ERROR.some(re => re.test(c.message)) &&
      !ENVIRONMENT_ERROR.some(re => re.test(c.message))
  );
  const softErrors = consoleEntries.filter(c => c.level === 'error' && SOFT_CONSOLE_ERROR.some(re => re.test(c.message)));
  const consoleWarnings = consoleEntries.filter(c => c.level === 'warning');
  const hardMessages = dedupeMessages(hardErrors.map(c => c.message));
  if (hardMessages.length) {
    const src = hardErrors.map(c => sourceFileFromUrl(c.source)).find(Boolean);
    errors.push({
      file: src || undefined,
      code: 'TS9103',
      message: `Console error(s) while the page loaded: ${hardMessages.slice(0, MAX_LISTED).join(' | ')}${listMore(hardMessages, MAX_LISTED)}`
    });
    summaryBits.push(`${hardMessages.length} console error(s)`);
  }
  const softMessages = dedupeMessages([...softErrors, ...consoleWarnings].map(c => c.message));
  if (softMessages.length) {
    warnings.push({
      code: 'TS9111',
      message: `Console warning(s): ${softMessages.slice(0, 3).join(' | ')}${listMore(softMessages, 3)}`
    });
  }

  if (metrics) {
    const textLength = metrics.textLength || 0;
    const visibleCount = metrics.visibleCount || 0;
    const canvases = (metrics.canvases || []).filter(c => c.visible !== false && c.rect.width > 0 && c.rect.height > 0);
    const mainCanvas = canvases.slice().sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)[0];
    const share = mainCanvas ? (mainCanvas.rect.width * mainCanvas.rect.height) / (vw * vh) : 0;
    const canvasFills = share >= CANVAS_MIN_SHARE;
    let layoutReported = false;

    // Blank page, or the app never replaced the placeholder in the mount element.
    const mount = metrics.mount;
    const neverMounted = !!mount && !mount.isBody && mount.childElementCount === 0;
    if (!canvasFills && !errors.some(e => e.code === 'TS9102' || e.code === 'TS9104')) {
      if (neverMounted) {
        errors.push({
          file: appFile,
          code: 'TS9101',
          message: `The app never mounted: ${mount?.el || '#root'} has no children${
            mount?.textLength ? ` (it still shows "${clip(metrics.textSample || '', 40)}")` : ''
          }. Check that the entry file calls createRoot(...).render(<App />) and that App returns visible content.`
        });
        summaryBits.push('app never mounted');
        layoutReported = true;
      } else if (textLength === 0 && visibleCount <= 1) {
        errors.push({
          file: appFile,
          code: 'TS9101',
          message:
            'The page is blank: no visible text and no canvas that fills the viewport. Render something visible (a title, the game board, a canvas with a definite size).'
        });
        summaryBits.push('blank page');
        layoutReported = true;
      }
    }

    // A canvas that is the page's main content but only a strip of the viewport.
    if (mainCanvas && !canvasFills) {
      const isMain = textLength < MAIN_TEXT_LIMIT;
      const strip = mainCanvas.rect.height < vh * CANVAS_MIN_SHARE || mainCanvas.rect.width < vw * CANVAS_MIN_SHARE;
      if (isMain && strip) {
        const parent = mainCanvas.parent || mainCanvas.chain?.[0]?.rect;
        const parentNote = parent ? ` Its parent is ${rectLabel(parent)}` : '';
        const heightNote = mainCanvas.chain?.[0]?.height ? ` (computed height ${mainCanvas.chain[0].height})` : '';
        errors.push({
          file: appFile,
          code: 'TS9105',
          message: `The canvas is ${rectLabel(mainCanvas.rect)} in a ${vw}x${vh} viewport (${pct(share)}% of it) and it is the page's main content; its parent has no definite height, so height: 100% collapses to the 300x150 default. Give the canvas container height: 100vh (or position: fixed; inset: 0) instead of relying on min-height or a percentage.${parentNote ? `${parentNote}${heightNote}.` : ''}`
        });
        summaryBits.push(`canvas ${rectLabel(mainCanvas.rect)} (${pct(share)}% of viewport)`);
        layoutReported = true;
      } else {
        warnings.push({
          code: 'TS9114',
          message: `The largest canvas is ${rectLabel(mainCanvas.rect)} (${pct(share)}% of the ${vw}x${vh} viewport). Fine if intended; otherwise check its container's height.`
        });
      }
    }

    // Main content collapsed.
    const largest = metrics.largest;
    if (!layoutReported && largest && largest.rect.height < vh * COLLAPSED_MIN_SHARE && !canvasFills) {
      const detail = `The largest element (${largest.el || 'root child'}) is ${rectLabel(largest.rect)} in a ${vw}x${vh} viewport, under ${pct(COLLAPSED_MIN_SHARE)}% of the viewport height.`;
      if (textLength < 80 && !mainCanvas) {
        errors.push({
          file: appFile,
          code: 'TS9106',
          message: `${detail} The page content has collapsed: give the root/app container a real height (min-height: 100vh and its children flex: 1) and check the layout CSS.`
        });
        summaryBits.push(`content collapsed (${rectLabel(largest.rect)})`);
      } else {
        warnings.push({ code: 'TS9114', message: `${detail} Fine for a small widget; otherwise check the layout.` });
      }
    }

    // Class names without any CSS rule.
    const styles = metrics.styles;
    if (styles && styles.sheetCount > 0) {
      const unmatched = styles.unmatched || [];
      if (unmatched.length) {
        const ratio = styles.sampled > 0 ? unmatched.length / styles.sampled : 0;
        const list = `${unmatched.slice(0, 8).map(c => `.${c}`).join(', ')}${listMore(unmatched, 8)}`;
        if (styles.sampled >= UNSTYLED_MIN_SAMPLE && ratio > UNSTYLED_RATIO) {
          errors.push({
            file: styleFile,
            code: 'TS9107',
            message: `${unmatched.length} of ${styles.sampled} sampled class names have no CSS rule in any stylesheet (${list}), so the page is effectively unstyled. Define the classes the components use, or use the classes the stylesheet already defines.`
          });
          summaryBits.push(`${pct(ratio)}% of classes unstyled`);
        } else {
          warnings.push({
            code: 'TS9112',
            message: `${unmatched.length} of ${styles.sampled} sampled class names have no CSS rule: ${list}.`
          });
        }
      }
      const unused = styles.unusedDefined || [];
      if (unused.length >= 2) {
        warnings.push({
          code: 'TS9113',
          message: `The stylesheet defines classes no element uses: ${unused.slice(0, 8).map(c => `.${c}`).join(', ')}. Two parallel layout systems (inline styles vs. these classes) often means the intended layout is not applied.`
        });
      }
    }

    if (!summaryBits.length) {
      const mainBits = mainCanvas ? `canvas ${rectLabel(mainCanvas.rect)} (${pct(share)}% of viewport), ` : '';
      summaryBits.push(`ok (${mainBits}${textLength} chars of text${warnings.length ? `, ${warnings.length} warning(s)` : ''})`);
    }
  } else if (!summaryBits.length) {
    summaryBits.push('no measurements');
  }

  const ok = errors.length === 0;
  const findings = [
    ...errors.map(e => `error ${e.code}: ${e.message}`),
    ...warnings.map(w => `warning ${w.code}: ${w.message}`)
  ];
  return {
    ok,
    skipped: false,
    findings,
    errors,
    warnings,
    verifyText: errors.map(e => formatLine(e, 'error')).join('\n'),
    notes: warnings.length ? warnings.map(w => `- ${w.code}: ${w.message}`).join('\n') : '',
    summary: `render check: ${summaryBits.join('; ')}`,
    ...(raw.screenshotPath ? { screenshotPath: raw.screenshotPath } : {})
  };
}

/** Prompt addendum for a compile-clean page whose render check failed (TS9101-TS9107). */
export const RENDER_HEAL_HINT =
  'The project compiles, but loading it in a real browser window shows the problem described in the TS91xx errors. Fix the layout or runtime error in the named file: give the app/canvas container a definite height (for example height: 100vh, or position: fixed; inset: 0), make components use the stylesheet classes that exist (or define the missing ones), and never rely on height: 100% inside a parent that only has min-height.';

/** Files whose change can alter what renders. */
export function isRenderRelevantFile(path: string): boolean {
  return /\.(?:tsx|jsx|vue|svelte|css|scss|html)$/i.test((path || '').trim());
}

/** True when the verify output carries a render-check error. */
export function hasRenderCheckErrors(output: string): boolean {
  return /\berror TS91(?:0[1-7])\b/.test(output || '');
}
