import type { DeliveryStack } from './deliveryIntent';
import { verifyCommandForStack } from './deliveryIntent';

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

/** Detect failed verify from tool/terminal text (exit codes + compiler idioms). */
export function verifyOutputFailed(output: string): boolean {
  const t = output || '';
  if (/Exit code:\s*(?!0\b)\d+/i.test(t)) return true;
  if (/error TS\d+/i.test(t)) return true;
  if (/could not compile/i.test(t)) return true;
  if (/^error(\[|:)/im.test(t)) return true;
  if (/error: could not/i.test(t)) return true;
  if (/FAILED/i.test(t) && /npm ERR!/i.test(t)) return true;
  return false;
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
    if (m) {
      const key = `${m[1]}:${m[2]}:${m[3]}`;
      if (!seen.has(key)) {
        seen.add(key);
        errors.push({
          file: m[1].replace(/\\/g, '/'),
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
    if (m && /error|expected|cannot|undefined/i.test(m[3])) {
      const key = `${m[1]}:${m[2]}:${m[3].slice(0, 40)}`;
      if (!seen.has(key)) {
        seen.add(key);
        errors.push({
          file: m[1].replace(/\\/g, '/'),
          line: Number(m[2]),
          message: m[3].trim()
        });
      }
    }
  }

  return errors.slice(0, 40);
}

export function errorFingerprint(errors: CompilerError[]): string {
  if (!errors.length) return 'none';
  const parts = errors
    .map(e => `${e.file}:${e.line || 0}:${e.code || ''}`)
    .sort();
  // Simple stable hash
  let h = 0;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return `e${Math.abs(h).toString(36)}_${parts.length}`;
}

export function resolveVerifyCommand(
  stack: DeliveryStack,
  preferred?: string | null
): string | null {
  if (preferred && preferred.trim()) return preferred.trim();
  if (stack === 'typescript') return 'npm run build';
  if (stack === 'rust') return 'cargo check';
  return verifyCommandForStack(stack);
}

export function formatErrorsForCoder(errors: CompilerError[], rawOutput: string): string {
  if (!errors.length) {
    return `Compiler / verify output (tail):\n\`\`\`\n${(rawOutput || '').slice(-2500)}\n\`\`\``;
  }
  const listed = errors
    .slice(0, 20)
    .map(e => `- \`${e.file}\`${e.line ? `:${e.line}` : ''}${e.code ? ` [${e.code}]` : ''}: ${e.message}`)
    .join('\n');
  const files = [...new Set(errors.map(e => e.file))].slice(0, 12);
  return `### Compiler errors (fix these files only)
${listed}

Files to edit: ${files.map(f => `\`${f}\``).join(', ')}

Raw verify tail:
\`\`\`
${(rawOutput || '').slice(-1800)}
\`\`\``;
}

export function filesFromErrors(errors: CompilerError[]): string[] {
  return [...new Set(errors.map(e => e.file.replace(/\\/g, '/')))].slice(0, 12);
}
