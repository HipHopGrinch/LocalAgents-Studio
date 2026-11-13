import { ChatMessage, ToolCall } from '../types';
import { applyEdits, formatToolResult, parseEditBlocks, READ_ONLY_TOOLS } from './tools';
import { shouldRejectPlannerWrite } from './swarmContract';
import { shadowOwnedPath } from './projectBrain';
import { coderModelToRewarm, pickImageTarget, placeholderSvg } from './imageRouting';
import { pinnedNumCtx } from './contextSize';
import { symbolHitsForQuery, type RepoMap } from './repoMap';
import { commandOutputFailed } from './verifyGate';

/** Fallback when settings.maxAgentSteps is missing. */
export const MAX_TOOL_CONTINUATIONS = 12;
/** Auto self-correct rounds after a failed terminal command (then stop). */
export const MAX_COMMAND_FIX_ATTEMPTS = 2;
/** Failed edit/write re-prompts before the turn stops. */
export const MAX_WRITE_FIX_ATTEMPTS = 2;
/**
 * Max times we re-prompt after read/list/search with no write.
 * Prevents endless read_file loops (Reviewer/Coder "analyzing" forever).
 */
export const MAX_READ_ONLY_CONTINUES = 2;

/** Bound the inner tool loop to settings.maxAgentSteps (default 12). */
export function toolContinuationLimit(maxAgentSteps?: number): number {
  const n = typeof maxAgentSteps === 'number' && maxAgentSteps > 0 ? Math.floor(maxAgentSteps) : MAX_TOOL_CONTINUATIONS;
  return Math.max(4, Math.min(n, 24));
}

/** `git` or `git.exe`, then any global options (`-C x`, `-c k=v`) up to the subcommand. */
const GIT = String.raw`(?<![\w.\-])git(?:\.exe)?(?![\w.\-])[^\n;&|]*?`;

const DESTRUCTIVE_CMD = new RegExp(
  [
    String.raw`\brm\s+-rf\b`,
    String.raw`\bformat\s+[a-z]:`,
    String.raw`\b(?:format-volume|clear-disk|initialize-disk|remove-partition)\b`,
    String.raw`\bdiskpart\b`,
    String.raw`\bmkfs\b`,
    String.raw`\bdd\s+if=`,
    String.raw`\bshutdown\b`,
    String.raw`\breboot\b`,
    `${GIT}\\bpush\\b[^\\n]*(?:--force|\\s-f\\b)`,
    `${GIT}\\breset\\b[^\\n]*--hard`,
    `${GIT}\\bclean\\b[^\\n]*-[a-z]*f`,
    `${GIT}\\bcheckout\\b[^\\n]*\\s--\\s+\\.`
  ].join('|'),
  'i'
);

/** `rm`, `del`, `rd`, `erase`, `rmdir`, `ri` and `remove-item` are one group in PowerShell. */
const DELETE_ALIAS = /(?<![\w.\-\\/:])(?<!\bgit(?:\.exe)? )(?:remove-item|rmdir|erase|del|rm|rd|ri)(?=\s|$)/i;
const RECURSE_FLAG = /\s-(?:r|re|rec|recu|recur|recurs|recurse|rf|fr)(?![\w-])|\s\/s(?![\w-])/i;

/** PowerShell / cmd recursive deletes, with or without -Force. */
function isDestructiveDelete(cmd: string): boolean {
  const c = cmd.replace(/\s+/g, ' ');
  return DELETE_ALIAS.test(c) && RECURSE_FLAG.test(c);
}

/** Encoded PowerShell, Invoke-Expression, and cmd /c wrappers hide a destructive payload. */
function isIndirectShell(cmd: string): boolean {
  const c = cmd || '';
  if (/(?:^|[\s;&|(])(?:-|\/)(?:encodedcommand|enc)\b/i.test(c)) return true;
  if (/\b(?:invoke-expression|iex)\b/i.test(c)) return true;
  if (/\bcmd(?:\.exe)?\s*\/c\b/i.test(c)) return true;
  if (/\b(?:powershell|pwsh)(?:\.exe)?\b[^\n]*\s-(?:e|ec|en|enc|encodedcommand)\b/i.test(c)) return true;
  if (/\bfrombase64string\b/i.test(c)) return true;
  if (/\bdownloadstring\b/i.test(c)) return true;
  return false;
}

export function isDestructiveCommand(cmd: string): boolean {
  return DESTRUCTIVE_CMD.test(cmd) || isDestructiveDelete(cmd) || isIndirectShell(cmd);
}

export type ToolResultTier = 'tight' | 'standard' | 'wide';

export function continuationCharCap(tier: ToolResultTier = 'standard'): number {
  if (tier === 'tight') return 8000;
  if (tier === 'wide') return 32000;
  return 16000;
}

/** Error lines plus a head and tail, capped by fit tier. Short results pass through. */
export function capToolResultText(text: string, tier: ToolResultTier = 'standard'): string {
  const raw = text || '';
  const cap = continuationCharCap(tier);
  if (raw.length <= cap) return raw;
  const lines = raw.split(/\r?\n/);
  const errorLines = lines.filter(l => /\berror\b|exception|\bTS\d+\b|failed/i.test(l)).slice(0, 40);
  const head = lines.slice(0, 40);
  const tail = lines.slice(-40);
  const overlap = lines.length <= 80 ? lines.length : 80;
  const middle = Math.max(0, lines.length - overlap);
  const chunks = [
    errorLines.length ? errorLines.join('\n') : '',
    head.join('\n'),
    middle > 0 ? `…and ${middle} more lines` : '',
    lines.length > 80 ? tail.join('\n') : ''
  ].filter(Boolean);
  let out = chunks.join('\n');
  if (out.length > cap) {
    out = `${out.slice(0, Math.max(0, cap - 32))}\n…and ${lines.length} more lines`;
  }
  return out;
}

/** Same rule as parseResponse: drop closed and unclosed think blocks. */
export function stripThinkingForHistory(raw: string): string {
  return (raw || '').replace(/<think>([\s\S]*?)(<\/think>|$)/gi, '').trim();
}

/** History must not re-send full write_file bodies. */
export function omitWriteFileBodies(content: string): string {
  return (content || '').replace(/<write_file\b([^>]*)>[\s\S]*?(?:<\/write_file\s*>|$)/gi, (_m, attrs) => {
    const path =
      /\bpath\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] ||
      /\bpath\s*=\s*'([^']*)'/i.exec(attrs)?.[1] ||
      'file';
    return `<write_file path="${path}">(body omitted)</write_file>`;
  });
}

function readHistoryLines(message: ChatMessage): string[] {
  const calls = message.toolCalls || [];
  const lines: string[] = [];
  for (const tool of calls) {
    if (tool.name !== 'read_file' || tool.status !== 'done') continue;
    const n = (tool.result || '').length ? (tool.result || '').split(/\r?\n/).length : 0;
    lines.push(`Read ${tool.args?.path || 'file'} (${n} lines)`);
  }
  return lines;
}

function lineScore(a: string, b: string): number {
  const x = a.trim();
  const y = b.trim();
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.8;
  let i = 0;
  const n = Math.min(x.length, y.length);
  while (i < n && x[i] === y[i]) i++;
  return i / Math.max(x.length, y.length);
}

/** Nearest file lines when a SEARCH block misses. The matcher itself stays in tools.ts. */
export function nearestSearchHint(fileText: string, search: string): string {
  const fileLines = (fileText || '').replace(/\r\n/g, '\n').split('\n');
  const needles = (search || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
  if (!fileLines.length || !needles.length) return 'Nearest lines: (none)';
  let best = 0;
  let bestScore = -1;
  const head = needles[0];
  for (let i = 0; i < fileLines.length; i++) {
    const score = lineScore(fileLines[i], head);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  const from = Math.max(0, best - 2);
  const to = Math.min(fileLines.length, best + Math.max(needles.length, 1) + 2);
  const body = fileLines
    .slice(from, to)
    .map((l, i) => `${from + i + 1}| ${l}`)
    .join('\n');
  return `Nearest lines:\n${body}`;
}

export function formatEditMismatch(
  fileText: string,
  body: string,
  error: string,
  applied = 0
): string {
  const base = `Diff failed: ${error}`;
  if (!/not found|no valid search/i.test(error || '')) return base;
  const blocks = parseEditBlocks(body);
  const search = blocks[applied]?.search || blocks[0]?.search || '';
  if (!search.trim()) return base;
  return `${base}\n${nearestSearchHint(fileText, search)}`;
}

export interface EditRepeatGuard {
  seen: Set<string>;
  order: string[];
}

export function createEditRepeatGuard(): EditRepeatGuard {
  return { seen: new Set(), order: [] };
}

const defaultEditGuard = createEditRepeatGuard();

export function resetEditRepeatGuard(guard: EditRepeatGuard = defaultEditGuard): void {
  guard.seen.clear();
  guard.order.length = 0;
}

function fnv32(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

function normalizePatchText(text: string): string {
  return (text || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(l => l.trimEnd())
    .join('\n')
    .trim();
}

/** Identity of one edit: normalized SEARCH (or full write body) plus the resulting bytes. */
export function editOutcomeKey(path: string, requestBody: string, outcome: string): string {
  const blocks = parseEditBlocks(requestBody);
  const searchNorm = (blocks.length ? blocks.map(b => b.search) : [requestBody])
    .map(normalizePatchText)
    .join('\n<<<\n');
  const file = (path || '').replace(/\\/g, '/').toLowerCase();
  return `${file}|${fnv32(searchNorm)}|${fnv32(normalizePatchText(outcome))}`;
}

/** @returns true when this exact edit/result was already seen. */
export function rememberEditOutcome(guard: EditRepeatGuard, key: string): boolean {
  if (guard.seen.has(key)) return true;
  guard.seen.add(key);
  guard.order.push(key);
  while (guard.order.length > 200) {
    const old = guard.order.shift();
    if (old) guard.seen.delete(old);
  }
  return false;
}

export const REPEATED_EDIT_STOP =
  'REPEATED_EDIT: This is the same edit and the same file result as a previous attempt. Stop. Do not retry this SEARCH/REPLACE or write the same bytes.';

export function isRepeatedEditStop(result?: string): boolean {
  return (result || '').includes('REPEATED_EDIT:');
}

function editGuardOf(deps: ToolExecutorDeps): EditRepeatGuard {
  return deps.editProgress || defaultEditGuard;
}

function editKey(path: string, requestBody: string, outcome: string): string {
  return editOutcomeKey(path, requestBody, outcome);
}

function repeatedEditResult(
  deps: ToolExecutorDeps,
  path: string,
  requestBody: string,
  outcome: string
): string | null {
  return editGuardOf(deps).seen.has(editKey(path, requestBody, outcome)) ? REPEATED_EDIT_STOP : null;
}

function commitEditOutcome(
  deps: ToolExecutorDeps,
  path: string,
  requestBody: string,
  outcome: string
): void {
  rememberEditOutcome(editGuardOf(deps), editKey(path, requestBody, outcome));
}

/** Run jobs concurrently and write each result back to its original index. */
export async function fulfillInOrder<T>(
  slots: T[],
  jobs: { index: number; run: () => Promise<T> }[]
): Promise<T[]> {
  const next = slots.slice();
  await Promise.all(
    jobs.map(async job => {
      next[job.index] = await job.run();
    })
  );
  return next;
}

export function commandSignature(tool: ToolCall): string {
  return (tool.body || tool.args?.command || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function failedCommandSignatures(tools: ToolCall[]): string[] {
  return tools
    .filter(t => t.name === 'run_command' && t.status === 'error')
    .map(commandSignature)
    .filter(Boolean);
}

export interface ToolExecutorDeps {
  workspacePath: string;
  onApplyFileWrite: (filePath: string, content: string) => Promise<boolean>;
  onExecuteToolCommand: (command: string) => Promise<string>;
  nodes?: import('../types').EndpointNode[];
  searxngUrl?: string;
  /** Live owned-file list so writes cannot invent a parallel module. */
  getOwnedFiles?: () => string[];
  /** Cheap repo map so search can lead with symbol hits. */
  getRepoMap?: () => RepoMap | null;
  /** Local MCP servers JSON from settings. Empty = MCP calls fail closed. */
  mcpServersJson?: string;
  /** Same-edit detector for this run. Omit to use the process-wide guard. */
  editProgress?: EditRepeatGuard;
  /**
   * Fit tier for continuation tool results. AgentChat should pass this into
   * `buildContinuationUserPrompt` as `{ tier }` once the routed model is known.
   */
  toolResultTier?: ToolResultTier;
  /** Called once with the finished tool. Must not change the result. */
  onTool?: (tool: ToolCall) => void;
}

/** Execute one tool without mutating the input; returns a new ToolCall. */
export async function executeTool(tool: ToolCall, deps: ToolExecutorDeps): Promise<ToolCall> {
  const finished = await executeToolBody(tool, deps);
  try {
    deps.onTool?.(finished);
  } catch {
    /* observers must not change the tool result */
  }
  return finished;
}

async function executeToolBody(tool: ToolCall, deps: ToolExecutorDeps): Promise<ToolCall> {
  if (tool.status === 'done') return tool;

  let next: ToolCall = { ...tool, status: 'running' };

  try {
    if (tool.name === 'write_file') {
      const filePath = tool.args?.path || 'file';
      let content = tool.body || '';
      if (shouldRejectPlannerWrite(filePath, content)) {
        return {
          ...next,
          status: 'error',
          result: `Rejected write to ${filePath}: body is a plan/review essay, not source. Edit the real file with valid code only.`
        };
      }
      const shadow = shadowOwnedPath(deps.getOwnedFiles?.() || [], filePath);
      if (shadow) {
        return {
          ...next,
          status: 'error',
          result: `Rejected ${filePath}: that module already exists as ${shadow}. Edit ${shadow} instead of creating a second copy.`
        };
      }
      // Ensure JSON files never have accidental markdown code fence wrappers
      if (filePath.toLowerCase().endsWith('.json') && content.trim().startsWith('```')) {
        content = content.replace(/^\s*```[a-zA-Z0-9_\-\+#]*[ \t]*\r?\n?/, '').replace(/\r?\n?```\s*$/, '');
      }
      const repeatedWrite = repeatedEditResult(deps, filePath, content, content);
      if (repeatedWrite) {
        return { ...next, status: 'error', result: repeatedWrite };
      }
      const ok = await deps.onApplyFileWrite(filePath, content);
      if (ok) commitEditOutcome(deps, filePath, content, content);
      return {
        ...next,
        status: ok ? 'done' : 'error',
        result: ok ? `Wrote file ${filePath}` : `Failed to write file ${filePath}`
      };
    }

    if (tool.name === 'edit_file') {
      const filePath = tool.args?.path || 'file';
      const body = tool.body || '';
      if (!window.electronAPI) {
        return { ...next, status: 'error', result: 'Electron API unavailable' };
      }
      // Route through tools:exec so resolveScoped enforces the workspace boundary.
      const readRes = await window.electronAPI.execTool(deps.workspacePath, 'read_file', {
        path: filePath,
        raw: true
      });
      if (readRes.error || readRes.content === undefined) {
        return { ...next, status: 'error', result: readRes.error || `Could not read ${filePath}` };
      }
      const editRes = applyEdits(readRes.content, body);
      if (editRes.content === undefined) {
        const mismatch = formatEditMismatch(readRes.content, body, editRes.error || 'edit failed', editRes.applied);
        const outcome = editRes.error || mismatch;
        const repeated = repeatedEditResult(deps, filePath, body, outcome);
        if (!repeated) commitEditOutcome(deps, filePath, body, outcome);
        return { ...next, status: 'error', result: repeated || mismatch };
      }
      const repeatedEdit = repeatedEditResult(deps, filePath, body, editRes.content);
      if (repeatedEdit) {
        return { ...next, status: 'error', result: repeatedEdit };
      }
      const ok = await deps.onApplyFileWrite(filePath, editRes.content);
      if (ok) commitEditOutcome(deps, filePath, body, editRes.content);
      return {
        ...next,
        status: ok ? 'done' : 'error',
        result: ok ? `Applied diff to ${filePath}` : `Failed to write patched ${filePath}`
      };
    }

    if (tool.name === 'run_command') {
      const cmd = tool.body || tool.args?.command || '';
      // Sanitize known-bad package names before any npm install the model runs.
      if (
        /npm\s+i(nstall)?\b/i.test(cmd) &&
        deps.workspacePath &&
        window.electronAPI?.installWorkspaceDeps
      ) {
        try {
          const res = await window.electronAPI.installWorkspaceDeps(deps.workspacePath, {
            timeoutMs: 300000
          });
          const rewrite = res.rewritten?.length
            ? `\nRewrote deps: ${res.rewritten.join('; ')}`
            : '';
          return {
            ...next,
            status: res.ok ? 'done' : 'error',
            result: res.ok
              ? `Exit code: 0${rewrite}\n${(res.output || '').slice(-8000)}`
              : `Exit code: ${res.code ?? 1}${res.timedOut ? ' (timed out)' : ''}${rewrite}\n${(
                  res.output ||
                  res.error ||
                  ''
                ).slice(-8000)}`
          };
        } catch (err: any) {
          return {
            ...next,
            status: 'error',
            result: err?.message || String(err)
          };
        }
      }
      if (isDestructiveCommand(cmd)) {
        return {
          ...next,
          status: 'error',
          result: `Blocked destructive command. Run it yourself if you really want it: ${cmd}`
        };
      }
      const output = await deps.onExecuteToolCommand(cmd);
      const failed = commandOutputFailed(output);
      return {
        ...next,
        status: failed ? 'error' : 'done',
        result: output || `Ran: ${cmd}`
      };
    }

    if (
      tool.name === 'read_file' ||
      tool.name === 'list_dir' ||
      tool.name === 'search' ||
      tool.name === 'read_terminal'
    ) {
      if (!window.electronAPI) {
        return { ...next, status: 'error', result: 'Electron API unavailable' };
      }
      const res = await window.electronAPI.execTool(deps.workspacePath, tool.name, tool.args);
      if (res.error) {
        return { ...next, status: 'error', result: res.error };
      }
      const raw = res.content || '(empty)';
      if (tool.name === 'search') {
        const q = tool.args?.query || tool.body || '';
        const prefix = symbolHitsForQuery(deps.getRepoMap?.() || null, q);
        return { ...next, status: 'done', result: `${prefix}${raw}` };
      }
      return { ...next, status: 'done', result: raw };
    }

    if (tool.name === 'mcp_call') {
      if (!window.electronAPI?.mcpCall) {
        return { ...next, status: 'error', result: 'MCP API unavailable' };
      }
      let args: Record<string, unknown> = {};
      const rawBody = (tool.body || '').trim();
      if (rawBody) {
        try {
          const parsed = JSON.parse(rawBody);
          if (parsed && typeof parsed === 'object') args = parsed as Record<string, unknown>;
        } catch {
          args = { input: rawBody };
        }
      }
      const res = await window.electronAPI.mcpCall({
        serversJson: deps.mcpServersJson || '',
        server: tool.args?.server,
        method: tool.args?.tool ? 'tools/call' : 'tools/list',
        tool: tool.args?.tool,
        arguments: args
      });
      if (res.error) return { ...next, status: 'error', result: res.error };
      return { ...next, status: 'done', result: res.content || '(empty)' };
    }

    if (tool.name === 'web_search') {
      const query = tool.args?.query || tool.body || '';
      if (!window.electronAPI?.webSearch) {
        return { ...next, status: 'error', result: 'Web search API unavailable' };
      }
      const res = await window.electronAPI.webSearch(deps.searxngUrl || '', query);
      if (res.error) return { ...next, status: 'error', result: res.error };
      return { ...next, status: 'done', result: res.content || '(no results)' };
    }

    if (tool.name === 'generate_image') {
      const prompt = tool.args?.prompt || tool.body || 'placeholder';
      let rel = tool.args?.path || 'assets/generated.svg';
      const target = pickImageTarget(deps.nodes || []);
      if (!target || !window.electronAPI?.generateImage) {
        if (!rel.toLowerCase().endsWith('.svg')) rel = rel.replace(/\.[a-z0-9]+$/i, '') + '.svg';
        const ok = await deps.onApplyFileWrite(rel, placeholderSvg(prompt));
        return {
          ...next,
          status: ok ? 'done' : 'error',
          result: ok
            ? `No image-generation model is online. Wrote SVG placeholder to ${rel}`
            : `Failed to write placeholder ${rel}`
        };
      }
      const gen = await window.electronAPI.generateImage(target.node.url, target.model, prompt);
      if (!gen.ok || !gen.imageBase64) {
        if (!rel.toLowerCase().endsWith('.svg')) rel = rel.replace(/\.[a-z0-9]+$/i, '') + '.svg';
        const ok = await deps.onApplyFileWrite(rel, placeholderSvg(prompt));
        return {
          ...next,
          status: ok ? 'done' : 'error',
          result: ok
            ? `Image model ${target.model} on ${target.node.name} did not return a picture (${gen.error || 'empty'}). Wrote SVG placeholder to ${rel}`
            : `Image generation failed: ${gen.error || 'empty'}`
        };
      }
      if (!/\.(png|jpe?g|webp)$/i.test(rel)) rel = rel.replace(/\.[a-z0-9]+$/i, '') + '.png';
      const written = await window.electronAPI.execTool(deps.workspacePath, 'write_base64', {
        path: rel,
        content: gen.imageBase64
      });
      if (written.error) {
        return { ...next, status: 'error', result: written.error };
      }
      const rewarm = coderModelToRewarm(target);
      if (rewarm && window.electronAPI.warmModel) {
        const numCtx = pinnedNumCtx(target.node, rewarm.model);
        try {
          await window.electronAPI.warmModel(target.node.url, rewarm.model, numCtx);
        } catch {
          /* The picture is saved. The next coder turn reloads the model if warm failed. */
        }
      }
      return {
        ...next,
        status: 'done',
        result: `Wrote ${rel} using ${target.model} on ${target.node.name}`
      };
    }

    return { ...next, status: 'error', result: `Unknown tool: ${tool.name}` };
  } catch (err: any) {
    return { ...next, status: 'error', result: err?.message || String(err) };
  }
}

export function isWritableTool(name: string): boolean {
  return name === 'write_file' || name === 'edit_file';
}

function isPackageJsonToolPath(tool: ToolCall): boolean {
  const p = (tool.args?.path || '').replace(/\\/g, '/');
  return /(^|\/)package\.json$/i.test(p);
}

/**
 * After package.json is written/edited, install deps via Studio (sanitizes bad
 * names like react-three-fiber, runs npm install in the terminal).
 */
async function maybeInstallAfterPackageJsonWrite(
  tools: ToolCall[],
  deps: ToolExecutorDeps
): Promise<ToolCall[]> {
  const wrotePkg = tools.some(
    t =>
      isWritableTool(t.name) &&
      t.status === 'done' &&
      isPackageJsonToolPath(t)
  );
  if (!wrotePkg || !deps.workspacePath || !window.electronAPI?.installWorkspaceDeps) {
    return tools;
  }
  const alreadyInstalling = tools.some(
    t =>
      t.name === 'run_command' &&
      /npm\s+i(nstall)?\b/i.test(t.body || t.args?.command || '')
  );
  if (alreadyInstalling) return tools;

  const installTool: ToolCall = {
    id: `auto-npm-install-${Date.now()}`,
    name: 'run_command',
    args: { command: 'npm install' },
    body: 'npm install',
    status: 'running'
  };
  try {
    const res = await window.electronAPI.installWorkspaceDeps(deps.workspacePath, {
      timeoutMs: 300000
    });
    const rewrite = res.rewritten?.length ? `\nRewrote: ${res.rewritten.join('; ')}` : '';
    const finished: ToolCall = {
      ...installTool,
      status: res.ok ? 'done' : 'error',
      result: res.ok
        ? `Exit code: 0\n(auto) npm install after package.json${rewrite}\n${(res.output || '').slice(-4000)}`
        : `Exit code: ${res.code ?? 1}\n(auto) npm install failed${rewrite}\n${(
            res.output ||
            res.error ||
            ''
          ).slice(-4000)}`
    };
    notifyTool(deps, finished);
    return [...tools, finished];
  } catch (err: any) {
    const finished: ToolCall = {
      ...installTool,
      status: 'error',
      result: `(auto) npm install error: ${err?.message || err}`
    };
    notifyTool(deps, finished);
    return [...tools, finished];
  }
}

function notifyTool(deps: ToolExecutorDeps, tool: ToolCall): void {
  try {
    deps.onTool?.(tool);
  } catch {
    /* observers must not change the tool result */
  }
}

/** Auto-apply write_file and edit_file tools; returns updated tool list. */
export async function autoApplyWritableTools(
  tools: ToolCall[],
  deps: ToolExecutorDeps
): Promise<ToolCall[]> {
  const out: ToolCall[] = [];
  for (const tool of tools) {
    if (isWritableTool(tool.name) && tool.status !== 'done' && (tool.args?.path || tool.body)) {
      out.push(await executeTool(tool, deps));
    } else {
      out.push(tool);
    }
  }
  return maybeInstallAfterPackageJsonWrite(out, deps);
}

/** Stable key for identical inspect tools in one batch (path/query/terminal). */
export function readToolDedupeKey(tool: ToolCall): string | null {
  if (!READ_ONLY_TOOLS.includes(tool.name as any)) return null;
  if (tool.name === 'read_terminal') return 'read_terminal';
  if (tool.name === 'read_file' || tool.name === 'list_dir') {
    const path = (tool.args?.path || tool.body || '').replace(/\\/g, '/').trim().toLowerCase();
    return path ? `${tool.name}:${path}` : `${tool.name}:`;
  }
  if (tool.name === 'search') {
    const q = (tool.args?.query || tool.body || '').replace(/\s+/g, ' ').trim().toLowerCase();
    return q ? `search:${q}` : 'search:';
  }
  return `${tool.name}`;
}

/**
 * Collapse duplicate inspect tools (same path/query) so a model that spam-emits
 * the same <read_file> hundreds of times only executes once.
 */
export function collapseDuplicateReadTools(tools: ToolCall[]): ToolCall[] {
  const seen = new Set<string>();
  const out: ToolCall[] = [];
  for (const tool of tools) {
    const key = readToolDedupeKey(tool);
    if (!key) {
      out.push(tool);
      continue;
    }
    if (seen.has(key)) {
      if (tool.status === 'done' || tool.status === 'error') {
        out.push(tool);
        continue;
      }
      out.push({
        ...tool,
        status: 'done',
        result: `(skipped duplicate ${tool.name} — already captured this turn)`
      });
      continue;
    }
    seen.add(key);
    out.push(tool);
  }
  return out;
}

/**
 * True when the model is stuck repeating the same tool tag or line
 * (classic local-LLM collapse). Threshold is consecutive identical hits.
 */
export function detectRepeatedToolTagSpam(text: string, threshold = 8): boolean {
  if (!text || threshold < 3) return false;
  const re =
    /<(read_file|list_dir|search|read_terminal|write_file|edit_file|run_command)\b[^>]*\/?>/gi;
  let prev = '';
  let streak = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const tag = m[0].replace(/\s+/g, ' ').trim().toLowerCase();
    if (tag && tag === prev) {
      streak += 1;
      if (streak >= threshold) return true;
    } else {
      prev = tag;
      streak = 1;
    }
  }
  // Also catch non-tool line loops (same line emitted over and over).
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length >= threshold) {
    let lineStreak = 1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === lines[i - 1] && lines[i].length >= 12) {
        lineStreak += 1;
        if (lineStreak >= threshold) return true;
      } else {
        lineStreak = 1;
      }
    }
  }
  return false;
}

/** Run all pending read-only tools concurrently; results stay in call order. */
export async function runReadOnlyTools(
  tools: ToolCall[],
  deps: ToolExecutorDeps
): Promise<{ tools: ToolCall[]; hadReads: boolean }> {
  let hadReads = false;
  const seenKeys = new Set<string>();
  const collapsed = collapseDuplicateReadTools(tools);
  const out: ToolCall[] = collapsed.slice();
  const jobs: { index: number; run: () => Promise<ToolCall> }[] = [];

  for (let i = 0; i < collapsed.length; i++) {
    const tool = collapsed[i];
    const pending =
      READ_ONLY_TOOLS.includes(tool.name as (typeof READ_ONLY_TOOLS)[number]) &&
      tool.status !== 'done' &&
      tool.status !== 'error';
    if (!pending) {
      const key = readToolDedupeKey(tool);
      if (key && (tool.status === 'done' || tool.status === 'error')) seenKeys.add(key);
      continue;
    }
    const key = readToolDedupeKey(tool);
    if (key && seenKeys.has(key)) {
      hadReads = true;
      out[i] = {
        ...tool,
        status: 'done',
        result: `(skipped duplicate ${tool.name} — already captured this turn)`
      };
      continue;
    }
    if (key) seenKeys.add(key);
    hadReads = true;
    jobs.push({ index: i, run: () => executeTool(tool, deps) });
  }

  return { tools: await fulfillInOrder(out, jobs), hadReads };
}

export async function runAuxTools(tools: ToolCall[], deps: ToolExecutorDeps): Promise<ToolCall[]> {
  const out: ToolCall[] = [];
  for (const tool of tools) {
    if (
      (tool.name === 'web_search' || tool.name === 'generate_image') &&
      tool.status !== 'done' &&
      tool.status !== 'error'
    ) {
      out.push(await executeTool(tool, deps));
    } else {
      out.push(tool);
    }
  }
  return out;
}
export async function runCommandTools(
  tools: ToolCall[],
  deps: ToolExecutorDeps
): Promise<{ tools: ToolCall[]; hadCommands: boolean }> {
  let hadCommands = false;
  const out: ToolCall[] = [];
  for (const tool of tools) {
    if (
      tool.name === 'run_command' &&
      tool.status !== 'done' &&
      tool.status !== 'error' &&
      (tool.body || tool.args?.command)
    ) {
      hadCommands = true;
      out.push(await executeTool(tool, deps));
    } else {
      out.push(tool);
    }
  }
  return { tools: out, hadCommands };
}

export function replaceToolsInMessage(
  messages: ChatMessage[],
  messageId: string,
  tools: ToolCall[]
): ChatMessage[] {
  return messages.map(m => (m.id === messageId ? { ...m, toolCalls: tools } : m));
}

/** Tools whose results should be fed back into the next model turn. */
export function collectFeedbackTools(tools: ToolCall[]): ToolCall[] {
  return tools.filter(t => {
    if (t.status !== 'done' && t.status !== 'error') return false;
    if (READ_ONLY_TOOLS.includes(t.name as any) || t.name === 'run_command') return true;
    if (t.name === 'web_search' || t.name === 'generate_image') return true;
    if ((t.name === 'write_file' || t.name === 'edit_file') && t.status === 'error') return true;
    return false;
  });
}

export interface ContinueDecisionOpts {
  /** How many command-failure self-correct continuations already ran this turn. */
  commandFixAttempts?: number;
  /** Signatures of commands that already failed earlier in this turn. */
  prevFailedCmdSigs?: string[];
  /** Failed write/edit re-prompts already used. */
  writeFixAttempts?: number;
  /** How many read-only (inspect, no write) continues already used this turn. */
  readOnlyContinues?: number;
  /** Cap for read-only continues (default MAX_READ_ONLY_CONTINUES). Reviewer uses 1. */
  maxReadOnlyContinues?: number;
  /** Normalized fingerprint of the last read_terminal result this turn. */
  terminalFingerprint?: string;
}

/** True when read_terminal returned an empty Studio terminal buffer. */
export function isEmptyTerminalResult(result?: string): boolean {
  const text = (result || '').trim();
  if (!text) return true;
  if (/\(terminal is empty\)/i.test(text)) return true;
  if (/skipped duplicate read_terminal/i.test(text)) return true;
  if (/Terminal\s*\(\s*0\s*chars/i.test(text)) return true;
  // "Terminal (N chars...):\n" with nothing meaningful after the header
  const afterHeader = text.replace(/^Terminal\s*\([^)]*\)\s*:?\s*/i, '').trim();
  if (/^Terminal\b/i.test(text) && (!afterHeader || /^\(terminal is empty\)$/i.test(afterHeader))) {
    return true;
  }
  return false;
}

/** Stable fingerprint for comparing terminal snapshots across continues. */
export function terminalResultFingerprint(result?: string): string {
  return (result || '')
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 2000);
}

/** First real (non-duplicate) done read_terminal result in a batch. */
export function latestTerminalResult(tools: ToolCall[]): string | undefined {
  for (let i = tools.length - 1; i >= 0; i--) {
    const t = tools[i];
    if (t.name !== 'read_terminal' || t.status !== 'done') continue;
    if (/skipped duplicate read_terminal/i.test(t.result || '')) continue;
    return t.result;
  }
  return undefined;
}

/**
 * Continue the agent loop when:
 * - code inspect tools finished and no successful write yet (bounded), or
 * - a command failed and we still have a self-correct attempt left.
 * Stops if the same command fails again, the fix budget is spent, or too many
 * read-only continues (endless read_file loops).
 */
export function shouldContinueFromTools(
  tools: ToolCall[],
  opts: ContinueDecisionOpts = {}
): boolean {
  if (tools.some(t => isRepeatedEditStop(t.result))) {
    // One continuation so the model hears the stop, then halt.
    return (opts.writeFixAttempts ?? 0) < 1;
  }

  const doneTools = tools.filter(t => t.status === 'done' || t.status === 'error');
  const terminalOnly =
    doneTools.length > 0 && doneTools.every(t => t.name === 'read_terminal');
  if (terminalOnly) return false;

  const cmdFailed = tools.some(t => t.name === 'run_command' && t.status === 'error');
  const writeFailed = tools.some(
    t => (t.name === 'write_file' || t.name === 'edit_file') && t.status === 'error'
  );
  const hadTerminalDone = tools.some(
    t =>
      t.name === 'read_terminal' &&
      t.status === 'done' &&
      !/skipped duplicate read_terminal/i.test(t.result || '')
  );
  // Successful terminal snapshot already in hand — another auto-turn just re-reads it.
  if (hadTerminalDone && !cmdFailed && !writeFailed) return false;

  const termResult = latestTerminalResult(tools);
  if (termResult && opts.terminalFingerprint) {
    const fp = terminalResultFingerprint(termResult);
    if (fp && fp === opts.terminalFingerprint) return false;
  }

  const failedSigs = failedCommandSignatures(tools);
  if (failedSigs.length > 0) {
    const attempts = opts.commandFixAttempts ?? 0;
    if (attempts >= MAX_COMMAND_FIX_ATTEMPTS) return false;
    const prev = opts.prevFailedCmdSigs || [];
    // Same failing command again → stop (avoid retry loops)
    if (failedSigs.some(s => prev.includes(s))) return false;
    return true;
  }

  if (writeFailed && (opts.writeFixAttempts ?? 0) < MAX_WRITE_FIX_ATTEMPTS) return true;

  const wrote = tools.some(t => isWritableTool(t.name) && t.status === 'done');
  // read_terminal alone must not keep the loop alive
  const inspectedCode = tools.some(
    t =>
      (t.name === 'read_file' || t.name === 'list_dir' || t.name === 'search') &&
      t.status === 'done'
  );
  if (!(inspectedCode && !wrote)) return false;
  const maxReads = opts.maxReadOnlyContinues ?? MAX_READ_ONLY_CONTINUES;
  const used = opts.readOnlyContinues ?? 0;
  return used < maxReads;
}

/** True when this tool batch was exploration-only (no successful write/edit). */
export function isReadOnlyToolBatch(tools: ToolCall[]): boolean {
  const wrote = tools.some(t => isWritableTool(t.name) && t.status === 'done');
  if (wrote) return false;
  return tools.some(
    t =>
      (t.name === 'read_file' || t.name === 'list_dir' || t.name === 'search') &&
      t.status === 'done'
  );
}

export function buildContinuationUserPrompt(
  feedbackTools: ToolCall[],
  opts?: { finalCommandAttempt?: boolean; tier?: ToolResultTier }
): string {
  const tier = opts?.tier ?? 'standard';
  const shown = feedbackTools.map(t =>
    t.result ? { ...t, result: capToolResultText(t.result, tier) } : t
  );
  const resultsXml = shown.map(t => formatToolResult(t, { tier })).join('\n\n');
  if (shown.some(t => isRepeatedEditStop(t.result))) {
    return `Edit repeated:\n${resultsXml}\n\nYou repeated an edit that produced the same file result. Stop. Do not emit the same SEARCH/REPLACE or the same write_file body again. Say what is blocked in one short sentence.`;
  }
  const cmdFailed = feedbackTools.some(t => t.name === 'run_command' && t.status === 'error');
  const writeFailed = feedbackTools.some(
    t => (t.name === 'write_file' || t.name === 'edit_file') && t.status === 'error'
  );
  const hadCmd = feedbackTools.some(t => t.name === 'run_command');
  const terminalReads = feedbackTools.filter(t => t.name === 'read_terminal');
  const hadTerminal = terminalReads.length > 0;
  const emptyTerminal = terminalReads.some(
    t => t.status === 'done' && isEmptyTerminalResult(t.result)
  );

  if (cmdFailed) {
    if (opts?.finalCommandAttempt) {
      return `Terminal / command results:\n${resultsXml}\n\nPrevious fix attempt did not clear the error. Briefly explain what is still wrong and stop. Do NOT re-run the same failing command. Only emit a tool if you have a clearly different fix; otherwise reply with a short diagnosis only.`;
    }
    return `Terminal / command results:\n${resultsXml}\n\nA command failed. Make ONE concrete fix with <edit_file> or <write_file>, then optionally re-run once with <run_command> to verify. If you cannot fix it confidently, explain the error and stop — do not retry the same command repeatedly.`;
  }

  if (hadTerminal && !hadCmd) {
    if (emptyTerminal) {
      return `Terminal / command results:\n${resultsXml}\n\nThe Studio terminal buffer is empty. Do NOT call <read_terminal> again. If you need command output, run something with <run_command>; otherwise proceed without terminal context or stop.`;
    }
    return `Terminal / command results:\n${resultsXml}\n\nYou already have the terminal output. Do NOT call <read_terminal> again. Act on it (fix/write) or stop.`;
  }

  if (writeFailed) {
    const editFailed = feedbackTools.some(t => t.name === 'edit_file' && t.status === 'error');
    if (editFailed) {
      return `File edit failed:\n${resultsXml}\n\nThe SEARCH block could not be matched. Output the entire corrected file with <write_file path="..."> (full contents). Do not retry the same SEARCH/REPLACE. Do not repeat a destructive command.`;
    }
    return `File write failed:\n${resultsXml}\n\nFix the file with a corrected <write_file> for the same path. Do not repeat a destructive command.`;
  }

  if (hadCmd) {
    const termNote = emptyTerminal
      ? '\n\nNote: a later <read_terminal> was empty — do not call <read_terminal> again.'
      : '';
    return `Command / terminal results:\n${resultsXml}\n\nBased on this output, take the next required step if any; otherwise briefly confirm success and stop.${termNote}`;
  }

  return `Inspected workspace tool results:\n${resultsXml}\n\nYou already have the file contents above. Do NOT read the same files again. Take the next required action now (write/edit for Coder; <review_plan> for Reviewer; <plan_options> for Planner).`;
}

export type ApiChatMessage = {
  role: string;
  content: string;
  images?: string[];
};

export function historyForModel(
  messages: ChatMessage[],
  stripThinking: (raw: string) => string
): ApiChatMessage[] {
  return messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => {
      const stripped = stripThinkingForHistory(stripThinking(m.raw || m.display || ''));
      const content = [omitWriteFileBodies(stripped), ...readHistoryLines(m)]
        .filter(part => part && part.trim())
        .join('\n')
        .trim();
      const entry: ApiChatMessage = { role: m.role, content };
      if (m.role === 'user' && m.images && m.images.length > 0) {
        // Ollama expects raw base64 (no data: prefix)
        entry.images = m.images.map(img => {
          const i = img.indexOf('base64,');
          return i >= 0 ? img.slice(i + 7) : img;
        });
      }
      return entry;
    })
    .filter(m => m.content.trim().length > 0 || (m.images && m.images.length > 0));
}

