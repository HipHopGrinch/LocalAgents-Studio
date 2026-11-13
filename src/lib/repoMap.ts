/** Cheap workspace map: paths plus shallow export/function names. Not a language server. */

export interface RepoSymbol {
  file: string;
  name: string;
}

export interface RepoMap {
  files: string[];
  symbols: RepoSymbol[];
  builtAt: number;
}

const CODE_EXT = /\.(tsx?|jsx?|mjs|cjs|py|rs|go|vue|svelte)$/i;

const SKIP_DIR_EXACT = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', '.localagents', '.git']);

/** Dependency, build, VCS, and dot directories are not source. `release*` covers release-NNN. */
export function isSkippedRepoDir(name: string): boolean {
  const n = (name || '').trim();
  if (!n || n === '.' || n === '..') return n === '.' || n === '..';
  if (n.startsWith('.')) return true;
  if (SKIP_DIR_EXACT.has(n.toLowerCase())) return true;
  return /^release/i.test(n);
}

/** True when a parent directory of this relative path should not be mapped. */
export function pathHasSkippedRepoDir(relPath: string): boolean {
  const parts = (relPath || '').split(/[\\/]/).filter(Boolean);
  const dirs = parts.length > 1 ? parts.slice(0, -1) : [];
  return dirs.some(seg => isSkippedRepoDir(seg));
}
const EXPORT_RE =
  /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|type|interface|enum)\s+([A-Za-z0-9_]+)/gm;
const FN_RE = /^\s*(?:async\s+)?function\s+([A-Za-z0-9_]+)/gm;
const PY_RE = /^\s*def\s+([A-Za-z0-9_]+)/gm;

function rel(root: string, abs: string): string {
  const n = abs.replace(/\\/g, '/');
  const r = root.replace(/\\/g, '/').replace(/\/$/, '');
  return n.toLowerCase().startsWith(r.toLowerCase()) ? n.slice(r.length).replace(/^\//, '') : n;
}

export function extractSymbols(relPath: string, content: string): RepoSymbol[] {
  const out: RepoSymbol[] = [];
  const seen = new Set<string>();
  const take = (name: string) => {
    if (!name || seen.has(name) || out.length >= 12) return;
    seen.add(name);
    out.push({ file: relPath, name });
  };
  let m: RegExpExecArray | null;
  const exp = new RegExp(EXPORT_RE.source, 'gm');
  while ((m = exp.exec(content)) && out.length < 12) take(m[1]);
  const fn = new RegExp(FN_RE.source, 'gm');
  while ((m = fn.exec(content)) && out.length < 12) take(m[1]);
  const py = new RegExp(PY_RE.source, 'gm');
  while ((m = py.exec(content)) && out.length < 12) take(m[1]);
  return out;
}

const SKIP_SOURCE_FILE = /\.(png|jpe?g|gif|webp|ico|exe|dll|zip|woff2?|ttf|eot|mp[34]|wav|pdf|map|lock)$/i;

/** Every text file under `src` when that folder exists, otherwise the project tree. Root entry files are included with `src`. */
export async function listSourceFolderFiles(root: string): Promise<string[]> {
  if (!root || !window.electronAPI?.readDir) return [];
  const files: string[] = [];
  const seen = new Set<string>();
  const push = (abs: string) => {
    const r = rel(root, abs);
    if (!r || seen.has(r.toLowerCase()) || SKIP_SOURCE_FILE.test(r) || pathHasSkippedRepoDir(r)) return;
    seen.add(r.toLowerCase());
    files.push(r);
  };
  const walk = async (dir: string, depth: number) => {
    if (depth > 8 || files.length >= 200) return;
    let entries: { name: string; path: string; isDirectory: boolean }[] = [];
    try {
      const res = await window.electronAPI.readDir(dir);
      if (Array.isArray(res)) entries = res;
    } catch {
      return;
    }
    for (const ent of entries) {
      if (files.length >= 200) return;
      if (ent.isDirectory) {
        if (!isSkippedRepoDir(ent.name)) await walk(ent.path, depth + 1);
        continue;
      }
      push(ent.path);
    }
  };
  const sep = root.includes('\\') ? '\\' : '/';
  const srcDir = `${root.replace(/[\\/]+$/, '')}${sep}src`;
  let hasSrc = false;
  try {
    const probe = await window.electronAPI.readDir(srcDir);
    hasSrc = Array.isArray(probe);
  } catch {
    hasSrc = false;
  }
  if (hasSrc) {
    await walk(srcDir, 0);
    let rootEntries: { name: string; path: string; isDirectory: boolean }[] = [];
    try {
      const res = await window.electronAPI.readDir(root);
      if (Array.isArray(res)) rootEntries = res;
    } catch {
      rootEntries = [];
    }
    for (const ent of rootEntries) {
      if (!ent.isDirectory) push(ent.path);
    }
  } else {
    await walk(root, 0);
  }
  files.sort();
  return files;
}

/** Every file under the workspace (paths only, no reads), skipping dependency, build and dot folders. */
export async function listWorkspaceFiles(root: string, maxFiles = 2000): Promise<string[]> {
  if (!root || !window.electronAPI?.readDir) return [];
  const files: string[] = [];
  const walk = async (dir: string, depth: number) => {
    if (depth > 10 || files.length >= maxFiles) return;
    let entries: { name: string; path: string; isDirectory: boolean }[] = [];
    try {
      const res = await window.electronAPI.readDir(dir);
      if (Array.isArray(res)) entries = res;
    } catch {
      return;
    }
    for (const ent of entries) {
      if (files.length >= maxFiles) return;
      if (ent.isDirectory) {
        if (!isSkippedRepoDir(ent.name)) await walk(ent.path, depth + 1);
        continue;
      }
      const r = rel(root, ent.path);
      if (r && !pathHasSkippedRepoDir(r)) files.push(r);
    }
  };
  await walk(root, 0);
  files.sort();
  return files;
}

export async function buildRepoMap(root: string): Promise<RepoMap> {
  const files: string[] = [];
  const symbols: RepoSymbol[] = [];
  if (!root || !window.electronAPI?.readDir) {
    return { files, symbols, builtAt: Date.now() };
  }

  const walk = async (dir: string, depth: number) => {
    if (depth > 5 || files.length >= 350) return;
    let entries: { name: string; path: string; isDirectory: boolean }[] = [];
    try {
      const res = await window.electronAPI.readDir(dir);
      if (Array.isArray(res)) entries = res;
    } catch {
      return;
    }
    for (const ent of entries) {
      if (files.length >= 350) return;
      if (ent.isDirectory) {
        if (isSkippedRepoDir(ent.name)) continue;
        await walk(ent.path, depth + 1);
        continue;
      }
      const r = rel(root, ent.path);
      if (!r || r.startsWith('.') || pathHasSkippedRepoDir(r)) continue;
      files.push(r);
      if (!CODE_EXT.test(r) || symbols.length > 180 || files.filter(f => CODE_EXT.test(f)).length > 60) continue;
      try {
        const file = await window.electronAPI.readFile(ent.path);
        if (file.content) symbols.push(...extractSymbols(r, file.content.slice(0, 12000)));
      } catch {
        /* skip unreadable */
      }
    }
  };

  await walk(root, 0);
  files.sort();
  return { files, symbols, builtAt: Date.now() };
}

function hasWord(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(text);
}

function taskTokens(taskText: string): string[] {
  return (taskText || '').toLowerCase().match(/[a-z0-9_./-]{3,}/g) || [];
}

/**
 * Files that match the task, best first. Score is basename/path token hits plus symbol hits.
 * Dependency and build paths never rank. Default limit is 8.
 */
export function relevantFilesForTask(map: RepoMap | null, taskText: string, limit = 8): string[] {
  if (!map?.files?.length || limit < 1) return [];
  const files = map.files.filter(f => f && !pathHasSkippedRepoDir(f));
  const tokens = new Set(taskTokens(taskText));
  const lowerTask = (taskText || '').toLowerCase();
  const scored = files.map(file => {
    let score = 0;
    const lower = file.toLowerCase().replace(/\\/g, '/');
    const base = lower.split('/').pop() || lower;
    const stem = base.replace(/\.[a-z0-9]+$/, '');
    if (base.length > 2 && hasWord(lowerTask, base)) score += 10;
    if (stem.length > 2 && (tokens.has(stem) || hasWord(lowerTask, stem))) score += 6;
    for (const tok of tokens) {
      if (tok.length >= 4 && tok !== base && tok !== stem && lower.includes(tok)) score += 2;
    }
    for (const sym of map.symbols) {
      if (sym.file.replace(/\\/g, '/') !== file.replace(/\\/g, '/')) continue;
      const name = sym.name.toLowerCase();
      if (name.length < 2) continue;
      if (tokens.has(name) || hasWord(lowerTask, name)) score += 5;
    }
    return { file, score };
  });
  scored.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
  return scored.filter(row => row.score > 0).slice(0, limit).map(row => row.file);
}

/** Drop the cached map. The caller rebuilds with {@link buildRepoMap} after writes. */
export function invalidateRepoMap(map: RepoMap | null): RepoMap | null {
  if (!map) return null;
  return { ...map, builtAt: 0 };
}

export function repoMapNeedsRebuild(map: RepoMap | null): boolean {
  return !map || !(map.builtAt > 0);
}

/** Tight models get the ranked files for this task, not the first paths the walk saw. */
export function formatRepoMap(
  map: RepoMap | null,
  tier: 'tight' | 'standard' | 'wide',
  focusText = ''
): string {
  if (!map || map.files.length === 0) return '';
  const sourceFiles = map.files.filter(f => f && !pathHasSkippedRepoDir(f));
  if (!sourceFiles.length) return '';
  if (tier === 'tight') {
    const ranked = relevantFilesForTask({ ...map, files: sourceFiles }, focusText, 8);
    const paths = (ranked.length ? ranked : sourceFiles.slice(0, 8)).slice(0, 8);
    const lines = paths.map(f => {
      const sym = map.symbols.filter(s => s.file === f).slice(0, 4);
      return sym.length ? `${f} — ${sym.map(s => s.name).join(', ')}` : f;
    });
    return `REPO MAP (tight — relevant files):\n${lines.join('\n')}`;
  }
  const cap = tier === 'wide' ? 180 : 80;
  const pathBlock = sourceFiles.slice(0, cap).join('\n');
  const byFile = new Map<string, string[]>();
  for (const s of map.symbols) {
    if (pathHasSkippedRepoDir(s.file)) continue;
    const list = byFile.get(s.file) || [];
    if (list.length < 6) list.push(s.name);
    byFile.set(s.file, list);
  }
  const symLines = [...byFile.entries()]
    .slice(0, tier === 'wide' ? 80 : 30)
    .map(([f, names]) => `${f}: ${names.join(', ')}`);
  return `REPO MAP:\n${pathBlock}\n\nSYMBOLS:\n${symLines.join('\n')}`;
}

export interface DeclarationBlock {
  name: string;
  kind: 'interface' | 'type' | 'class' | 'enum' | 'function' | 'const';
  exported: boolean;
  /** Interfaces, types and enums keep their body; functions, classes and consts keep the signature only. */
  text: string;
}

const DECL_LINE_RE =
  /^(export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(interface|type|class|enum|function\*?|const|let|var)\s+([A-Za-z_$][\w$]*)/;

function braceDelta(line: string): number {
  const code = line.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '').replace(/\/\/.*$/, '');
  let d = 0;
  for (const ch of code) {
    if (ch === '{') d += 1;
    else if (ch === '}') d -= 1;
  }
  return d;
}

function parenDelta(line: string): number {
  let d = 0;
  for (const ch of line) {
    if (ch === '(') d += 1;
    else if (ch === ')') d -= 1;
  }
  return d;
}

/** First `{` at paren depth 0 that opens a body (not an object type after `:`, `|`, `&`, `<`, `,`). */
function bodyBraceIndex(sig: string): number {
  let depth = 0;
  for (let i = 0; i < sig.length; i++) {
    const ch = sig[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === '{' && depth === 0) {
      const prev = sig.slice(0, i).trimEnd().slice(-1);
      if (!prev || !':|&<,'.includes(prev)) return i;
    }
  }
  return -1;
}

function bracedBlock(lines: string[], start: number, maxChars: number): string {
  const out: string[] = [];
  let depth = 0;
  let seenOpen = false;
  let size = 0;
  for (let i = start; i < lines.length && out.length < 80; i++) {
    const line = lines[i];
    out.push(line);
    size += line.length + 1;
    const d = braceDelta(line);
    if (d !== 0 || /\{/.test(line)) seenOpen = true;
    depth += d;
    if (seenOpen && depth <= 0) break;
    if (!seenOpen && /;\s*$/.test(line)) break;
    if (size > maxChars) {
      out.push('// …');
      break;
    }
  }
  return out.join('\n');
}

function signatureBlock(lines: string[], start: number, kind: 'function' | 'const' | 'class'): string {
  const out: string[] = [];
  let parens = 0;
  for (let i = start; i < lines.length && out.length < 8; i++) {
    const line = lines[i];
    out.push(line);
    parens += parenDelta(line);
    if (parens > 0) continue;
    if (/=>|\{\s*$|;\s*$/.test(line) || kind === 'class' || !/=\s*$|\(\s*$|,\s*$/.test(line)) break;
  }
  const joined = out.join('\n');
  if (kind === 'const') {
    const arrow = joined.indexOf('=>');
    const cut = arrow >= 0 ? `${joined.slice(0, arrow + 2)} …` : joined;
    return cut.length > 240 ? `${cut.slice(0, 237)}…` : cut.replace(/[;{]\s*$/, '').trimEnd();
  }
  const body = bodyBraceIndex(joined);
  const head = (body >= 0 ? joined.slice(0, body) : joined).trimEnd();
  return `${head} { … }`;
}

/**
 * Top-level (column 0) declarations of a TS/JS module. Not a parser: enough to show
 * props interfaces, exported types and component or function signatures to a model.
 */
export function scanTopLevelDeclarations(content: string, opts?: { maxBlockChars?: number }): DeclarationBlock[] {
  const maxBlock = opts?.maxBlockChars ?? 1400;
  const lines = (content || '').replace(/\r\n/g, '\n').split('\n');
  const blocks: DeclarationBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = DECL_LINE_RE.exec(lines[i]);
    if (!m) continue;
    const exported = !!m[1] || /^export\s+default\b/.test(lines[i]);
    const keyword = m[2].replace('*', '');
    const name = m[3];
    if (keyword === 'interface' || keyword === 'enum') {
      blocks.push({ name, kind: keyword, exported, text: bracedBlock(lines, i, maxBlock) });
    } else if (keyword === 'type') {
      let text: string;
      if (/[{;]/.test(lines[i])) {
        text = bracedBlock(lines, i, maxBlock);
      } else {
        const multi: string[] = [];
        for (let j = i; j < lines.length && multi.length < 12; j++) {
          multi.push(lines[j]);
          if (/;\s*$/.test(lines[j])) break;
        }
        text = multi.join('\n');
      }
      blocks.push({ name, kind: 'type', exported, text });
    } else if (keyword === 'class') {
      blocks.push({ name, kind: 'class', exported, text: signatureBlock(lines, i, 'class') });
    } else if (keyword === 'function') {
      blocks.push({ name, kind: 'function', exported, text: signatureBlock(lines, i, 'function') });
    } else {
      blocks.push({ name, kind: 'const', exported, text: signatureBlock(lines, i, 'const') });
    }
  }
  return blocks;
}

/** `export { A, B }`, `export * from './x'` and `export default Name` lines. */
export function scanExportStatements(content: string): string[] {
  const lines = (content || '').replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^export\s+default\s+[A-Za-z_$][\w$]*\s*;?\s*$/.test(line) || /^export\s+\*/.test(line)) {
      out.push(line.trim());
    } else if (/^export\s+(type\s+)?\{/.test(line)) {
      const parts = [line];
      for (let j = i + 1; !/\}/.test(parts[parts.length - 1]) && j < lines.length && parts.length < 8; j++) {
        parts.push(lines[j]);
      }
      out.push(parts.map(p => p.trim()).join(' ').replace(/\s+/g, ' '));
    }
  }
  return out;
}

const JS_TS_SOURCE = /\.(tsx?|jsx?|mjs|cjs)$/i;

/**
 * Pieces of a module's public surface, in source order: exported declarations, the
 * non-exported interfaces/types/enums those signatures name, then export statements.
 */
export function moduleExportParts(content: string): string[] {
  const blocks = scanTopLevelDeclarations(content);
  const exportedText = blocks.filter(b => b.exported).map(b => b.text).join('\n');
  const statements = scanExportStatements(content);
  if (!exportedText && !statements.length) return [];
  const wanted = (b: DeclarationBlock) => {
    if (b.exported) return true;
    if (b.kind !== 'interface' && b.kind !== 'type' && b.kind !== 'enum') return false;
    return new RegExp(`(^|[^\\w$])${b.name.replace(/\$/g, '\\$')}([^\\w$]|$)`).test(exportedText);
  };
  return [...blocks.filter(wanted).map(b => b.text), ...statements];
}

/**
 * Compact export summary of one module: exported declarations (props interfaces and
 * type bodies in full, functions/components as signatures) plus the non-exported
 * types those signatures name. Empty when the file exports nothing or is not TS/JS.
 */
export function summarizeModuleExports(path: string, content: string, maxChars = 900): string {
  if (!JS_TS_SOURCE.test(path || '')) return '';
  const parts = moduleExportParts(content);
  const kept: string[] = [];
  let size = 0;
  for (const part of parts) {
    const next = size + part.length + 1;
    if (kept.length && next > maxChars) continue;
    kept.push(kept.length === 0 && part.length > maxChars ? `${part.slice(0, Math.max(0, maxChars - 1))}…` : part);
    size = next;
  }
  return kept.join('\n');
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const ENTRY_STEMS = new Set(['app', 'main', 'index']);
const ENTRY_EXT = /\.(tsx?|jsx?|vue|svelte)$/i;
const NON_MODULE_FILE = /\.(test|spec|stories|config)\.[a-z0-9]+$/i;
const SUPPORT_DIR_RE = /(^|\/)(game|logic|engine|core|lib|utils|util|hooks|state|store|ai)(\/|$)/i;

function normRel(p: string): string {
  return (p || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

/** True for `App.tsx`, `main.tsx`, `index.*` — the files that wire every other module together. */
export function isEntryModulePath(path: string): boolean {
  const base = normRel(path).split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || !ENTRY_EXT.test(base)) return false;
  return ENTRY_STEMS.has(base.slice(0, dot).toLowerCase());
}

/**
 * Existing project files this task should integrate, best first (paths only, so the
 * caller reads contents for the top few). Score: named in the brief, same folder,
 * shared types, game/logic/hooks folders. An entry file ranks every module.
 */
export function rankExistingProjectFiles(opts: {
  taskPath: string;
  brief: string;
  paths: string[];
  excludePaths?: string[];
}): string[] {
  const taskPath = normRel(opts.taskPath);
  const taskLower = taskPath.toLowerCase();
  const taskDir = taskPath.includes('/') ? taskPath.slice(0, taskPath.lastIndexOf('/')) : '';
  const exclude = new Set((opts.excludePaths || []).map(p => normRel(p).toLowerCase()));
  const brief = opts.brief || '';
  const entry = isEntryModulePath(taskPath);
  const scored: Array<{ path: string; score: number }> = [];
  const seen = new Set<string>();
  for (const raw of opts.paths || []) {
    const path = normRel(raw);
    const key = path.toLowerCase();
    if (!path || seen.has(key) || key === taskLower || exclude.has(key)) continue;
    seen.add(key);
    if (!JS_TS_SOURCE.test(path) && !/\.(vue|svelte)$/i.test(path)) continue;
    if (NON_MODULE_FILE.test(path) || pathHasSkippedRepoDir(path)) continue;
    const base = path.split('/').pop() || path;
    const stem = base.slice(0, base.lastIndexOf('.') > 0 ? base.lastIndexOf('.') : base.length);
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    let score = 0;
    if (new RegExp(`(?<![\\w./-])${escapeRe(path)}(?![\\w-])`, 'i').test(brief)) score += 12;
    else if (new RegExp(`(?<![\\w-])${escapeRe(base)}(?![\\w-])`, 'i').test(brief)) score += 10;
    else if (stem.length >= 4 && new RegExp(`(?<![\\w-])${escapeRe(stem)}(?![\\w-])`, /[A-Z0-9]/.test(stem) ? '' : 'i').test(brief)) score += 7;
    if (dir === taskDir) score += 4;
    if (/(^|\/)types?(\/|$)/i.test(dir) || /^(types?|typings|interfaces|constants|config)$/i.test(stem)) score += 4;
    if (SUPPORT_DIR_RE.test(dir)) score += 2;
    if (/(^|\/)components?(\/|$)/i.test(dir)) score += 2;
    if (entry) score += 6;
    // Another top-level entry file (main.tsx next to App.tsx) exports nothing to integrate.
    if (entry && isEntryModulePath(path) && (!dir || dir.toLowerCase() === 'src')) score = 0;
    if (score > 0) scored.push({ path, score });
  }
  scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return scored.map(s => s.path);
}

export interface ExistingProjectExport {
  path: string;
  summary: string;
}

/**
 * Compact export summaries (not bodies) of earlier-step files the task should import.
 * `maxChars` is the total budget for all summaries, including the path headings.
 */
export function pickExistingProjectExports(opts: {
  taskPath: string;
  brief: string;
  files: Array<{ path: string; content: string }>;
  excludePaths?: string[];
  maxChars?: number;
  maxFiles?: number;
}): ExistingProjectExport[] {
  const budget = Math.max(0, Math.floor(opts.maxChars ?? 3200));
  const maxFiles = Math.max(1, Math.floor(opts.maxFiles ?? 10));
  if (budget < 80) return [];
  const byKey = new Map<string, { path: string; content: string }>();
  for (const f of opts.files || []) {
    if (f?.path && typeof f.content === 'string') byKey.set(normRel(f.path).toLowerCase(), f);
  }
  const ranked = rankExistingProjectFiles({
    taskPath: opts.taskPath,
    brief: opts.brief,
    paths: [...byKey.values()].map(f => f.path),
    excludePaths: opts.excludePaths
  });
  const out: ExistingProjectExport[] = [];
  let remaining = budget;
  for (const path of ranked) {
    if (out.length >= maxFiles || remaining < 80) break;
    const file = byKey.get(normRel(path).toLowerCase());
    if (!file) continue;
    const perFile = Math.min(900, remaining - path.length - 8);
    if (perFile < 60) break;
    const summary = summarizeModuleExports(path, file.content, perFile);
    if (!summary) continue;
    out.push({ path, summary });
    remaining -= path.length + summary.length + 8;
  }
  return out;
}

/** Symbol lines that match a search query, to place above raw grep. */
export function symbolHitsForQuery(map: RepoMap | null, query: string): string {
  if (!map || !query.trim()) return '';
  const q = query.toLowerCase();
  const hits = map.symbols.filter(
    s => s.name.toLowerCase().includes(q) || s.file.toLowerCase().includes(q)
  );
  if (!hits.length) return '';
  return (
    'SYMBOL HITS (prefer these files):\n' +
    hits
      .slice(0, 12)
      .map(s => `${s.file} :: ${s.name}`)
      .join('\n') +
    '\n\n'
  );
}
