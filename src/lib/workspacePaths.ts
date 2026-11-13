/**
 * One path identity for every file the Conductor plans, dispatches, writes, reviews and heals.
 *
 * Planners, Coders and Reviewers name the same file several ways: `types.ts`, `game/types.ts`,
 * `src/game/types.ts`, `.\src\game\types.ts`, `src/Game/Types.ts`. Every consumer used to
 * normalise on its own, so each fix round found a new hole. This module is the single place that
 * decides which workspace file a written name means. Pure functions only (no fs, no electron).
 *
 * Rules (`createPathResolver(...).resolve`):
 * 1. Slashes, `./`, surrounding quotes/backticks and whitespace are normalised.
 * 2. `..` segments and absolute paths outside the workspace root are rejected (`path: null`).
 * 3. An exact, case-insensitive match to a known or existing path returns that path's casing.
 * 4. A bare root project file (`package.json`, `tsconfig*.json`, `*.config.*`, `index.html`, ...) is
 *    never mapped into a sub-folder.
 * 5. Otherwise a `/`-boundary suffix match picks the path: known (plan/owned) files first, then
 *    existing files; a tie is ambiguous (unchanged and reported), or the shortest when asked.
 */

export interface PathContext {
  /** Existing repo-relative workspace files. */
  workspaceFiles?: string[];
  /** Files the plan/worker is known to target or own (may not exist on disk yet). */
  knownFiles?: string[];
  /** Absolute workspace root. Absolute inputs inside it become relative; others are rejected. */
  workspaceRoot?: string;
  /** What to do when several files match equally. `keep` leaves the name and reports it. */
  onAmbiguous?: 'keep' | 'shortest';
}

export interface ResolveOptions {
  /** Texts that may name the intended candidate by a folder path. Evaluated in order, lazily. */
  hintTexts?: Array<string | (() => string)>;
  onAmbiguous?: 'keep' | 'shortest';
}

export type PathResolutionKind = 'exact' | 'suffix' | 'unchanged' | 'ambiguous' | 'rejected';

export interface PathResolution {
  input: string;
  /** Canonical path; the normalised input when unchanged/ambiguous; null when rejected. */
  path: string | null;
  kind: PathResolutionKind;
  /** Competing files when `kind` is `ambiguous`. */
  candidates: string[];
}

export interface PathMention {
  start: number;
  end: number;
  /** Normalised path as written. */
  path: string;
  backticked: boolean;
}

export interface PathResolver {
  resolve(raw: string | undefined | null, opts?: ResolveOptions): PathResolution;
  /** Rewrite file mentions in prose to their canonical paths. */
  rewriteText(text: string): { text: string; rewrites: Array<{ from: string; to: string }> };
}

const SKIP_DIRS = new Set(['node_modules', '.git', '.localagents', 'dist', 'build']);

/** Project-level files that legitimately sit at the root and repeat in sub-packages. */
export const ROOT_PROJECT_FILE =
  /^(package(-lock)?\.json|tsconfig(\.[\w-]+)?\.json|[\w-]+\.config\.[cm]?[jt]s|index\.html|readme\.md|license(\.md)?|\.gitignore|\.env(\.[\w-]+)?|\.eslintrc(\.\w+)?|\.prettierrc(\.\w+)?|requirements\.txt|pyproject\.toml|cargo\.toml|go\.mod|makefile|dockerfile)$/i;

export function isRootProjectFile(path: string): boolean {
  const p = normalizePathText(path);
  return !!p && !p.includes('/') && ROOT_PROJECT_FILE.test(p);
}

/** Forward slashes, no `./`, no wrapping quotes/backticks, no doubled or trailing slash. */
export function normalizePathText(raw: string | undefined | null): string {
  let p = String(raw ?? '').trim();
  while (p.length >= 2 && /^["'`]/.test(p) && p[p.length - 1] === p[0]) p = p.slice(1, -1).trim();
  p = p.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/(?:\.\/)+/g, '/');
  while (p.startsWith('./')) p = p.slice(2);
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return p === '.' ? '' : p;
}

/** Identity key: two spellings of one file share it. */
export function pathKey(raw: string | undefined | null): string {
  return normalizePathText(raw).toLowerCase();
}

function isAbsolutePath(p: string): boolean {
  return p.startsWith('/') || /^[a-z]:/i.test(p);
}

// ---------------------------------------------------------------------------------------------
// File mentions in prose
// ---------------------------------------------------------------------------------------------

const SCAN_FILE_EXTS =
  'js|jsx|ts|tsx|mjs|cjs|css|scss|html|json|md|py|rs|go|java|cs|php|rb|vue|svelte|yml|yaml|toml|svg|txt|glsl|wgsl|sql';
const SCAN_EXT_SET = new Set(SCAN_FILE_EXTS.split('|'));
const SCRIPT_LIB_EXT = /^(?:js|mjs|cjs)$/i;
/** Library / runtime names that read like `Three.js` in prose. */
const LIBRARY_BASES = new Set([
  'three', 'node', 'vue', 'next', 'nuxt', 'd3', 'chart', 'react', 'angular', 'ember', 'express', 'alpine',
  'backbone', 'pixi', 'babylon', 'phaser', 'p5', 'anime', 'jquery', 'gsap', 'lodash', 'deno', 'bun', 'konva',
  'fabric', 'leaflet', 'cannon', 'matter', 'tween', 'svelte', 'solid', 'preact', 'electron', 'nest', 'koa'
]);

function isLibraryNameToken(path: string, backticked: boolean): boolean {
  if (path.includes('/')) return false;
  const dot = path.lastIndexOf('.');
  if (dot <= 0) return false;
  const base = path.slice(0, dot).toLowerCase();
  const ext = path.slice(dot + 1);
  const capitalised = /^[A-Z]/.test(path);
  const named = LIBRARY_BASES.has(base) && SCRIPT_LIB_EXT.test(ext);
  if (backticked) return named && capitalised;
  return named || (capitalised && SCRIPT_LIB_EXT.test(ext));
}

function acceptScannedPath(path: string, backticked: boolean): boolean {
  if (!path || path.length > 200 || /\s/.test(path) || /:\/\//.test(path)) return false;
  if (path.startsWith('/') || /^[a-z]:/i.test(path)) return false;
  if (path.split('/').some(seg => seg === '..' || seg === '' || seg === 'node_modules')) return false;
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (path.lastIndexOf('.') <= 0 || !SCAN_EXT_SET.has(ext)) return false;
  return !isLibraryNameToken(path, backticked);
}

/**
 * File-looking tokens in free text with their ranges. Never starts mid-path (`src/App.tsx` does not
 * also yield `App.tsx`) and never reads inside a URL. Backticked tokens come first, then prose ones;
 * a token inside backticks can appear in both passes.
 */
export function scanPathMentions(text: string): PathMention[] {
  const found: PathMention[] = [];
  const masked = (text || '').replace(/\b(?:https?:\/\/|www\.)\S+/gi, m => ' '.repeat(m.length));
  for (const m of masked.matchAll(/`([^`\n]+)`/g)) {
    const p = normalizePathText(m[1]);
    const start = (m.index ?? 0) + 1;
    if (acceptScannedPath(p, true)) found.push({ start, end: start + m[1].length, path: p, backticked: true });
  }
  const prose = new RegExp(
    `(?<![\\w./\\\\@:-])((?:\\.?/)?(?:[\\w.-]+/)*[\\w-][\\w.-]*\\.(?:${SCAN_FILE_EXTS}))(?![\\w-]|\\.\\w)`,
    'g'
  );
  for (const m of masked.matchAll(prose)) {
    const p = normalizePathText(m[1]);
    const start = m.index ?? 0;
    if (acceptScannedPath(p, false)) found.push({ start, end: start + m[1].length, path: p, backticked: false });
  }
  return found;
}

export function scanTextForFilePaths(text: string): string[] {
  return scanPathMentions(text).map(m => m.path);
}

/**
 * True when `text` names `candidate` by a folder path (`game/types.ts`, `src/game/types.ts`);
 * a bare basename does not count, so it cannot settle which of several same-named files is meant.
 */
export function mentionsPath(text: string, candidate: string): boolean {
  const lower = pathKey(candidate);
  return scanTextForFilePaths(text).some(found => {
    const p = found.toLowerCase();
    return p.includes('/') && (p === lower || lower.endsWith(`/${p}`));
  });
}

// ---------------------------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------------------------

interface Entry {
  path: string;
  key: string;
  known: boolean;
  onDisk: boolean;
}

function baseOf(key: string): string {
  return key.slice(key.lastIndexOf('/') + 1);
}

function cleanListEntry(raw: string | undefined | null, root: string): string {
  let p = normalizePathText(raw);
  if (!p) return '';
  if (isAbsolutePath(p)) {
    const rel = relativeToRoot(p, root);
    if (rel === null) return '';
    p = rel;
  }
  if (p.split('/').some(seg => seg === '..')) return '';
  return p;
}

function relativeToRoot(p: string, root: string): string | null {
  if (!root) return null;
  const r = normalizePathText(root);
  if (!r) return null;
  const lower = p.toLowerCase();
  const rl = r.toLowerCase();
  if (lower === rl) return '';
  return lower.startsWith(`${rl}/`) ? p.slice(r.length + 1) : null;
}

/** Build a resolver over the workspace and known files. Cheap to reuse for many lookups. */
export function createPathResolver(ctx: PathContext = {}): PathResolver {
  const root = ctx.workspaceRoot || '';
  const byKey = new Map<string, Entry>();
  const byBase = new Map<string, Entry[]>();
  const add = (entry: Entry) => {
    byKey.set(entry.key, entry);
    const base = baseOf(entry.key);
    const list = byBase.get(base);
    if (list) list.push(entry);
    else byBase.set(base, [entry]);
  };

  for (const raw of ctx.workspaceFiles || []) {
    const p = cleanListEntry(raw, root);
    if (!p || byKey.has(p.toLowerCase())) continue;
    if (p.split('/').slice(0, -1).some(seg => SKIP_DIRS.has(seg.toLowerCase()))) continue;
    add({ path: p, key: p.toLowerCase(), known: false, onDisk: true });
  }
  const knownOnly: string[] = [];
  for (const raw of ctx.knownFiles || []) {
    const p = cleanListEntry(raw, root);
    if (!p) continue;
    const existing = byKey.get(p.toLowerCase());
    if (existing) existing.known = true;
    else knownOnly.push(p);
  }
  // A planned name that is only the tail of a longer path (`scene/constants.ts` beside
  // `src/scene/constants.ts`) is a spelling of that file, not a second file. Bare root project
  // files stay: a root `index.html` is a real target even when `src/index.html` exists.
  const knownKeys = new Set(knownOnly.map(p => p.toLowerCase()));
  const hasLongerTwin = (key: string): boolean => {
    for (const other of byBase.get(baseOf(key)) || []) {
      if (other.key.length > key.length && other.key.endsWith(`/${key}`)) return true;
    }
    for (const otherKey of knownKeys) {
      if (otherKey.length > key.length && otherKey.endsWith(`/${key}`)) return true;
    }
    return false;
  };
  const shadowedKnown: Array<{ key: string }> = [];
  for (const p of knownOnly) {
    const key = p.toLowerCase();
    if (byKey.has(key)) continue;
    if (!p.includes('/') && ROOT_PROJECT_FILE.test(p)) {
      add({ path: p, key, known: true, onDisk: false });
    } else if (hasLongerTwin(key)) {
      shadowedKnown.push({ key });
    } else {
      add({ path: p, key, known: true, onDisk: false });
    }
  }
  // The longer path inherits "known" from the spelling that named it.
  for (const { key } of shadowedKnown) {
    for (const other of byBase.get(baseOf(key)) || []) {
      if (other.key.endsWith(`/${key}`)) other.known = true;
    }
  }

  const evalHint = (hint: string | (() => string)): string => (typeof hint === 'function' ? hint() : hint);

  const resolve = (raw: string | undefined | null, opts?: ResolveOptions): PathResolution => {
    const input = String(raw ?? '');
    const reject = (): PathResolution => ({ input, path: null, kind: 'rejected', candidates: [] });
    let p = normalizePathText(raw);
    if (!p) return reject();
    if (isAbsolutePath(p)) {
      const rel = relativeToRoot(p, root);
      if (rel === null || !rel) return reject();
      p = rel;
    }
    if (p.split('/').some(seg => seg === '..')) return reject();
    const lower = p.toLowerCase();

    const hit = byKey.get(lower);
    if (hit) return { input, path: hit.path, kind: 'exact', candidates: [] };
    if (!p.includes('/') && ROOT_PROJECT_FILE.test(p)) return { input, path: p, kind: 'unchanged', candidates: [] };

    const raws = (byBase.get(baseOf(lower)) || []).filter(
      e => e.key.length > lower.length && e.key.endsWith(`/${lower}`)
    );
    // Two spellings of one file count once: keep the longer, remember it was known.
    const cands = raws
      .filter(c => !raws.some(o => o !== c && o.key.length > c.key.length && o.key.endsWith(`/${c.key}`)))
      .map(c => ({
        ...c,
        known: c.known || raws.some(o => o !== c && o.known && c.key.endsWith(`/${o.key}`))
      }));
    if (!cands.length) return { input, path: p, kind: 'unchanged', candidates: [] };

    const knownTier = cands.filter(c => c.known);
    let pool = knownTier.length ? knownTier : cands;
    if (pool.length > 1) {
      for (const hint of opts?.hintTexts || []) {
        const narrowed = pool.filter(c => mentionsPath(evalHint(hint), c.path));
        if (narrowed.length === 1) {
          pool = narrowed;
          break;
        }
      }
    }
    if (pool.length === 1) return { input, path: pool[0].path, kind: 'suffix', candidates: [] };
    if ((opts?.onAmbiguous ?? ctx.onAmbiguous) === 'shortest') {
      const shortest = [...pool].sort((a, b) => a.path.length - b.path.length)[0];
      return { input, path: shortest.path, kind: 'suffix', candidates: [] };
    }
    return { input, path: p, kind: 'ambiguous', candidates: pool.map(c => c.path) };
  };

  const rewriteText = (text: string): { text: string; rewrites: Array<{ from: string; to: string }> } => {
    const rewrites: Array<{ from: string; to: string }> = [];
    if (!text) return { text: text || '', rewrites };
    const mentions = scanPathMentions(text).sort((a, b) => a.start - b.start || b.end - a.end);
    let out = '';
    let cursor = 0;
    for (const m of mentions) {
      if (m.start < cursor) continue; // inside a token already handled
      const r = resolve(m.path);
      if ((r.kind !== 'exact' && r.kind !== 'suffix') || !r.path || r.path === m.path) continue;
      out += text.slice(cursor, m.start) + r.path;
      cursor = m.end;
      if (!rewrites.some(w => w.from === m.path && w.to === r.path)) rewrites.push({ from: m.path, to: r.path });
    }
    if (!rewrites.length) return { text, rewrites };
    return { text: out + text.slice(cursor), rewrites };
  };

  return { resolve, rewriteText };
}

/** The workspace file `raw` names, or the normalised name when it matches nothing; null when unsafe. */
export function canonicalizePath(raw: string | undefined | null, ctx: PathContext = {}): string | null {
  return createPathResolver(ctx).resolve(raw).path;
}

/** `canonicalizePath` over a list: unsafe entries are dropped, spellings of one file collapse to one. */
export function canonicalizePaths(list: Array<string | undefined | null>, ctx: PathContext = {}): string[] {
  const resolver = createPathResolver(ctx);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list || []) {
    const p = resolver.resolve(raw).path;
    if (!p) continue;
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/** Rewrite file mentions inside prose (not inside URLs) to their canonical paths. */
export function canonicalizeTextMentions(text: string, ctx: PathContext = {}): string {
  return createPathResolver(ctx).rewriteText(text).text;
}

/**
 * The assigned file `candidate` is a case/slash/suffix twin of (`game/types.ts` for the assigned
 * `src/game/types.ts`), or null when it names no assigned file or only spells it the same way.
 */
export function assignedTwinPath(assigned: string[], candidate: string): string | null {
  if (!assigned?.length || !candidate) return null;
  const r = createPathResolver({ knownFiles: assigned }).resolve(candidate);
  if ((r.kind !== 'exact' && r.kind !== 'suffix') || !r.path) return null;
  return r.path === candidate ? null : r.path;
}

/**
 * Existing owned file a new path is a `/`-boundary tail of (`game/types.ts` → `src/game/types.ts`),
 * for a rejection message. Exact matches, root project files and unrelated names give null.
 */
export function ownedTailTwin(owned: string[], candidate: string): string | null {
  const rel = (candidate || '').replace(/\\/g, '/').replace(/^\.?\//, '');
  if (!rel) return null;
  const r = createPathResolver({ knownFiles: owned || [], onAmbiguous: 'shortest' }).resolve(rel);
  return r.kind === 'suffix' ? r.path : null;
}

// ---------------------------------------------------------------------------------------------
// Parallel modules (`Board.tsx` beside `CheckersBoard.tsx`)
// ---------------------------------------------------------------------------------------------

function stemOf(path: string): string {
  const base = path.replace(/\\/g, '/').split('/').pop() || path;
  const name = base.replace(/\.[^.]+$/, '');
  const prefix = /^(checkers|game|app)/i.exec(name);
  const next = prefix ? name.charAt(prefix[0].length) : '';
  const stripPrefix = !!prefix && (/[^A-Za-z0-9]/.test(next) || (/[A-Z]/.test(next) && name !== name.toUpperCase()));
  return (stripPrefix ? name.slice(prefix![0].length) : name).toLowerCase().replace(/[^a-z0-9]/g, '');
}

const GENERIC_STEMS = new Set([
  'index',
  'main',
  'mod',
  'types',
  'test',
  'tests',
  'util',
  'utils',
  'config',
  'common',
  'contract',
  'app'
]);

/** The owned file a worker's invented parallel module (`Board.tsx` vs `CheckersBoard.tsx`) duplicates. */
export function parallelModulePath(owned: string[], candidate: string): string | null {
  const rel = (candidate || '').replace(/\\/g, '/');
  if (!rel) return null;
  const cStem = stemOf(rel);
  if (cStem.length < 4 || GENERIC_STEMS.has(cStem)) return null;
  const isHtml = (p: string) => /\.html?$/i.test(p);
  const candIsHtml = isHtml(rel);
  for (const o of owned) {
    const ownedRel = o.replace(/\\/g, '/');
    if (ownedRel.toLowerCase() === rel.toLowerCase()) return null;
    if (candIsHtml !== isHtml(ownedRel)) continue;
    const oStem = stemOf(ownedRel);
    if (oStem.length >= 4 && !GENERIC_STEMS.has(oStem) && oStem === cStem) return ownedRel;
  }
  return null;
}
