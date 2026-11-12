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
    if (base.length > 2 && lowerTask.includes(base)) score += 10;
    if (stem.length > 2 && (tokens.has(stem) || lowerTask.includes(stem))) score += 6;
    for (const tok of tokens) {
      if (tok.length >= 4 && tok !== base && tok !== stem && lower.includes(tok)) score += 2;
    }
    for (const sym of map.symbols) {
      if (sym.file.replace(/\\/g, '/') !== file.replace(/\\/g, '/')) continue;
      const name = sym.name.toLowerCase();
      if (name.length < 2) continue;
      if (tokens.has(name) || lowerTask.includes(name)) score += 5;
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
