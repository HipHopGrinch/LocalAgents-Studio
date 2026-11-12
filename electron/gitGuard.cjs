/**
 * Pure git argv / env guard for the in-app git:run channel.
 * No Electron dependency so scripts/git-run.selftest.cjs can spawn git with the
 * same argv and environment the main process uses.
 *
 * Repository hooks are not run. core.hooksPath points at an empty directory the
 * app controls. That is intentional: a workspace pre-commit hook must not execute
 * with the app's privileges.
 */
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
    'alias.log='
  ];
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
  scrubGitEnv,
  isBlockedGitArg,
  pathspecDenial
};
