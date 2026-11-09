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
    if (!r || seen.has(r.toLowerCase()) || SKIP_SOURCE_FILE.test(r)) return;
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
        await walk(ent.path, depth + 1);
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
        await walk(ent.path, depth + 1);
        continue;
      }
      const r = rel(root, ent.path);
      if (!r || r.startsWith('.')) continue;
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

/** Tight models get paths plus one symbol line for files named in the task. */
export function formatRepoMap(
  map: RepoMap | null,
  tier: 'tight' | 'standard' | 'wide',
  focusText = ''
): string {
  if (!map || map.files.length === 0) return '';
  const focus = focusText.toLowerCase();
  const named = map.files.filter(f => {
    const base = f.split('/').pop()?.toLowerCase() || '';
    return base.length > 2 && focus.includes(base);
  });
  if (tier === 'tight') {
    const paths = (named.length ? named : map.files.slice(0, 40)).slice(0, 40);
    const lines = paths.map(f => {
      const sym = map.symbols.filter(s => s.file === f).slice(0, 4);
      return sym.length ? `${f} — ${sym.map(s => s.name).join(', ')}` : f;
    });
    return `REPO MAP (tight — named files first):\n${lines.join('\n')}`;
  }
  const cap = tier === 'wide' ? 180 : 80;
  const pathBlock = map.files.slice(0, cap).join('\n');
  const byFile = new Map<string, string[]>();
  for (const s of map.symbols) {
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
