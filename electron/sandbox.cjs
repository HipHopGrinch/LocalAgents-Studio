/**
 * Pure workspace jail + agent-command denylist.
 * No Electron dependency so scripts/sandbox.selftest.cjs can run under plain Node.
 */
const fs = require('fs');
const path = require('path');

function pathsEqual(a, b) {
  const left = path.resolve(String(a || ''));
  const right = path.resolve(String(b || ''));
  if (process.platform === 'win32') return left.toLowerCase() === right.toLowerCase();
  return left === right;
}

/**
 * True when `candidate` is the root or a descendant. Does not follow links;
 * callers pass realpath results.
 */
function relativeToRoot(rootReal, candidate) {
  const root = path.resolve(String(rootReal || ''));
  const cand = path.resolve(String(candidate || ''));
  const rel = path.relative(root, cand);
  if (rel === '') return { inside: true, isRoot: true, rel };
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return { inside: false, isRoot: false, rel };
  return { inside: true, isRoot: false, rel };
}

/**
 * Resolve `target` under `root`, following symlinks and junctions.
 * Missing leaf segments are allowed only when every existing ancestor
 * realpaths inside the real workspace root.
 *
 * @param {string} root workspace directory
 * @param {string} target absolute path, or path relative to root
 * @param {{ allowRoot?: boolean, fsImpl?: object }} [opts]
 * @returns {string} absolute path with the existing prefix realpath'd
 */
function resolveJailedPath(root, target, opts = {}) {
  const fsImpl = opts.fsImpl || fs;
  const allowRoot = !!opts.allowRoot;
  const rootAbs = path.resolve(String(root || ''));
  if (!rootAbs) throw new Error('No workspace folder is open');

  let rootReal;
  try {
    rootReal = fsImpl.realpathSync(rootAbs);
  } catch {
    throw new Error('Workspace root is not accessible');
  }

  const raw = String(target == null ? '' : target).trim();
  if (raw.includes('\0')) throw new Error('Path is outside the open workspace');
  const abs = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(rootAbs, raw || '.');

  const lex = relativeToRoot(rootAbs, abs);
  if (!lex.inside) throw new Error('Path is outside the open workspace');

  const missing = [];
  let cursor = abs;
  for (let depth = 0; depth < 64; depth++) {
    try {
      const real = fsImpl.realpathSync(cursor);
      const ancestor = relativeToRoot(rootReal, real);
      if (!ancestor.inside) throw new Error('Path is outside the open workspace');
      const full = missing.length ? path.resolve(real, ...missing.slice().reverse()) : real;
      const placed = relativeToRoot(rootReal, full);
      if (!placed.inside) throw new Error('Path is outside the open workspace');
      if (!allowRoot && placed.isRoot) {
        throw new Error('Refusing to operate on the workspace root itself');
      }
      return full;
    } catch (err) {
      if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
        let danglingLink = false;
        try {
          const st = fsImpl.lstatSync(cursor);
          danglingLink = !!st && typeof st.isSymbolicLink === 'function' && st.isSymbolicLink();
        } catch (lerr) {
          if (!lerr || (lerr.code !== 'ENOENT' && lerr.code !== 'ENOTDIR')) {
            throw new Error('Path is outside the open workspace');
          }
        }
        if (danglingLink) throw new Error('Refusing to use a symlink or junction');
        const parent = path.dirname(cursor);
        if (parent === cursor) throw new Error('Path is outside the open workspace');
        missing.push(path.basename(cursor));
        cursor = parent;
        continue;
      }
      throw err;
    }
  }
  throw new Error('Path is outside the open workspace');
}

const DESTRUCTIVE_CMD =
  /\brm\s+-rf\b|\bformat\s+[a-z]:|\bformat-volume\b|\bclear-disk\b|\binitialize-disk\b|\bremove-partition\b|\bdiskpart\b|\bmkfs\b|\bdd\s+if=|\bshutdown\b|\breboot\b|\bgit(?:\.exe)?\b[^\n;&|]*?\bpush\b[^\n]*(--force|\s-f\b)|\bgit(?:\.exe)?\b[^\n;&|]*?\breset\b[^\n]*--hard|\bgit(?:\.exe)?\b[^\n;&|]*?\bclean\b[^\n]*-[a-z]*f|\bgit(?:\.exe)?\b[^\n;&|]*?\bcheckout\b[^\n]*\s--\s+\./i;

/** `rm`, `del`, `rd`, `erase`, `rmdir`, `ri` and `remove-item` are one group in PowerShell. */
const RECURSIVE_DELETE =
  /(?<![\w.\\/-])(?<!\bgit )(?:remove-item|rmdir|erase|del|rd|rm|ri)(?![\w-])[^;&|]*?(?:\s-r(?:ec\w*|e)?(?![\w-])|\s\/s(?!\w))/i;

/** PowerShell / cmd destructive deletes with flags in any order. Mirrors the renderer denylist. */
function isDestructiveDelete(cmd) {
  const c = String(cmd || '').replace(/\s+/g, ' ');
  return RECURSIVE_DELETE.test(c);
}

/**
 * Agent command denylist. This is a backstop for obvious destructive commands
 * and obfuscated wrappers, not a sandbox. PowerShell can still hide intent with
 * encoding, aliases, and custom functions the pattern list does not see. The
 * workspace jail is the real boundary.
 *
 * Backticks and cmd `^` escapes are stripped before matching so ``I`ex`` and
 * `c^md /c` are visible to the same checks.
 */
function normalizeForDeny(cmd) {
  return String(cmd || '').replace(/[`^]/g, '');
}

const ENCODED_COMMAND = 'encodedcommand';

/** Any `-`/`/` prefix of EncodedCommand, plus the common `-ec` abbreviation. */
function isEncodedCommandFlag(token) {
  let body = String(token || '').trim().replace(/^['"]+|['"]+$/g, '');
  body = body.split(/[:=]/)[0];
  if (!/^[-\/]/.test(body)) return false;
  const flag = body.replace(/^[-\/]+/, '').toLowerCase();
  if (!flag) return false;
  if (flag === 'ec') return true;
  return ENCODED_COMMAND.startsWith(flag);
}

function hasEncodedCommandFlag(cmd) {
  const tokens = String(cmd || '').split(/[\s;&|()]+/);
  return tokens.some(isEncodedCommandFlag);
}

function isIndirectShellWrapper(cmd) {
  const c = normalizeForDeny(cmd);
  if (hasEncodedCommandFlag(c)) return true;
  if (/\binvoke-expression\b/i.test(c)) return true;
  if (/(^|[\s;&|(])iex\b/i.test(c)) return true;
  if (/\bcmd(?:\.exe)?\s+\/[ck]\b/i.test(c)) return true;
  if (/\bstart-process\b/i.test(c)) return true;
  if (/\bsaps\b/i.test(c) && /\b(?:powershell|pwsh|cmd)(?:\.exe)?\b/i.test(c)) return true;
  if (/(^|[\s;&|(])start(?:\.exe)?\b/i.test(c) && /\b(?:powershell|pwsh|cmd)(?:\.exe)?\b/i.test(c)) return true;
  return false;
}

function isLinkCreate(cmd) {
  const c = normalizeForDeny(cmd);
  if (/\bmklink\b/i.test(c)) return true;
  if (/\bfsutil(?:\.exe)?\b[^;&|]*\bhardlink\b/i.test(c)) return true;
  if (
    /\b(?:new-item|ni)\b/i.test(c) &&
    /-\s*itemtype\b/i.test(c) &&
    /\b(?:junction|symboliclink|hardlink)\b/i.test(c)
  ) {
    return true;
  }
  return false;
}

/**
 * @returns {string|null} denial reason for an agent command, or null when allowed
 */
function agentCommandBlockReason(cmd) {
  const c = normalizeForDeny(cmd);
  if (!c.trim()) return 'Blocked empty agent command.';
  if (isIndirectShellWrapper(c)) {
    return 'Blocked indirect shell wrapper (EncodedCommand, Invoke-Expression, cmd /c, or Start-Process).';
  }
  if (isLinkCreate(c)) return 'Blocked symlink, junction, or hardlink creation.';
  if (DESTRUCTIVE_CMD.test(c) || isDestructiveDelete(c)) {
    return 'Blocked destructive command.';
  }
  return null;
}

/**
 * Best-effort re-check immediately before a filesystem syscall.
 * Node on Windows cannot open a path with O_NOFOLLOW and a directory handle
 * in one step, so a symlink can still be swapped in between this check and
 * the syscall. Refuse when the parent has left the jail or the leaf is a
 * symlink or junction.
 *
 * @param {string} root workspace directory
 * @param {string} resolvedPath absolute path already produced by resolveJailedPath
 * @param {{ fsImpl?: object }} [opts]
 * @returns {string}
 */
function recheckJailedLeaf(root, resolvedPath, opts = {}) {
  const fsImpl = opts.fsImpl || fs;
  const rootAbs = path.resolve(String(root || ''));
  let rootReal;
  try {
    rootReal = fsImpl.realpathSync(rootAbs);
  } catch {
    throw new Error('Workspace root is not accessible');
  }
  const parent = path.dirname(resolvedPath);
  let parentReal;
  try {
    parentReal = fsImpl.realpathSync(parent);
  } catch (err) {
    // A new folder (e.g. src/types/) does not exist until the caller mkdirs it.
    // Validate the nearest existing ancestor instead; callers recheck after mkdir.
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
      return resolveJailedPath(root, resolvedPath, { fsImpl });
    }
    throw new Error('Path is outside the open workspace');
  }
  if (!relativeToRoot(rootReal, parentReal).inside) {
    throw new Error('Path is outside the open workspace');
  }
  const leaf = path.join(parentReal, path.basename(resolvedPath));
  if (!relativeToRoot(rootReal, leaf).inside) {
    throw new Error('Path is outside the open workspace');
  }
  let lst;
  try {
    lst = fsImpl.lstatSync(leaf);
  } catch (err) {
    if (err && err.code === 'ENOENT') return leaf;
    throw new Error('Path is outside the open workspace');
  }
  if (typeof lst.isSymbolicLink === 'function' && lst.isSymbolicLink()) {
    throw new Error('Refusing to use a symlink or junction');
  }
  if (typeof lst.isFile === 'function' && lst.isFile() && lst.nlink > 1) {
    throw new Error('Refusing to use a hardlink: the file has more than one link');
  }
  let realLeaf;
  try {
    realLeaf = fsImpl.realpathSync(leaf);
  } catch (err) {
    if (err && err.code === 'ENOENT') return leaf;
    throw new Error('Path is outside the open workspace');
  }
  if (!relativeToRoot(rootReal, realLeaf).inside || !pathsEqual(realLeaf, leaf)) {
    throw new Error('Refusing to use a symlink or junction');
  }
  return leaf;
}

/**
 * Web settings:save merge. Stored nodes the payload omits stay. Existing ids
 * keep their stored url and key material. Payload keys are ignored. New ids
 * are appended without credentials.
 */
function mergeWebNodeList(prevNodes, incomingNodes) {
  const prev = Array.isArray(prevNodes) ? prevNodes.filter(n => n && typeof n === 'object') : [];
  const incoming = Array.isArray(incomingNodes) ? incomingNodes : [];
  const prevById = new Map();
  for (const node of prev) {
    if (node.id) prevById.set(node.id, node);
  }
  const seen = new Set();
  const merged = [];
  for (const raw of incoming) {
    if (!raw || typeof raw !== 'object' || !raw.id || seen.has(raw.id)) continue;
    seen.add(raw.id);
    const { hasApiKey, apiKey, apiKeyEnc, apiKeyEncV, ...rest } = raw;
    const prevNode = prevById.get(raw.id);
    if (!prevNode) {
      merged.push(rest);
      continue;
    }
    const kept = {
      ...prevNode,
      ...rest,
      id: prevNode.id,
      url: prevNode.url
    };
    delete kept.hasApiKey;
    delete kept.apiKey;
    delete kept.apiKeyEnc;
    delete kept.apiKeyEncV;
    if (prevNode.apiKeyEnc) {
      kept.apiKeyEnc = prevNode.apiKeyEnc;
      if (prevNode.apiKeyEncV) kept.apiKeyEncV = prevNode.apiKeyEncV;
    } else if (typeof prevNode.apiKey === 'string') {
      kept.apiKey = prevNode.apiKey;
    }
    merged.push(kept);
  }
  for (const node of prev) {
    if (!node.id || !seen.has(node.id)) merged.push(node);
  }
  return merged;
}

module.exports = {
  pathsEqual,
  relativeToRoot,
  resolveJailedPath,
  recheckJailedLeaf,
  mergeWebNodeList,
  isDestructiveDelete,
  isIndirectShellWrapper,
  isEncodedCommandFlag,
  agentCommandBlockReason
};
