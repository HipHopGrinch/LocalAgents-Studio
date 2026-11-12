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
    const importers = owned.filter(o => fileImportedBy(bodies.get(o.raw) || '', file));
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

function fileImportedBy(body: string, importedFile: string): boolean {
  const stem = (importedFile.split(/[/\\]/).pop() || '').replace(/\.[^.]+$/, '');
  if (!stem || stem.length < 2) return false;
  const want = stem.toLowerCase();
  const specs = body.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]/g);
  for (const match of specs) {
    const spec = match[1] || match[2] || '';
    const specStem = (spec.split('/').pop() || '').replace(/\.[^.]+$/, '').toLowerCase();
    if (specStem === want) return true;
  }
  return false;
}
