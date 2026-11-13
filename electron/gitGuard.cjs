/**
 * Pure git argv / env guard for the in-app git:run channel.
 * No Electron dependency so scripts/git-run.selftest.cjs can spawn git with the
 * same argv and environment the main process uses.
 *
 * Repository hooks are not run. core.hooksPath points at an empty directory the
 * app controls. That is intentional: a workspace pre-commit hook must not execute
 * with the app's privileges.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const GIT_SUBCOMMANDS = new Set(['status', 'diff', 'rev-parse', 'branch', 'add', 'commit', 'log']);
const GIT_MAX_ARGS = 48;

/** Options that consume the following argument (commit messages, formatting, not paths). */
const VALUE_OPTIONS = new Set([
  '-m',
  '--message',
  '-n',
  '--max-count',
  '-U',
  '--unified',
  '--abbrev',
  '--pretty',
  '--format',
  '--author',
  '--date',
  '--grep',
  '-S',
  '-G',
  '--encoding',
  '--color',
  '--ignore-submodules',
  '--submodule',
  '--diff-filter',
  '--since',
  '--until',
  '--find-renames',
  '--find-copies',
  '--anchored',
  '--src-prefix',
  '--dst-prefix',
  '--line-prefix',
  '--skip',
  '--max-parents',
  '--min-parents',
  '--branches',
  '--remotes',
  '--glob',
  '--exclude'
]);

/** `=` values that are text, not pathspecs. */
const SKIP_EQ_VALUE = new Set([
  '-m',
  '--message',
  '--author',
  '--date',
  '--grep',
  '-S',
  '-G',
  '--pretty',
  '--format',
  '--encoding',
  '--subject',
  '--cleanup',
  '--trailer'
]);

const SCRUB_EXACT = new Set([
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_PARAMETERS',
  'GIT_SSH_COMMAND',
  'GIT_SSH',
  'GIT_ASKPASS',
  'GIT_EXTERNAL_DIFF',
  'GIT_PAGER',
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_EXEC_PATH'
]);

/**
 * Block dangerous options anywhere after the subcommand.
 * `-c` and `-C` are NOT listed: `git diff -c` / `-C` are combined-diff and copy
 * detection. Global `-c` / `-C` are rejected because argv[0] must be the subcommand.
 */
function isBlockedGitArg(arg) {
  const s = String(arg || '');
  if (/^--output(?:=|$)/i.test(s)) return true;
  if (s === '-o' || /^-o=/i.test(s)) return true;
  if (/^--no-index$/i.test(s)) return true;
  if (/^--upload-pack/i.test(s)) return true;
  if (/^--receive-pack/i.test(s)) return true;
  if (/^--exec/i.test(s)) return true;
  if (/^--ext-diff$/i.test(s)) return true;
  if (/^--textconv(?:=|$)/i.test(s)) return true;
  if (/^--git-dir/i.test(s)) return true;
  if (/^--work-tree/i.test(s)) return true;
  if (/^--namespace/i.test(s)) return true;
  if (/^--config-env/i.test(s)) return true;
  if (/^--config(?:=|$)/i.test(s)) return true;
  if (/^--super-prefix/i.test(s)) return true;
  if (/^--list-cmds/i.test(s)) return true;
  if (/^--extcmd(?:=|$)/i.test(s)) return true;
  if (s === '-L' || /^-L\d/.test(s) || /^-L,/.test(s)) return true;
  return false;
}

function pathspecDenial(workspaceRoot, arg) {
  if (!workspaceRoot) return 'No workspace folder is open';
  const root = path.resolve(String(workspaceRoot));
  let spec = String(arg);
  if (spec.startsWith(':!')) spec = spec.slice(2);
  else if (spec.startsWith(':^')) spec = spec.slice(2);
  else if (spec.startsWith(':/')) spec = spec.slice(2);
  else if (spec.startsWith(':(')) {
    const end = spec.indexOf(')');
    if (end < 0) return 'Invalid git pathspec';
    spec = spec.slice(end + 1);
  } else if (spec.startsWith(':') && !spec.startsWith('://')) {
    spec = spec.slice(1);
  }
  if (!spec || spec === '.') return null;
  if (spec.includes('\0')) return 'Git path is outside the workspace';
  if (
    path.isAbsolute(spec) ||
    /^[a-zA-Z]:[\\/]/.test(spec) ||
    spec.startsWith('\\\\') ||
    spec.startsWith('//')
  ) {
    return 'Git path is outside the workspace';
  }
  const resolved = path.resolve(root, spec);
  const rel = path.relative(root, resolved);
  if (rel === '') return null;
  if (rel.startsWith('..') || path.isAbsolute(rel)) return 'Git path is outside the workspace';
  return null;
}

/**
 * @param {string[]} args caller argv; args[0] must be the subcommand (no global options before it)
 * @param {string} workspaceRoot
 * @returns {string|null}
 */
function validateGitArgs(args, workspaceRoot) {
  if (!Array.isArray(args) || args.length === 0) return 'Git arguments must be a list of strings';
  if (args.length > GIT_MAX_ARGS) return 'Too many git arguments';
  for (const arg of args) {
    if (typeof arg !== 'string') return 'Git arguments must be a list of strings';
    if (!arg || /[\0\r\n]/.test(arg)) return 'Invalid git argument';
    if (arg.length > 16000) return 'Git argument is too long';
  }
  const sub = args[0];
  if (!GIT_SUBCOMMANDS.has(sub)) {
    if (
      sub === '-c' ||
      sub === '-C' ||
      sub.startsWith('-c') ||
      sub.startsWith('-C') ||
      isBlockedGitArg(sub) ||
      sub.startsWith('-')
    ) {
      return 'That git option is not allowed';
    }
    return `Git subcommand not allowed: ${sub}`;
  }

  let afterDash = false;
  let skipNext = false;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (arg === '--') {
      afterDash = true;
      continue;
    }
    if (isBlockedGitArg(arg)) return 'That git option is not allowed';
    if (!afterDash && arg.startsWith('-')) {
      const eq = arg.indexOf('=');
      if (eq > 0) {
        const name = arg.slice(0, eq);
        const value = arg.slice(eq + 1);
        if (!SKIP_EQ_VALUE.has(name) && value) {
          const denial = pathspecDenial(workspaceRoot, value);
          if (denial) return denial;
        }
      } else if (VALUE_OPTIONS.has(arg)) {
        skipNext = true;
      }
      continue;
    }
    const denial = pathspecDenial(workspaceRoot, arg);
    if (denial) return denial;
  }
  return null;
}

const MAX_CONFIG_BYTES = 1024 * 1024;

function readSmallText(file) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > MAX_CONFIG_BYTES) return '';
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/** The `.git` directory of a workspace (follows a `gitdir:` pointer file). */
function resolveGitDir(workspaceRoot) {
  if (!workspaceRoot) return '';
  const dotGit = path.join(path.resolve(String(workspaceRoot)), '.git');
  try {
    const st = fs.statSync(dotGit);
    if (st.isDirectory()) return dotGit;
    if (st.isFile()) {
      const m = /^gitdir:\s*(.+?)\s*$/im.exec(readSmallText(dotGit));
      if (m) return path.resolve(path.dirname(dotGit), m[1]);
    }
  } catch {
    /* no repository */
  }
  return '';
}

const MAX_INCLUDE_DEPTH = 10;
const MAX_INCLUDE_FILES = 64;

/** Value of a config `path = ...` line: comments and quotes removed. */
function parseConfigValue(raw) {
  let v = String(raw || '').trim();
  if (v.startsWith('"')) {
    const m = /^"((?:[^"\\]|\\.)*)"/.exec(v);
    return m ? m[1].replace(/\\(.)/g, '$1') : v.slice(1);
  }
  v = v.replace(/\s+[#;].*$/, '');
  return v.trim();
}

/** Resolve an `include.path` value the way git does (`~/`, relative to the including file). */
function resolveIncludePath(value, fromFile) {
  if (!value || /[\0\r\n]/.test(value)) return '';
  if (value === '~' || value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(1));
  }
  return path.isAbsolute(value) ? value : path.resolve(path.dirname(fromFile), value);
}

/**
 * Text of a git config file with every `[include]` / `[includeIf "..."]` file appended.
 * includeIf conditions are not evaluated: following every one only over-neutralizes.
 * Cycles, depth (git's own limit of 10) and file count are bounded.
 * @param {string} file
 * @param {{ seen: Set<string>, parts: string[] }} acc
 * @param {number} depth
 */
function collectConfigText(file, acc, depth) {
  if (depth > MAX_INCLUDE_DEPTH || acc.seen.size >= MAX_INCLUDE_FILES) return;
  let key;
  try {
    key = path.resolve(file).toLowerCase();
  } catch {
    return;
  }
  if (acc.seen.has(key)) return;
  acc.seen.add(key);
  const text = readSmallText(file);
  if (!text) return;
  acc.parts.push(text);
  const headerRe = /^\s*\[\s*([A-Za-z0-9.-]+)(?:\s+"(?:[^"\\]|\\.)*")?\s*\](.*)$/;
  let inInclude = false;
  const takeLine = line => {
    const pm = /^\s*path\s*=\s*(.*)$/i.exec(line);
    if (!pm) return;
    const target = resolveIncludePath(parseConfigValue(pm[1]), file);
    if (target) collectConfigText(target, acc, depth + 1);
  };
  for (const line of text.split(/\r?\n/)) {
    const h = headerRe.exec(line);
    if (h) {
      const section = h[1].toLowerCase();
      inInclude = section === 'include' || section === 'includeif';
      if (inInclude && h[2]) takeLine(h[2]);
      continue;
    }
    if (inInclude) takeLine(line);
  }
}

/** Repo-controlled config files: config, config.worktree, and the shared config of a linked worktree. */
function repoConfigFiles(gitDir) {
  if (!gitDir) return [];
  const files = [path.join(gitDir, 'config'), path.join(gitDir, 'config.worktree')];
  const common = readSmallText(path.join(gitDir, 'commondir')).trim();
  if (common && !/[\0\r\n]/.test(common)) {
    const commonDir = path.resolve(gitDir, common);
    files.push(path.join(commonDir, 'config'), path.join(commonDir, 'config.worktree'));
  }
  return files;
}

/**
 * Names of every clean/smudge filter the repo could trigger: `[filter "x"]` in the
 * repo config (following `include.path` and `includeIf.*.path`) plus `filter=x` in
 * .gitattributes and .git/info/attributes.
 * @returns {string[]}
 */
function discoverFilterNames(workspaceRoot) {
  const names = new Set();
  const gitDir = resolveGitDir(workspaceRoot);
  const acc = { seen: new Set(), parts: [] };
  for (const file of repoConfigFiles(gitDir)) collectConfigText(file, acc, 0);
  const config = acc.parts.join('\n');
  const sectionRe = /^\s*\[\s*filter\s+"((?:[^"\\]|\\.)*)"\s*\]/gim;
  let m;
  while ((m = sectionRe.exec(config))) names.add(m[1].replace(/\\(.)/g, '$1'));
  const legacyRe = /^\s*\[\s*filter\.([^\s\]"]+)\s*\]/gim;
  while ((m = legacyRe.exec(config))) names.add(m[1].toLowerCase());
  const attrSources = [
    workspaceRoot ? readSmallText(path.join(path.resolve(String(workspaceRoot)), '.gitattributes')) : '',
    gitDir ? readSmallText(path.join(gitDir, 'info', 'attributes')) : ''
  ];
  for (const text of attrSources) {
    for (const line of text.split(/\r?\n/)) {
      if (/^\s*#/.test(line)) continue;
      const re = /(?:^|\s)filter=(\S+)/g;
      let a;
      while ((a = re.exec(line))) names.add(a[1]);
    }
  }
  return [...names].filter(n => n && !/[\0\r\n=]/.test(n));
}

/**
 * Caller args plus the overrides the caller cannot supply.
 * `--no-optional-locks` is a global option and must precede `status`.
 * @returns {{ argv: string[], error?: string }}
 */
function buildGitArgv(args, { workspaceRoot, hooksDir } = {}) {
  const error = validateGitArgs(args, workspaceRoot);
  if (error) return { argv: [], error };
  if (!hooksDir || /[\0\r\n]/.test(String(hooksDir))) {
    return { argv: [], error: 'Git hooks directory is not configured' };
  }
  const sub = args[0];
  const rest = args.slice(1).filter(arg => !(sub === 'status' && arg === '--no-optional-locks'));
  const injected = [];
  if (sub === 'diff' || sub === 'log') {
    if (!rest.includes('--no-textconv')) injected.push('--no-textconv');
    if (!rest.includes('--no-ext-diff')) injected.push('--no-ext-diff');
  }
  const argv = [
    '-c',
    'core.fsmonitor=false',
    '-c',
    'diff.external=',
    '-c',
    'core.pager=cat',
    '-c',
    `core.hooksPath=${hooksDir}`,
    '-c',
    'core.sshCommand=',
    '-c',
    'credential.helper=',
    '-c',
    'core.editor=',
    '-c',
    'alias.status=',
    '-c',
    'alias.diff=',
    '-c',
    'alias.rev-parse=',
    '-c',
    'alias.branch=',
    '-c',
    'alias.add=',
    '-c',
    'alias.commit=',
    '-c',
    'alias.log=',
    '-c',
    'commit.gpgsign=false',
    '-c',
    'tag.gpgsign=false',
    '-c',
    'gpg.program=',
    '-c',
    'gpg.ssh.program=',
    '-c',
    'gpg.x509.program='
  ];
  for (const name of discoverFilterNames(workspaceRoot)) {
    for (const key of ['clean', 'smudge', 'process']) argv.push('-c', `filter.${name}.${key}=`);
    argv.push('-c', `filter.${name}.required=false`);
  }
  if (sub === 'status') argv.push('--no-optional-locks');
  argv.push(sub, ...injected, ...rest);
  return { argv };
}

function scrubGitEnv(base) {
  const env = { ...(base || {}) };
  for (const key of Object.keys(env)) {
    const upper = key.toUpperCase();
    if (SCRUB_EXACT.has(upper) || /^GIT_CONFIG_KEY_\d+$/.test(upper) || /^GIT_CONFIG_VALUE_\d+$/.test(upper)) {
      delete env[key];
    }
  }
  env.GIT_TERMINAL_PROMPT = '0';
  return env;
}

module.exports = {
  GIT_SUBCOMMANDS,
  validateGitArgs,
  buildGitArgv,
  discoverFilterNames,
  scrubGitEnv,
  isBlockedGitArg,
  pathspecDenial
};
