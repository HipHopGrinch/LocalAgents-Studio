/**
 * Known LLM mistakes → real npm package names.
 * Applied before npm install and when writing package.json.
 */
const PACKAGE_ALIASES = {
  'react-three-fiber': '@react-three/fiber',
  'react-three-drei': '@react-three/drei',
  'react-three-rapier': '@react-three/rapier',
  'reactthreefiber': '@react-three/fiber'
};

/** Default versions when rewriting a broken range onto the scoped name. */
const ALIAS_DEFAULT_VERSION = {
  '@react-three/fiber': '^8.15.0',
  '@react-three/drei': '^9.88.0',
  '@react-three/rapier': '^1.0.0'
};

function rewriteDepName(name) {
  const key = String(name || '').trim();
  return PACKAGE_ALIASES[key] || PACKAGE_ALIASES[key.toLowerCase()] || key;
}

/**
 * @param {Record<string, string>|undefined} deps
 * @returns {{ deps: Record<string, string>, changed: string[] }}
 */
function sanitizeDepMap(deps) {
  if (!deps || typeof deps !== 'object') return { deps: deps || {}, changed: [] };
  const out = {};
  const changed = [];
  for (const [rawName, rawVer] of Object.entries(deps)) {
    const name = rewriteDepName(rawName);
    let ver = String(rawVer || '').trim() || '*';
    if (name !== rawName) {
      if (Object.prototype.hasOwnProperty.call(out, name)) {
        changed.push(`${rawName}@${rawVer} → ${name}@${out[name]}`);
        continue;
      }
      if (ALIAS_DEFAULT_VERSION[name] && (ver === '*' || !ver)) {
        ver = ALIAS_DEFAULT_VERSION[name];
      }
      changed.push(`${rawName}@${rawVer} → ${name}@${ver}`);
    }
    out[name] = ver;
  }
  return { deps: out, changed };
}

/**
 * Sanitize package.json object in place-ish; returns { json, changed, rewritten }.
 */
function sanitizePackageJsonObject(pkg) {
  if (!pkg || typeof pkg !== 'object') {
    return { json: pkg, changed: [], rewritten: false };
  }
  const changed = [];
  const next = { ...pkg };
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    if (!next[field] || typeof next[field] !== 'object') continue;
    const { deps, changed: c } = sanitizeDepMap(next[field]);
    next[field] = deps;
    changed.push(...c.map(x => `${field}: ${x}`));
  }
  return { json: next, changed, rewritten: changed.length > 0 };
}

/** If content is package.json text, sanitize dep names. Returns { content, changed }. */
function sanitizePackageJsonContent(content) {
  try {
    const pkg = JSON.parse(String(content || ''));
    const { json, changed, rewritten } = sanitizePackageJsonObject(pkg);
    if (!rewritten) return { content: String(content), changed: [] };
    return { content: JSON.stringify(json, null, 2) + '\n', changed };
  } catch {
    return { content: String(content ?? ''), changed: [] };
  }
}

function isPackageJsonPath(filePath) {
  return /(^|[/\\])package\.json$/i.test(String(filePath || '').replace(/\\/g, '/'));
}

module.exports = {
  PACKAGE_ALIASES,
  sanitizeDepMap,
  sanitizePackageJsonObject,
  sanitizePackageJsonContent,
  isPackageJsonPath,
  rewriteDepName
};
