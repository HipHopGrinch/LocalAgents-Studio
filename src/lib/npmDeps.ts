/**
 * Known LLM mistakes → real npm package names.
 * Keep in sync with electron/npmDeps.cjs.
 */
export const PACKAGE_ALIASES: Record<string, string> = {
  'react-three-fiber': '@react-three/fiber',
  'react-three-drei': '@react-three/drei',
  'react-three-rapier': '@react-three/rapier',
  reactthreefiber: '@react-three/fiber'
};

const ALIAS_DEFAULT_VERSION: Record<string, string> = {
  '@react-three/fiber': '^8.15.0',
  '@react-three/drei': '^9.88.0',
  '@react-three/rapier': '^1.0.0'
};

function rewriteDepName(name: string): string {
  const key = String(name || '').trim();
  return PACKAGE_ALIASES[key] || PACKAGE_ALIASES[key.toLowerCase()] || key;
}

export function sanitizeDepMap(
  deps: Record<string, string> | undefined
): { deps: Record<string, string>; changed: string[] } {
  if (!deps || typeof deps !== 'object') return { deps: deps || {}, changed: [] };
  const out: Record<string, string> = {};
  const changed: string[] = [];
  for (const [rawName, rawVer] of Object.entries(deps)) {
    const name = rewriteDepName(rawName);
    let ver = String(rawVer || '').trim() || '*';
    if (name !== rawName) {
      if (ALIAS_DEFAULT_VERSION[name] && (ver === '*' || !ver)) {
        ver = ALIAS_DEFAULT_VERSION[name];
      }
      changed.push(`${rawName}@${rawVer} → ${name}@${ver}`);
    }
    out[name] = ver;
  }
  return { deps: out, changed };
}

export function sanitizePackageJsonObject(pkg: Record<string, unknown>): {
  json: Record<string, unknown>;
  changed: string[];
  rewritten: boolean;
} {
  if (!pkg || typeof pkg !== 'object') {
    return { json: pkg, changed: [], rewritten: false };
  }
  const changed: string[] = [];
  const next: Record<string, unknown> = { ...pkg };
  for (const field of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies'
  ] as const) {
    const block = next[field];
    if (!block || typeof block !== 'object') continue;
    const { deps, changed: c } = sanitizeDepMap(block as Record<string, string>);
    next[field] = deps;
    changed.push(...c.map(x => `${field}: ${x}`));
  }
  return { json: next, changed, rewritten: changed.length > 0 };
}

/** If content is package.json JSON, rewrite known-bad dependency names. */
export function sanitizePackageJsonContent(content: string): {
  content: string;
  changed: string[];
} {
  try {
    const pkg = JSON.parse(String(content || '')) as Record<string, unknown>;
    const { json, changed, rewritten } = sanitizePackageJsonObject(pkg);
    if (!rewritten) return { content: String(content), changed: [] };
    return { content: `${JSON.stringify(json, null, 2)}\n`, changed };
  } catch {
    return { content: String(content ?? ''), changed: [] };
  }
}

export function isPackageJsonPath(filePath: string): boolean {
  return /(^|[/\\])package\.json$/i.test(String(filePath || '').replace(/\\/g, '/'));
}
