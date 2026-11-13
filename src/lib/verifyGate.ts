import type { DeliveryStack } from './deliveryIntent';
import { verifyCommandForStack } from './deliveryIntent';

/** How many compiler errors to show the model. The rest are a count, not a tail slice. */
export const VERIFY_ERROR_PREVIEW = 25;

export interface CompilerError {
  file: string;
  line?: number;
  code?: string;
  message: string;
}

export interface VerifyResult {
  ok: boolean;
  command: string;
  output: string;
  errors: CompilerError[];
  fingerprint: string;
}

/** A command timed out, or reported any `Exit code:` that is not exactly 0 (including `null` and `-1`). */
export function commandOutputFailed(output: string): boolean {
  const t = output || '';
  if (/timed out/i.test(t)) return true;
  for (const m of t.matchAll(/Exit code:\s*([^\s,;)]+)/gi)) {
    if (m[1] !== '0') return true;
  }
  return false;
}

/** Detect failed verify from tool/terminal text (exit codes + compiler idioms). */
export function verifyOutputFailed(output: string): boolean {
  const t = output || '';
  if (commandOutputFailed(t)) return true;
  if (/error TS\d+/i.test(t)) return true;
  if (/could not compile/i.test(t)) return true;
  if (/^error(\[|:)/im.test(t)) return true;
  if (/error: could not/i.test(t)) return true;
  if (/FAILED/i.test(t) && /npm ERR!/i.test(t)) return true;
  return false;
}

const ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\/)/;

/**
 * The text before `(line,col)` / `:line:` can carry prose ("…compilation errors: src/App.tsx").
 * Keep only the path: the part after the last backtick or ": " separator, then the drive-letter
 * path or last whitespace-free token if spaces remain. Null when no path-like token is left.
 */
function pathFromErrorPrefix(prefix: string): string | null {
  let p = (prefix || '').trim();
  const cut = Math.max(p.lastIndexOf('`'), p.lastIndexOf(': '));
  if (cut >= 0) p = p.slice(cut + (p[cut] === '`' ? 1 : 2));
  p = p.trim().replace(/^["'(\[]+|["')\]]+$/g, '');
  if (!p) return null;
  if (!/\s/.test(p) || ABSOLUTE_PATH.test(p)) return p;
  const drive = /(?:^|\s)([A-Za-z]:[\\/].*)$/.exec(p);
  if (drive) return drive[1];
  const token = /(?:^|\s)([^\s`'"()]+\.[A-Za-z0-9]+)$/.exec(p);
  return token ? token[1] : null;
}

function looksLikeFilePath(file: string): boolean {
  const f = (file || '').trim();
  if (!f || f.length > 300 || /[`\r\n\u0000]/.test(f)) return false;
  return !/\s/.test(f) || ABSOLUTE_PATH.test(f);
}

export function parseCompilerErrors(output: string): CompilerError[] {
  const errors: CompilerError[] = [];
  const seen = new Set<string>();
  const lines = (output || '').split(/\r?\n/);

  // TypeScript: path(line,col): error TSxxxx: message
  const tsRe = /^(.+?)\((\d+),\d+\):\s*error\s+(TS\d+):\s*(.+)$/i;
  // Rust: --> path:line:col  OR  error[E0xxx]: message then --> file
  const rustArrow = /^\s*-->\s+([^:]+):(\d+):(\d+)/;
  const rustError = /^error(?:\[([^\]]+)\])?:\s*(.+)$/i;
  // Generic: path:line: message
  const generic = /^([^:\s][^:]*\.[a-zA-Z0-9]+):(\d+)(?::\d+)?:\s*(?:error:\s*)?(.+)$/;

  let pendingRust: { code?: string; message: string } | null = null;

  for (const raw of lines) {
    const line = raw.trimEnd();
    let m = tsRe.exec(line);
    const tsFile = m ? pathFromErrorPrefix(m[1]) : null;
    if (m && tsFile) {
      const key = `${tsFile}:${m[2]}:${m[3]}`;
      if (!seen.has(key)) {
        seen.add(key);
        errors.push({
          file: tsFile.replace(/\\/g, '/'),
          line: Number(m[2]),
          code: m[3],
          message: m[4].trim()
        });
      }
      pendingRust = null;
      continue;
    }

    m = rustError.exec(line.trim());
    if (m) {
      pendingRust = { code: m[1], message: m[2].trim() };
      continue;
    }

    m = rustArrow.exec(line);
    if (m && pendingRust) {
      const key = `${m[1]}:${m[2]}:${pendingRust.code || pendingRust.message.slice(0, 40)}`;
      if (!seen.has(key)) {
        seen.add(key);
        errors.push({
          file: m[1].replace(/\\/g, '/'),
          line: Number(m[2]),
          code: pendingRust.code,
          message: pendingRust.message
        });
      }
      pendingRust = null;
      continue;
    }

    m = generic.exec(line.trim());
    const genericFile = m ? pathFromErrorPrefix(m[1]) : null;
    if (m && genericFile && /error|expected|cannot|undefined/i.test(m[3])) {
      const key = `${genericFile}:${m[2]}:${m[3].slice(0, 40)}`;
      if (!seen.has(key)) {
        seen.add(key);
        errors.push({
          file: genericFile.replace(/\\/g, '/'),
          line: Number(m[2]),
          message: m[3].trim()
        });
      }
    }
  }

  return errors.slice(0, 200);
}

/** Drop line/column noise so the same diagnostic on a different line hashes the same. */
function fingerprintMessage(message: string): string {
  return (message || '')
    .replace(/\(\d+\s*,\s*\d+\)/g, '')
    .replace(/:\d+:\d+\b/g, '')
    .replace(/\bline\s+\d+\b/gi, '')
    .replace(/\bcol(?:umn)?\s+\d+\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function errorFingerprint(errors: CompilerError[]): string {
  if (!errors.length) return 'none';
  const parts = errors
    .map(e => {
      const file = (e.file || '').replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
      const code = (e.code || '').trim().toUpperCase();
      return `${file}|${code}|${fingerprintMessage(e.message)}`;
    })
    .sort();
  let h = 0;
  const s = parts.join('||');
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return `e${Math.abs(h).toString(36)}_${parts.length}`;
}

const NPM_INSTALL = /^\s*npm\s+(?:install|i|ci)\b/i;
const NPX_TSC = /^\s*npx\b[\s\S]*\btsc\b/i;

/** `npx tsc` may download a compiler. Verify must not use it. */
export function isNpxTscCommand(command: string | null | undefined): boolean {
  return NPX_TSC.test(command || '');
}

/** True when this verify command is a TypeScript compiler invocation, not `npm run …`. */
export function typescriptVerifyUsesCompiler(command: string | null | undefined): boolean {
  const c = (command || '').trim();
  if (!c || /\bnpm\s+run\b/i.test(c)) return false;
  return /\btsc\b/i.test(c);
}

/** PowerShell call of the project's local tsc shim. `binRel` is relative to the workspace. */
export function localTscPowerShellCommand(binRel: string): string {
  const rel = binRel.replace(/\//g, '\\').replace(/^\\+/, '');
  return `& ".\\${rel}" --noEmit --incremental --tsBuildInfoFile ".localagents/tsconfig.tsbuildinfo"`;
}

export const DEPENDENCY_RETRY_MESSAGE = 'install dependencies (npm install) and retry';

/** Missing modules or type packages. Installing deps is the user's next step, not another rewrite. */
export function typesCannotResolve(output: string | null | undefined): boolean {
  return /TS2307|TS2688|cannot find module|cannot find type definition file/i.test(output || '');
}

export function annotateMissingDependencies(output: string): string {
  const text = output || '';
  if (!typesCannotResolve(text) || text.includes(DEPENDENCY_RETRY_MESSAGE)) return text;
  return `${text}\n${DEPENDENCY_RETRY_MESSAGE}`;
}

/** Verify must not mutate the workspace. `npm install` / `npm ci` are not checks. */
export function isNpmInstallCommand(command: string | null | undefined): boolean {
  return NPM_INSTALL.test(command || '');
}

/**
 * Exactly one verify command for the stack.
 * A stored `npm install` is ignored. TypeScript defaults to incremental `tsc`,
 * not `tsc` plus `npm run build`. Callers must not also run typecheckWorkspace.
 */
export function resolveVerifyCommand(
  stack: DeliveryStack,
  preferred?: string | null
): string | null {
  const pref = (preferred || '').trim();
  if (pref && !isNpmInstallCommand(pref) && !isNpxTscCommand(pref)) return pref;
  if (stack === 'rust') return 'cargo check';
  return verifyCommandForStack(stack);
}

export interface VerifyCommandPlan {
  command: string | null;
  /** Always false — do not also invoke typecheckWorkspace or a second build. */
  runSeparateTypecheck: false;
  rejectedInstall: boolean;
}

export function planStackVerify(
  stack: DeliveryStack,
  preferred?: string | null
): VerifyCommandPlan {
  const pref = (preferred || '').trim();
  const rejectedInstall = isNpmInstallCommand(pref);
  return {
    command: resolveVerifyCommand(stack, rejectedInstall ? null : pref),
    runSeparateTypecheck: false,
    rejectedInstall
  };
}

/** Missing workspace is a failed verify, not a pass. */
export function missingWorkspaceVerifyResult(detail?: string): VerifyResult {
  return {
    ok: false,
    command: '',
    output: detail?.trim() || 'Verify failed: no workspace is open.',
    errors: [],
    fingerprint: 'no-workspace'
  };
}

/**
 * Preconditions for a verify run. AgentChat `runProjectVerify` (~5029) should use this
 * instead of returning ok:true for an empty path, and should run `command` only
 * (runSeparateTypecheck is false — do not also call typecheckWorkspace).
 */
export function beginVerify(input: {
  workspacePath?: string | null;
  stack: DeliveryStack;
  preferred?: string | null;
}):
  | { failure: VerifyResult }
  | { command: string; runSeparateTypecheck: false } {
  if (!input.workspacePath?.trim()) {
    return { failure: missingWorkspaceVerifyResult() };
  }
  const planned = planStackVerify(input.stack, input.preferred);
  if (!planned.command) {
    return {
      failure: {
        ok: false,
        command: '',
        output: `Verify failed: no verify command for stack ${input.stack}.`,
        errors: [],
        fingerprint: 'no-command'
      }
    };
  }
  return { command: planned.command, runSeparateTypecheck: false };
}

export function formatErrorsForCoder(errors: CompilerError[], rawOutput: string): string {
  if (!errors.length) {
    const lines = (rawOutput || '').split(/\r?\n/);
    const shown = lines.slice(0, VERIFY_ERROR_PREVIEW);
    const more = lines.length - shown.length;
    return `Compiler / verify output (first lines):\n\`\`\`\n${shown.join('\n')}${
      more > 0 ? `\n…and ${more} more` : ''
    }\n\`\`\``;
  }
  const shown = errors.slice(0, VERIFY_ERROR_PREVIEW);
  const more = errors.length - shown.length;
  const listed = shown
    .map(e => `- \`${e.file}\`${e.line ? `:${e.line}` : ''}${e.code ? ` [${e.code}]` : ''}: ${e.message}`)
    .join('\n');
  const files = [...new Set(errors.map(e => e.file))].slice(0, 12);
  return `### Compiler errors (fix these files only)
${listed}${more > 0 ? `\n…and ${more} more` : ''}

Files to edit: ${files.map(f => `\`${f}\``).join(', ')}`;
}

export function filesFromErrors(errors: CompilerError[]): string[] {
  return [...new Set(errors.filter(e => looksLikeFilePath(e.file)).map(e => e.file.trim().replace(/\\/g, '/')))].slice(0, 12);
}
