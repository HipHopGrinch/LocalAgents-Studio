/**
 * Post-fanout tsc lines that do not name a swarm-owned file are attached to
 * the owned files that import them, so the worker that pulled the symbol can repair it.
 */
export function assignSwarmDiagnostics(
  byFile: Map<string, string>,
  ownedPaths: string[],
  bodies: ReadonlyMap<string, string>
): { owned: Map<string, string>; unmatched: string[] } {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  const owned = ownedPaths.map(raw => ({ raw, key: norm(raw) }));
  const ownedErrors = new Map<string, string>();
  const unmatched: string[] = [];

  const append = (path: string, block: string) => {
    const prev = ownedErrors.get(path);
    ownedErrors.set(path, prev ? `${prev}\n${block}` : block);
  };

  const matchOwned = (file: string): string | undefined => {
    const key = norm(file);
    const hit = owned.find(
      o => o.key === key || key.endsWith('/' + o.key) || o.key.endsWith('/' + key)
    );
    return hit?.raw;
  };

  for (const [file, err] of byFile) {
    const owner = matchOwned(file);
    if (owner) {
      append(owner, err);
      continue;
    }
    const importers = owned.filter(o => fileImportedBy(bodies.get(o.raw) || '', o.key, file));
    if (!importers.length) {
      unmatched.push(err);
      continue;
    }
    for (const importer of importers) {
      append(importer.raw, `Errors in imported \`${file.replace(/\\/g, '/')}\`:\n${err}`);
    }
  }

  return { owned: ownedErrors, unmatched };
}

function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

function stripModuleExt(p: string): string {
  return p.replace(/\.(?:d\.ts|tsx|ts|jsx|js|mjs|cjs|json)$/, '');
}

function resolveSpecifier(importer: string, spec: string): string {
  const relative = spec.startsWith('./') || spec.startsWith('../');
  const parts = relative ? importer.split('/').slice(0, -1) : [];
  const source = relative ? spec : spec.replace(/^(?:@|~)?\//, '');
  for (const seg of source.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return stripModuleExt(parts.join('/'));
}

function fileImportedBy(body: string, importerPath: string, importedFile: string): boolean {
  const imported = stripModuleExt(normPath(importedFile));
  const importedDir = imported.replace(/\/index$/, '');
  if (!imported || imported.length < 2) return false;
  const importer = normPath(importerPath);
  const absolute = /^(?:[a-z]:)?\//.test(imported);
  const specs = body.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]/g);
  for (const match of specs) {
    const spec = (match[1] || match[2] || '').trim();
    if (!spec) continue;
    const relative = spec.startsWith('.');
    if (!relative && !spec.includes('/')) continue;
    const resolved = resolveSpecifier(importer, spec).toLowerCase();
    if (!resolved) continue;
    for (const candidate of [imported, importedDir]) {
      if (candidate === resolved) return true;
      if ((!relative || absolute) && candidate.endsWith('/' + resolved)) return true;
    }
  }
  return false;
}
