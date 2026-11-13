/** Paste-back log of a Conductor session. Prompt and reply bodies are not stored. */

import type { ChatEvent } from '../types';

const DEFAULT_MAX_EVENTS = 600;
const DEFAULT_MAX_CHARS = 200_000;
const TOOL_RESULT_MAX = 1500;
const VERIFY_OUTPUT_MAX = 4000;
const NOTE_MAX = 1500;
const INLINE_MAX = 160;
const TOP_ERRORS = 5;
const TOP_TURNS = 5;
const MAX_ASSIGNMENTS = 200;
const MAX_SETTINGS = 40;

const RUN_LOG_KINDS = [
  'run-start',
  'run-stop',
  'user',
  'turn',
  'route',
  'context',
  'tool',
  'verify',
  'verdict',
  'heal',
  'escalate',
  'pause',
  'notice',
  'swarm-assign',
  'error',
  'info'
] as const;

export type RunLogKind = (typeof RUN_LOG_KINDS)[number];

export type RunLogUserAction =
  | 'send'
  | 'stop'
  | 'play'
  | 'skip'
  | 'retry'
  | 'undo'
  | 'compact'
  | 'edit'
  | 'auto';

export type RunLogRouteAction = 'retry' | 'failover' | 'skip' | 'stream-retry' | 'pin' | 'fallback';

export type RunLogContextAction = 'fit' | 'resubmit' | 'compact';

export type RunLogVerdictResult = 'yay' | 'nay' | 'missing';

export type RunLogSettingValue = string | number | boolean;

export type RunLogSettings = Record<string, RunLogSettingValue>;

export interface RunLogAssignment {
  file?: string;
  node?: string;
  model?: string;
  wave?: number;
  skippedReason?: string;
  frontierBackup?: boolean;
}

export interface RunLogOptions {
  maxEvents?: number;
  maxChars?: number;
  now?: () => number;
}

export interface RunLogStartInfo {
  runId: number;
  conversationId: string;
  label?: string;
  settings?: RunLogSettings;
}

export interface RunLogFormatOptions {
  title?: string;
  header?: Record<string, string | number | boolean>;
}

/** Map `ChatEvent['stats']` durations (nanoseconds) onto turn fields. */
export interface RunLogModelStats {
  promptEvalCount?: number;
  evalCount?: number;
  doneReason?: string;
  totalDurationNs?: number;
  evalDurationNs?: number;
  reasoningTokens?: number;
}

interface RunLogStamp {
  t?: number;
  runId?: number;
  conversationId?: string;
}

type RunLogBody =
  | { kind: 'run-start'; label?: string; settings?: RunLogSettings }
  | { kind: 'run-stop'; reason?: string }
  | { kind: 'user'; action: RunLogUserAction; text?: string; stepId?: string }
  | {
      kind: 'turn';
      phase?: string;
      role: string;
      nodeId?: string;
      nodeName?: string;
      model: string;
      numCtx?: number;
      promptBudget?: number;
      estPromptTokens?: number;
      promptEvalCount?: number;
      evalCount?: number;
      reasoningTokens?: number;
      /** Thinking mode requested for this turn: on/off, or a level such as `low`/`high`. */
      think?: boolean | string;
      doneReason?: string;
      totalDurationNs?: number;
      evalDurationNs?: number;
      wallMs?: number;
      aborted?: boolean;
      error?: string;
    }
  | {
      kind: 'route';
      action: RunLogRouteAction;
      text?: string;
      stepId?: string;
      nodeId?: string;
      nodeName?: string;
      model?: string;
    }
  | {
      kind: 'context';
      action: RunLogContextAction;
      text?: string;
      stepId?: string;
      numCtx?: number;
      promptBudget?: number;
      estPromptTokens?: number;
    }
  | {
      kind: 'tool';
      name: string;
      path?: string;
      status?: string;
      exitCode?: number;
      result?: string;
      stepId?: string;
    }
  | { kind: 'verify'; ok: boolean; fingerprint?: string; output?: string; stepId?: string }
  | { kind: 'verdict'; result: RunLogVerdictResult; text?: string; stepId?: string }
  | { kind: 'heal'; stepId?: string; attempt?: number; max?: number; fingerprint?: string; note?: string }
  | { kind: 'escalate'; text: string; stepId?: string }
  | { kind: 'pause'; text: string; stepId?: string }
  | { kind: 'notice'; text: string; stepId?: string }
  | { kind: 'swarm-assign'; assignments: RunLogAssignment[] }
  | { kind: 'error'; text: string; stepId?: string }
  | { kind: 'info'; text: string; stepId?: string };

export type RunLogInput = RunLogStamp & RunLogBody;

type StoredTurn = Extract<RunLogBody, { kind: 'turn' }> & { tokPerSec?: number };

export type RunLogEvent = { t: number; runId?: number; conversationId?: string } & (
  | Exclude<RunLogBody, { kind: 'turn' }>
  | StoredTurn
);

export interface RunLogFailureCounts {
  toolErrors: number;
  nonZeroExits: number;
  verifyFailures: number;
  nay: number;
  missingVerdicts: number;
  failovers: number;
  retries: number;
  contextResubmits: number;
  pauses: number;
  errors: number;
}

export interface RunLogTurnRollup {
  role: string;
  model: string;
  count: number;
  avgTokPerSec: number | null;
  evalTokens: number;
}

export interface RunLogRepeatedError {
  text: string;
  count: number;
}

export interface RunLogLongTurn {
  t: number;
  runId?: number;
  role: string;
  model: string;
  wallMs: number;
  evalCount: number;
  tokPerSec: number | null;
  doneReason?: string;
}

export interface RunLogStats {
  byKind: Record<RunLogKind, number>;
  failures: RunLogFailureCounts;
  /** Failures counted once per event. A failed command is not both a tool error and a non-zero exit. */
  failureTotal: number;
  turns: RunLogTurnRollup[];
  repeatedErrors: RunLogRepeatedError[];
  longestTurns: RunLogLongTurn[];
  dropped: number;
}

export interface RunLog {
  add(event: RunLogInput): void;
  events(): RunLogEvent[];
  clear(): void;
  startRun(info: RunLogStartInfo): void;
  endRun(runId: number, reason: string): void;
  formatMarkdown(opts?: RunLogFormatOptions): string;
  formatPlain(opts?: RunLogFormatOptions): string;
  stats(): RunLogStats;
}

interface ActiveRun {
  runId: number;
  conversationId?: string;
  label?: string;
  settings?: RunLogSettings;
}

interface InheritedIds {
  runId?: number;
  conversationId?: string;
}

interface EventView {
  line: string;
  detail?: string;
  fence: boolean;
}

interface RunAnchor {
  t: number;
  label?: string;
  conversationId?: string;
  settings?: RunLogSettings;
}

interface RollAcc {
  role: string;
  model: string;
  count: number;
  tokSum: number;
  tokN: number;
  evalTokens: number;
}

/** Secrets follow electron `redactLog`, plus Windows profile names collapsed to `<user>`. */
export function redactRunLogText(s: string): string {
  return collapseUserProfile(redactSecrets(String(s ?? '')));
}

const INSPECT_TOOL_NAMES = new Set(['read_file', 'search', 'list_dir', 'read_terminal']);
const WRITE_TOOL_NAMES = new Set(['write_file', 'edit_file']);
const COMMAND_TAIL = 800;

/** What a tool event may store. File bodies and command text stay out. */
export function shapeToolForRunLog(input: {
  name: string;
  status?: string;
  result?: string;
  exitCode?: number;
}): { result?: string; exitCode?: number } {
  const raw = typeof input.result === 'string' ? input.result : '';
  if (INSPECT_TOOL_NAMES.has(input.name)) {
    const lines = raw.length ? raw.split(/\r?\n/).length : 0;
    return { result: `${raw.length} bytes, ${lines} lines` };
  }
  if (WRITE_TOOL_NAMES.has(input.name)) {
    if (!toolStatusIsError(input.status)) return {};
    const message = raw.replace(/[ \t]+/g, ' ').trim();
    return message ? { result: message } : {};
  }
  if (input.name === 'run_command') {
    if (/blocked destructive command/i.test(raw)) return { result: 'blocked destructive command' };
    const stripped = stripCommandEcho(raw);
    if (!stripped.trim() || /^ran \(no output\)$/i.test(stripped.trim())) {
      return { result: 'ran (no output)' };
    }
    const exitCode = commandExitCode(input.exitCode, raw);
    const withoutExit = redactRunLogText(stripped.replace(/Exit code:\s*-?\d+\s*/i, '')).trim();
    const tail = withoutExit.length > COMMAND_TAIL ? withoutExit.slice(-COMMAND_TAIL) : withoutExit;
    return {
      ...(exitCode != null ? { exitCode } : {}),
      ...(tail ? { result: tail } : {})
    };
  }
  return {
    ...(raw ? { result: raw } : {}),
    ...(isFiniteNumber(input.exitCode) ? { exitCode: input.exitCode } : {})
  };
}

export function runLogFileName(conversationId: string): string {
  const safe = String(conversationId ?? '').replace(/[^\w.-]/g, '_');
  return `run-${safe}.md`;
}

export function runLogPath(workspaceRoot: string, conversationId: string): string {
  const root = String(workspaceRoot ?? '');
  const sep = root.includes('\\') ? '\\' : '/';
  const trimmed = root.replace(/[\\/]+$/, '');
  return `${trimmed}${sep}.localagents${sep}logs${sep}${runLogFileName(conversationId)}`;
}

export function summarizeStats(stats: ChatEvent['stats'] | undefined): RunLogModelStats {
  if (!stats) return {};
  const out: RunLogModelStats = {};
  if (isFiniteNumber(stats.promptEvalCount)) out.promptEvalCount = stats.promptEvalCount;
  if (isFiniteNumber(stats.evalCount)) out.evalCount = stats.evalCount;
  if (typeof stats.doneReason === 'string' && stats.doneReason) out.doneReason = stats.doneReason;
  if (isFiniteNumber(stats.totalDuration)) out.totalDurationNs = stats.totalDuration;
  if (isFiniteNumber(stats.evalDuration)) out.evalDurationNs = stats.evalDuration;
  if (isFiniteNumber(stats.reasoningTokens)) out.reasoningTokens = stats.reasoningTokens;
  return out;
}

export function createRunLog(opts?: RunLogOptions): RunLog {
  const maxEvents = clampLimit(opts?.maxEvents, DEFAULT_MAX_EVENTS);
  const maxChars = clampLimit(opts?.maxChars, DEFAULT_MAX_CHARS);
  const clock = opts?.now ?? defaultNow;
  const buffer: RunLogEvent[] = [];
  let head = 0;
  let charTotal = 0;
  let dropped = 0;
  let active: ActiveRun | null = null;

  function live(): RunLogEvent[] {
    return head === 0 ? buffer.slice() : buffer.slice(head);
  }

  function liveCount(): number {
    return buffer.length - head;
  }

  function dropHead(): void {
    const event = buffer[head];
    if (!event) return;
    charTotal -= estimateEventChars(event);
    if (charTotal < 0) charTotal = 0;
    head += 1;
    dropped += 1;
    if (head > 48 && head * 2 >= buffer.length) {
      buffer.splice(0, head);
      head = 0;
    }
  }

  function add(input: RunLogInput): void {
    const t = isFiniteNumber(input.t) ? input.t : clock();
    const event = normalize(input, t, inheritedIds(input, active));
    remember(event);
    buffer.push(event);
    charTotal += estimateEventChars(event);
    trim();
  }

  function remember(event: RunLogEvent): void {
    if (event.kind === 'run-start' && event.runId != null) {
      active = {
        runId: event.runId,
        ...(event.conversationId ? { conversationId: event.conversationId } : {}),
        ...(event.label ? { label: event.label } : {}),
        ...(event.settings ? { settings: event.settings } : {})
      };
      return;
    }
    if (event.kind === 'run-stop' && active && event.runId === active.runId) active = null;
  }

  function trim(): void {
    while (liveCount() > maxEvents) dropHead();
    while (liveCount() > 1 && charTotal > maxChars) dropHead();
  }

  function events(): RunLogEvent[] {
    return live();
  }

  function clear(): void {
    buffer.length = 0;
    head = 0;
    charTotal = 0;
    dropped = 0;
    active = null;
  }

  function startRun(info: RunLogStartInfo): void {
    add({
      kind: 'run-start',
      runId: info.runId,
      conversationId: info.conversationId,
      ...(info.label != null ? { label: info.label } : {}),
      ...(info.settings ? { settings: info.settings } : {})
    });
  }

  function endRun(runId: number, reason: string): void {
    const conversationId = active && active.runId === runId ? active.conversationId : undefined;
    add({
      kind: 'run-stop',
      runId,
      reason,
      ...(conversationId ? { conversationId } : {})
    });
  }

  function stats(): RunLogStats {
    return collect(live(), dropped);
  }

  function formatMarkdown(formatOpts?: RunLogFormatOptions): string {
    return render(live(), dropped, clock, 'md', formatOpts);
  }

  function formatPlain(formatOpts?: RunLogFormatOptions): string {
    return render(live(), dropped, clock, 'plain', formatOpts);
  }

  return { add, events, clear, startRun, endRun, formatMarkdown, formatPlain, stats };
}

function defaultNow(): number {
  return Date.now();
}

function redactSecrets(text: string): string {
  return text
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+(?::[^\s/@]+)?@/gi, '$1[redacted]@')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{16,}\b/g, 'github_pat_[redacted]')
    .replace(/\bghp_[A-Za-z0-9]{16,}\b/g, 'ghp_[redacted]')
    .replace(/\bglpat-[A-Za-z0-9_-]{16,}\b/g, 'glpat-[redacted]')
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, 'xoxb-[redacted]')
    .replace(/sk-or-v1-[A-Za-z0-9_-]+/g, 'sk-or-v1-[redacted]')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-[redacted]')
    .replace(/xai-[A-Za-z0-9_-]+/gi, 'xai-[redacted]')
    .replace(/AIzaSy[A-Za-z0-9_-]{20,}/g, 'AIzaSy[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._+/=-]+/gi, 'Bearer [redacted]')
    .replace(
      /(["'])(apiKey|api_key|api-key|apikey|access_token|token|secret|password)\1\s*:\s*(?:"[^"]*"|'[^']*')/gi,
      '$1$2$1:$1[redacted]$1'
    )
    .replace(/([?&](?:access_token|api_key|api-key|apikey|token|key)=)[^&#\s]+/gi, '$1[redacted]')
    .replace(
      /["']?(x-goog-api-key|access_token|api_key|api-key|apikey|token|password|passphrase|authorization)["']?\s*[=:]\s*(?!["']?\[redacted\])(?:"[^"]*"|'[^']*'|[^\s&#]+)/gi,
      '$1=[redacted]'
    )
    .replace(
      /\b([A-Z][A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|KEY|PASS|PWD))["']?\s*=\s*(?!["']?\[redacted\])(?:"[^"]*"|'[^']*'|[^\s&#]+)/g,
      '$1=[redacted]'
    );
}

function stripCommandEcho(text: string): string {
  return text
    .split(/\r?\n/)
    .map(line => {
      if (/blocked destructive command/i.test(line)) return 'blocked destructive command';
      if (/^\s*Ran:\s*\S/i.test(line)) return 'ran (no output)';
      return line;
    })
    .join('\n');
}

function commandExitCode(explicit: number | undefined, raw: string): number | undefined {
  if (isFiniteNumber(explicit)) return explicit;
  const match = /Exit code:\s*(-?\d+)/i.exec(raw);
  if (!match?.[1]) return undefined;
  const code = Number(match[1]);
  return Number.isFinite(code) ? code : undefined;
}

function collapseUserProfile(text: string): string {
  return text.replace(/([A-Za-z]):[/\\]Users[/\\][^/\\]+[/\\]?/gi, (_match, drive: string) => {
    return `${drive}:\\Users\\<user>\\`;
  });
}

function clampLimit(value: number | undefined, fallback: number): number {
  if (!isFiniteNumber(value)) return fallback;
  const floored = Math.floor(value);
  return floored < 0 ? 0 : floored;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function optNum(value: unknown): number | undefined {
  return isFiniteNumber(value) ? value : undefined;
}

function clipRedacted(redacted: string, max: number): string {
  if (redacted.length <= max) return redacted;
  const omitted = redacted.length - max;
  return `${redacted.slice(0, max)}\n[clipped ${omitted} chars]`;
}

function clipRaw(value: string, max: number): string {
  return clipRedacted(redactRunLogText(value), max);
}

function optStr(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clipped = clipRaw(value, max).trim();
  return clipped ? clipped : undefined;
}

function optBlock(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clipped = clipRaw(value, max);
  return clipped.trim() ? clipped : undefined;
}

function cleanSettings(settings: RunLogSettings | undefined): RunLogSettings | undefined {
  if (!settings) return undefined;
  const out: RunLogSettings = {};
  let kept = 0;
  for (const [key, value] of Object.entries(settings)) {
    if (kept >= MAX_SETTINGS) break;
    const safeKey = optStr(key, 80);
    if (!safeKey) continue;
    if (typeof value === 'string') {
      const shown = optStr(value, 500);
      if (!shown) continue;
      out[safeKey] = shown;
      kept += 1;
    } else if (isFiniteNumber(value) || typeof value === 'boolean') {
      out[safeKey] = value;
      kept += 1;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function cleanAssignments(items: RunLogAssignment[] | undefined): RunLogAssignment[] {
  if (!Array.isArray(items)) return [];
  const out: RunLogAssignment[] = [];
  for (const item of items) {
    if (out.length >= MAX_ASSIGNMENTS) break;
    if (!item || typeof item !== 'object') continue;
    const next: RunLogAssignment = {};
    const file = optStr(item.file, 300);
    const node = optStr(item.node, 120);
    const model = optStr(item.model, 160);
    const wave = optNum(item.wave);
    const skippedReason = optStr(item.skippedReason, 300);
    if (file) next.file = file;
    if (node) next.node = node;
    if (model) next.model = model;
    if (wave != null) next.wave = wave;
    if (skippedReason) next.skippedReason = skippedReason;
    if (typeof item.frontierBackup === 'boolean') next.frontierBackup = item.frontierBackup;
    if (Object.keys(next).length === 0) continue;
    out.push(next);
  }
  return out;
}

function parseExitCode(result: string | undefined): number | undefined {
  if (!result) return undefined;
  const match = /Exit code:\s*(-?\d+)/i.exec(result);
  const raw = match?.[1];
  if (raw == null) return undefined;
  const code = Number(raw);
  return Number.isFinite(code) ? code : undefined;
}

/** Turns shorter than this say nothing about throughput (1 token over ~1 µs reads as 1M tok/s). */
export const MIN_TOKPS_EVAL_COUNT = 16;
export const MIN_TOKPS_DURATION_NS = 20_000_000;
const MAX_PLAUSIBLE_TOKPS = 20_000;

/** tok/s for one turn, or undefined when the sample is too small or the timing is implausible. */
export function computeTokPerSec(
  evalCount: number | undefined,
  evalDurationNs: number | undefined
): number | undefined {
  if (evalCount == null || evalDurationNs == null) return undefined;
  if (!Number.isFinite(evalCount) || !Number.isFinite(evalDurationNs)) return undefined;
  if (evalCount < MIN_TOKPS_EVAL_COUNT || evalDurationNs < MIN_TOKPS_DURATION_NS) return undefined;
  const rate = evalCount / (evalDurationNs / 1e9);
  return rate > MAX_PLAUSIBLE_TOKPS ? undefined : rate;
}

function inheritedIds(input: RunLogInput, active: ActiveRun | null): InheritedIds {
  if (!active || input.kind === 'run-start' || input.kind === 'run-stop') return {};
  const runId = optNum(input.runId) ?? active.runId;
  return {
    ...(optNum(input.runId) == null ? { runId: active.runId } : {}),
    ...(input.conversationId == null && runId === active.runId && active.conversationId
      ? { conversationId: active.conversationId }
      : {})
  };
}

function stamp(input: RunLogStamp, t: number, inherited: InheritedIds): {
  t: number;
  runId?: number;
  conversationId?: string;
} {
  const runId = optNum(input.runId) ?? inherited.runId;
  const conversationId = optStr(input.conversationId, 200) ?? inherited.conversationId;
  return {
    t,
    ...(runId != null ? { runId } : {}),
    ...(conversationId ? { conversationId } : {})
  };
}

function withStep(stepId: string | undefined): { stepId?: string } {
  return stepId ? { stepId } : {};
}

function normalize(input: RunLogInput, t: number, inherited: InheritedIds): RunLogEvent {
  const base = stamp(input, t, inherited);
  switch (input.kind) {
    case 'run-start': {
      const label = optStr(input.label, 120);
      const settings = cleanSettings(input.settings);
      return { ...base, kind: 'run-start', ...(label ? { label } : {}), ...(settings ? { settings } : {}) };
    }
    case 'run-stop': {
      const reason = optStr(input.reason, NOTE_MAX);
      return { ...base, kind: 'run-stop', ...(reason ? { reason } : {}) };
    }
    case 'user': {
      const text = optStr(input.text, NOTE_MAX);
      const stepId = optStr(input.stepId, 80);
      return { ...base, kind: 'user', action: input.action, ...(text ? { text } : {}), ...withStep(stepId) };
    }
    case 'turn': {
      const phase = optStr(input.phase, 80);
      const nodeId = optStr(input.nodeId, 120);
      const nodeName = optStr(input.nodeName, 120);
      const numCtx = optNum(input.numCtx);
      const promptBudget = optNum(input.promptBudget);
      const estPromptTokens = optNum(input.estPromptTokens);
      const promptEvalCount = optNum(input.promptEvalCount);
      const evalCount = optNum(input.evalCount);
      const reasoningTokens = optNum(input.reasoningTokens);
      const think = typeof input.think === 'boolean' ? input.think : optStr(input.think, 40);
      const doneReason = optStr(input.doneReason, 80);
      const totalDurationNs = optNum(input.totalDurationNs);
      const evalDurationNs = optNum(input.evalDurationNs);
      const wallMs = optNum(input.wallMs);
      const error = optStr(input.error, NOTE_MAX);
      const tokPerSec = computeTokPerSec(evalCount, evalDurationNs);
      return {
        ...base,
        kind: 'turn',
        role: optStr(input.role, 120) || 'unknown',
        model: optStr(input.model, 160) || 'unknown',
        ...(phase ? { phase } : {}),
        ...(nodeId ? { nodeId } : {}),
        ...(nodeName ? { nodeName } : {}),
        ...(numCtx != null ? { numCtx } : {}),
        ...(promptBudget != null ? { promptBudget } : {}),
        ...(estPromptTokens != null ? { estPromptTokens } : {}),
        ...(promptEvalCount != null ? { promptEvalCount } : {}),
        ...(evalCount != null ? { evalCount } : {}),
        ...(reasoningTokens != null ? { reasoningTokens } : {}),
        ...(think !== undefined ? { think } : {}),
        ...(doneReason ? { doneReason } : {}),
        ...(totalDurationNs != null ? { totalDurationNs } : {}),
        ...(evalDurationNs != null ? { evalDurationNs } : {}),
        ...(wallMs != null ? { wallMs } : {}),
        ...(input.aborted === true ? { aborted: true } : {}),
        ...(error ? { error } : {}),
        ...(tokPerSec != null ? { tokPerSec } : {})
      };
    }
    case 'route': {
      const text = optStr(input.text, NOTE_MAX);
      const stepId = optStr(input.stepId, 80);
      const nodeId = optStr(input.nodeId, 120);
      const nodeName = optStr(input.nodeName, 120);
      const model = optStr(input.model, 160);
      return {
        ...base,
        kind: 'route',
        action: input.action,
        ...(text ? { text } : {}),
        ...withStep(stepId),
        ...(nodeId ? { nodeId } : {}),
        ...(nodeName ? { nodeName } : {}),
        ...(model ? { model } : {})
      };
    }
    case 'context': {
      const text = optStr(input.text, NOTE_MAX);
      const stepId = optStr(input.stepId, 80);
      const numCtx = optNum(input.numCtx);
      const promptBudget = optNum(input.promptBudget);
      const estPromptTokens = optNum(input.estPromptTokens);
      return {
        ...base,
        kind: 'context',
        action: input.action,
        ...(text ? { text } : {}),
        ...withStep(stepId),
        ...(numCtx != null ? { numCtx } : {}),
        ...(promptBudget != null ? { promptBudget } : {}),
        ...(estPromptTokens != null ? { estPromptTokens } : {})
      };
    }
    case 'tool': {
      const explicitExit = optNum(input.exitCode);
      const redactedResult = typeof input.result === 'string' ? redactRunLogText(input.result) : undefined;
      const exitCode = explicitExit != null ? explicitExit : parseExitCode(redactedResult);
      const result = redactedResult && redactedResult.trim() ? clipRedacted(redactedResult, TOOL_RESULT_MAX) : undefined;
      const path = optStr(input.path, 300);
      const status = optStr(input.status, 80);
      const stepId = optStr(input.stepId, 80);
      const name = optStr(input.name, 120) || 'tool';
      return {
        ...base,
        kind: 'tool',
        name,
        ...(path ? { path } : {}),
        ...(status ? { status } : {}),
        ...(exitCode != null ? { exitCode } : {}),
        ...(result ? { result } : {}),
        ...withStep(stepId)
      };
    }
    case 'verify': {
      const fingerprint = optStr(input.fingerprint, 200);
      const output = optBlock(input.output, VERIFY_OUTPUT_MAX);
      const stepId = optStr(input.stepId, 80);
      return {
        ...base,
        kind: 'verify',
        ok: input.ok === true,
        ...(fingerprint ? { fingerprint } : {}),
        ...(output ? { output } : {}),
        ...withStep(stepId)
      };
    }
    case 'verdict': {
      const text = optStr(input.text, NOTE_MAX);
      const stepId = optStr(input.stepId, 80);
      return { ...base, kind: 'verdict', result: input.result, ...(text ? { text } : {}), ...withStep(stepId) };
    }
    case 'heal': {
      const stepId = optStr(input.stepId, 80);
      const fingerprint = optStr(input.fingerprint, 200);
      const note = optStr(input.note, NOTE_MAX);
      const attempt = optNum(input.attempt);
      const max = optNum(input.max);
      return {
        ...base,
        kind: 'heal',
        ...withStep(stepId),
        ...(attempt != null ? { attempt } : {}),
        ...(max != null ? { max } : {}),
        ...(fingerprint ? { fingerprint } : {}),
        ...(note ? { note } : {})
      };
    }
    case 'swarm-assign':
      return { ...base, kind: 'swarm-assign', assignments: cleanAssignments(input.assignments) };
    case 'escalate':
    case 'pause':
    case 'notice':
    case 'error':
    case 'info': {
      const stepId = optStr(input.stepId, 80);
      return { ...base, kind: input.kind, text: optStr(input.text, NOTE_MAX) ?? '', ...withStep(stepId) };
    }
    default:
      return assertNever(input);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unknown run log event: ${JSON.stringify(value)}`);
}

/** Pasted-size estimate: string payloads plus a short overhead per event. */
function estimateEventChars(event: RunLogEvent): number {
  let total = 64;
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      total += value.length;
      return;
    }
    if (typeof value === 'number') {
      total += 8;
      return;
    }
    if (typeof value === 'boolean') {
      total += 4;
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const item of Object.values(value)) visit(item);
    }
  };
  visit(event);
  return total;
}

function emptyByKind(): Record<RunLogKind, number> {
  const counts = {} as Record<RunLogKind, number>;
  for (const kind of RUN_LOG_KINDS) counts[kind] = 0;
  return counts;
}

function emptyFailures(): RunLogFailureCounts {
  return {
    toolErrors: 0,
    nonZeroExits: 0,
    verifyFailures: 0,
    nay: 0,
    missingVerdicts: 0,
    failovers: 0,
    retries: 0,
    contextResubmits: 0,
    pauses: 0,
    errors: 0
  };
}

function toolStatusIsError(status: string | undefined): boolean {
  if (!status) return false;
  return /\b(error|fail|failed|failure)\b/i.test(status);
}

function isNonZeroExit(code: number | undefined): boolean {
  return typeof code === 'number' && code !== 0;
}

function meaningfulLine(text: string): string {
  const lines = text.split(/\r?\n/);
  let fallback = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!fallback) fallback = trimmed;
    if (/^exit code:\s*-?\d+$/i.test(trimmed)) continue;
    return trimmed;
  }
  return fallback;
}

function pushError(map: Map<string, RunLogRepeatedError>, raw: string | undefined): void {
  if (!raw) return;
  const shown = oneLine(raw, 180);
  if (!shown) return;
  const key = shown.toLowerCase();
  const prev = map.get(key);
  if (prev) prev.count += 1;
  else map.set(key, { text: shown, count: 1 });
}

function noteTurn(rolls: Map<string, RollAcc>, longTurns: RunLogLongTurn[], event: StoredTurn & { t: number; runId?: number }): void {
  const key = `${event.role}\n${event.model}`;
  let acc = rolls.get(key);
  if (!acc) {
    acc = { role: event.role, model: event.model, count: 0, tokSum: 0, tokN: 0, evalTokens: 0 };
    rolls.set(key, acc);
  }
  acc.count += 1;
  if (event.evalCount != null) acc.evalTokens += event.evalCount;
  // Re-check: logs written before the sample-size guard can hold 1-token "1,000,000 tok/s" turns.
  const tokPerSec =
    event.tokPerSec != null && computeTokPerSec(event.evalCount, event.evalDurationNs) != null
      ? event.tokPerSec
      : undefined;
  if (tokPerSec != null) {
    acc.tokSum += tokPerSec;
    acc.tokN += 1;
  }
  const wallMs = turnWallMs(event);
  if (wallMs == null) return;
  longTurns.push({
    t: event.t,
    ...(event.runId != null ? { runId: event.runId } : {}),
    role: event.role,
    model: event.model,
    wallMs,
    evalCount: event.evalCount ?? 0,
    tokPerSec: tokPerSec ?? null,
    ...(event.doneReason ? { doneReason: event.doneReason } : {})
  });
}

function turnWallMs(event: { wallMs?: number; totalDurationNs?: number }): number | undefined {
  if (isFiniteNumber(event.wallMs)) return event.wallMs;
  if (isFiniteNumber(event.totalDurationNs)) return event.totalDurationNs / 1e6;
  return undefined;
}

function collect(list: readonly RunLogEvent[], dropped: number): RunLogStats {
  const byKind = emptyByKind();
  const failures = emptyFailures();
  let failureTotal = 0;
  const rolls = new Map<string, RollAcc>();
  const errorMap = new Map<string, RunLogRepeatedError>();
  const longTurns: RunLogLongTurn[] = [];

  for (const event of list) {
    byKind[event.kind] = (byKind[event.kind] ?? 0) + 1;
    switch (event.kind) {
      case 'user':
        if (event.action === 'retry') {
          failures.retries += 1;
          failureTotal += 1;
        }
        break;
      case 'turn':
        noteTurn(rolls, longTurns, event);
        if (event.error) pushError(errorMap, event.error);
        break;
      case 'route':
        if (event.action === 'failover') {
          failures.failovers += 1;
          failureTotal += 1;
        }
        if (event.action === 'retry' || event.action === 'stream-retry') {
          failures.retries += 1;
          failureTotal += 1;
        }
        break;
      case 'context':
        if (event.action === 'resubmit') {
          failures.contextResubmits += 1;
          failureTotal += 1;
        }
        break;
      case 'tool': {
        const toolErr = toolStatusIsError(event.status);
        const badExit = isNonZeroExit(event.exitCode);
        if (toolErr) failures.toolErrors += 1;
        if (badExit) failures.nonZeroExits += 1;
        if (toolErr || badExit) {
          failureTotal += 1;
          const line = event.result ? meaningfulLine(event.result) : '';
          pushError(errorMap, line || `${event.name} ${event.status || 'failed'}`.trim());
        }
        break;
      }
      case 'verify':
        if (!event.ok) {
          failures.verifyFailures += 1;
          failureTotal += 1;
          const line = event.output ? meaningfulLine(event.output) : '';
          pushError(errorMap, line || 'verify failed');
        }
        break;
      case 'verdict':
        if (event.result === 'nay') {
          failures.nay += 1;
          failureTotal += 1;
        }
        if (event.result === 'missing') {
          failures.missingVerdicts += 1;
          failureTotal += 1;
        }
        break;
      case 'pause':
        failures.pauses += 1;
        failureTotal += 1;
        break;
      case 'error':
        failures.errors += 1;
        failureTotal += 1;
        pushError(errorMap, event.text);
        break;
      case 'escalate':
        pushError(errorMap, event.text);
        break;
      case 'run-start':
      case 'run-stop':
      case 'heal':
      case 'notice':
      case 'swarm-assign':
      case 'info':
        break;
      default:
        assertNever(event);
    }
  }

  const turns = [...rolls.values()]
    .map(acc => ({
      role: acc.role,
      model: acc.model,
      count: acc.count,
      avgTokPerSec: acc.tokN > 0 ? acc.tokSum / acc.tokN : null,
      evalTokens: acc.evalTokens
    }))
    .sort((a, b) => b.count - a.count || compareText(a.role, b.role) || compareText(a.model, b.model));

  const repeatedErrors = [...errorMap.values()]
    .filter(item => item.count >= 2)
    .sort((a, b) => b.count - a.count || compareText(a.text, b.text))
    .slice(0, TOP_ERRORS);

  longTurns.sort((a, b) => b.wallMs - a.wallMs || b.evalCount - a.evalCount);

  return {
    byKind,
    failures,
    failureTotal,
    turns,
    repeatedErrors,
    longestTurns: longTurns.slice(0, TOP_TURNS),
    dropped
  };
}

/** A write the workspace refused as a second copy of an existing module. */
const REJECTED_WRITE_RE = /\bRejected\b[^\n]*\balready exists\b|instead of creating a second copy/i;
const REPEATED_EDIT_RE = /\bREPEATED_EDIT\b/;
const NO_OP_REWORK_RE = /changed nothing|wrote the same bytes/i;
const YAY_TO_NAY_RE = /yay\s*->\s*nay|\(verify failed\)/i;
/** `done=length` turns whose reasoning took this share of the generated tokens ate the budget. */
const THINKING_SHARE = 0.8;

export interface RunWasteBucket {
  count: number;
  /** Wall time of the distinct turns that produced the waste. */
  ms: number;
}

export interface RunWastePair {
  /** The path as dispatched. */
  file: string;
  /** The other dispatched path it resolves to (same file modulo leading folders or case). */
  duplicateOf: string;
  stepId?: string;
}

export interface RunWasteReport {
  /** Writes refused as duplicates after a full generation. ms = the turns that produced them. */
  rejectedWrites: RunWasteBucket;
  /** Swarm tasks in one `swarm-assign` that name the same file. */
  duplicateDispatch: { count: number; pairs: RunWastePair[] };
  /** Reviewer turns spent while verify was red, or that ended as `yay->nay (verify failed)`. */
  reviewerOnRed: RunWasteBucket & { redBeforeReview: number; yayToNay: number };
  /** Verdict turns that stopped at `done=length` or generated fewer than 16 tokens. */
  cutOffVerdicts: RunWasteBucket;
  /** Reworks that changed nothing, plus REPEATED_EDIT tool errors. */
  noOpReworks: RunWasteBucket & { changedNothing: number; repeatedEdits: number };
  /** Failing verifies whose compiler fingerprint was already seen in the same run. */
  repeatedFingerprint: { count: number; fingerprints: Array<{ fingerprint: string; count: number }> };
  /** Non-verdict turns that hit `done=length` with a tiny or reasoning-dominated output. */
  thinkingAteBudget: RunWasteBucket;
  /** Distinct wasted turns, each counted once even when several patterns blame it. */
  wastedMs: number;
  /** Wall time of every turn that reported one. */
  totalTurnMs: number;
}

interface WasteTurnRef {
  index: number;
  ms: number | undefined;
}

interface WasteReviewTurn extends WasteTurnRef {
  counted: boolean;
}

interface WasteBucketAcc extends RunWasteBucket {
  turns: Set<number>;
}

function newBucket(): WasteBucketAcc {
  return { count: 0, ms: 0, turns: new Set<number>() };
}

function normalizeWastePath(raw: string): string {
  return raw
    .replace(/\\/g, '/')
    .toLowerCase()
    .replace(/\/{2,}/g, '/')
    .replace(/^(?:\.\/)+/, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .trim();
}

/** Assignments that duplicate another assignment in the same list (equal path or `/`-boundary suffix). */
function duplicateAssignments(items: readonly RunLogAssignment[]): RunWastePair[] {
  const live = items
    .filter(item => item.file && !item.skippedReason)
    .map(item => ({ raw: item.file as string, key: normalizeWastePath(item.file as string) }))
    .filter(item => item.key.length > 0);
  const pairs: RunWastePair[] = [];
  for (let i = 0; i < live.length; i += 1) {
    const mine = live[i];
    if (!mine) continue;
    for (let j = 0; j < live.length; j += 1) {
      const other = live[j];
      if (i === j || !other) continue;
      const same = other.key === mine.key && j < i;
      const longer = other.key !== mine.key && other.key.endsWith(`/${mine.key}`);
      if (same || longer) {
        pairs.push({ file: mine.raw, duplicateOf: other.raw });
        break;
      }
    }
  }
  return pairs;
}

/**
 * Turns the structured events into counts and estimated wasted wall time per known waste pattern.
 * Pure: the same events always give the same report. Turn events precede the tool events they
 * produced, so a tool event is blamed on the most recent turn of the same run.
 */
export function analyzeRunWaste(events: readonly RunLogEvent[]): RunWasteReport {
  const rejected = newBucket();
  const onRed = newBucket();
  const cutOff = newBucket();
  const noOp = newBucket();
  const thinking = newBucket();
  const wasted = new Map<number, number>();
  const pairs: RunWastePair[] = [];
  const fpCounts = new Map<string, { fingerprint: string; count: number }>();
  const fpSeen = new Set<string>();
  let redBeforeReview = 0;
  let yayToNay = 0;
  let changedNothing = 0;
  let repeatedEdits = 0;
  let repeatedFp = 0;
  let totalTurnMs = 0;
  let turnIndex = 0;
  let runKey: number | undefined;
  let started = false;
  let lastTurn: WasteTurnRef | undefined;
  let reviewTurn: WasteReviewTurn | undefined;
  let verifyOk: boolean | undefined;
  let lastNoOpText = '';
  let step: string | undefined;

  const hit = (bucket: WasteBucketAcc, turn: WasteTurnRef | undefined): void => {
    bucket.count += 1;
    if (!turn || turn.ms == null) return;
    if (!bucket.turns.has(turn.index)) {
      bucket.turns.add(turn.index);
      bucket.ms += turn.ms;
    }
    wasted.set(turn.index, turn.ms);
  };

  for (const event of events) {
    if (!started || event.runId !== runKey) {
      started = true;
      runKey = event.runId;
      lastTurn = undefined;
      reviewTurn = undefined;
      verifyOk = undefined;
      lastNoOpText = '';
      step = undefined;
    }
    if ('stepId' in event && event.stepId) step = event.stepId;
    switch (event.kind) {
      case 'turn': {
        const ms = turnWallMs(event);
        const ref: WasteTurnRef = { index: turnIndex, ms };
        turnIndex += 1;
        if (ms != null) totalTurnMs += ms;
        lastTurn = ref;
        const done = event.doneReason?.toLowerCase();
        const tiny = event.evalCount != null && event.evalCount < MIN_TOKPS_EVAL_COUNT;
        if (event.phase === 'verdict') {
          reviewTurn = { ...ref, counted: false };
          if (!event.aborted && (done === 'length' || tiny)) hit(cutOff, ref);
          if (verifyOk === false) {
            redBeforeReview += 1;
            hit(onRed, ref);
            reviewTurn.counted = true;
          }
        } else if (!event.aborted && done === 'length') {
          const reasoningHeavy =
            event.reasoningTokens != null &&
            event.evalCount != null &&
            event.evalCount > 0 &&
            event.reasoningTokens >= event.evalCount * THINKING_SHARE;
          if (tiny || reasoningHeavy) hit(thinking, ref);
        }
        break;
      }
      case 'tool': {
        const result = event.result ?? '';
        if (toolStatusIsError(event.status) && REJECTED_WRITE_RE.test(result)) hit(rejected, lastTurn);
        if (REPEATED_EDIT_RE.test(result)) {
          repeatedEdits += 1;
          hit(noOp, lastTurn);
        }
        break;
      }
      case 'verify': {
        verifyOk = event.ok;
        const fp = event.fingerprint;
        if (!event.ok && fp && fp.toLowerCase() !== 'none') {
          const key = `${event.runId ?? ''}|${fp}`;
          const seen = fpCounts.get(fp) ?? { fingerprint: fp, count: 0 };
          if (fpSeen.has(key)) {
            repeatedFp += 1;
            seen.count += 1;
            fpCounts.set(fp, seen);
          } else {
            fpSeen.add(key);
          }
        }
        break;
      }
      case 'verdict': {
        if (event.result === 'nay' && event.text && YAY_TO_NAY_RE.test(event.text)) {
          if (!reviewTurn?.counted) {
            yayToNay += 1;
            hit(onRed, reviewTurn);
          }
        }
        reviewTurn = undefined;
        break;
      }
      case 'info':
      case 'notice':
      case 'escalate':
      case 'error': {
        if (NO_OP_REWORK_RE.test(event.text) && event.text !== lastNoOpText) {
          lastNoOpText = event.text;
          changedNothing += 1;
          noOp.count += 1;
        }
        break;
      }
      case 'swarm-assign': {
        for (const pair of duplicateAssignments(event.assignments)) {
          pairs.push(step ? { ...pair, stepId: step } : pair);
        }
        break;
      }
      default:
        break;
    }
  }

  let wastedMs = 0;
  for (const ms of wasted.values()) wastedMs += ms;
  const fingerprints = [...fpCounts.values()].sort(
    (a, b) => b.count - a.count || compareText(a.fingerprint, b.fingerprint)
  );
  return {
    rejectedWrites: { count: rejected.count, ms: rejected.ms },
    duplicateDispatch: { count: pairs.length, pairs },
    reviewerOnRed: { count: onRed.count, ms: onRed.ms, redBeforeReview, yayToNay },
    cutOffVerdicts: { count: cutOff.count, ms: cutOff.ms },
    noOpReworks: { count: noOp.count, ms: noOp.ms, changedNothing, repeatedEdits },
    repeatedFingerprint: { count: repeatedFp, fingerprints },
    thinkingAteBudget: { count: thinking.count, ms: thinking.ms },
    wastedMs,
    totalTurnMs
  };
}

/** `4s`, `6m12s`. Sub-second waste reads `<1s` so a nonzero item never shows as zero. */
export function formatWasteDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const total = Math.round(ms / 1000);
  if (total < 1) return '<1s';
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}m${String(total % 60).padStart(2, '0')}s`;
}

/** Header lines for the Markdown log: only nonzero items, then the estimated total. */
export function formatRunWasteLines(report: RunWasteReport): string[] {
  const parts: string[] = [];
  const add = (label: string, count: number, ms?: number): void => {
    if (count <= 0) return;
    parts.push(ms != null && ms > 0 ? `${label} ${count} (~${formatWasteDuration(ms)})` : `${label} ${count}`);
  };
  add('rejected-writes', report.rejectedWrites.count, report.rejectedWrites.ms);
  add('duplicate-dispatch', report.duplicateDispatch.count);
  add('reviewer-on-red', report.reviewerOnRed.count, report.reviewerOnRed.ms);
  add('cut-off-verdicts', report.cutOffVerdicts.count, report.cutOffVerdicts.ms);
  add('no-op-reworks', report.noOpReworks.count, report.noOpReworks.ms);
  add('repeated-fingerprint', report.repeatedFingerprint.count);
  add('thinking-ate-budget', report.thinkingAteBudget.count, report.thinkingAteBudget.ms);
  if (parts.length === 0) return ['waste: none'];
  const lines = [`waste: ${parts.join(', ')}`];
  if (report.wastedMs > 0 && report.totalTurnMs > 0) {
    lines.push(
      `est. wasted ~${formatWasteDuration(report.wastedMs)} of ${formatWasteDuration(report.totalTurnMs)} total`
    );
  }
  return lines;
}

export interface RunStepSummary {
  /** `-` for turns before any step started (the first Planner turns). */
  stepId: string;
  coderMs: number;
  reviewMs: number;
  /** Planner, assist and any other role. */
  otherMs: number;
  turns: number;
  reworks: number;
  heals: number;
  verifyFailures: number;
  /** In order: `yay`, `nay`, `yay->nay`, `missing`. */
  verdicts: string[];
}

export interface RunTurnCost {
  t: number;
  runId?: number;
  stepId: string;
  role: string;
  model: string;
  phase?: string;
  wallMs: number;
  evalCount: number;
  doneReason?: string;
}

/**
 * Per-step time and event rollup plus the most expensive turns. Turn events carry no step id, so
 * a turn belongs to the last step id seen before it in the same run.
 */
export function summarizeRunSteps(
  events: readonly RunLogEvent[],
  topN = TOP_TURNS
): { steps: RunStepSummary[]; topTurns: RunTurnCost[] } {
  const order: string[] = [];
  const rows = new Map<string, RunStepSummary>();
  const costs: RunTurnCost[] = [];
  const rowFor = (id: string): RunStepSummary => {
    let row = rows.get(id);
    if (!row) {
      row = {
        stepId: id,
        coderMs: 0,
        reviewMs: 0,
        otherMs: 0,
        turns: 0,
        reworks: 0,
        heals: 0,
        verifyFailures: 0,
        verdicts: []
      };
      rows.set(id, row);
      order.push(id);
    }
    return row;
  };
  let runKey: number | undefined;
  let started = false;
  let current = '-';
  for (const event of events) {
    if (!started || event.runId !== runKey) {
      started = true;
      runKey = event.runId;
      current = '-';
    }
    if ('stepId' in event && event.stepId) current = event.stepId;
    switch (event.kind) {
      case 'turn': {
        const row = rowFor(current);
        const ms = turnWallMs(event) ?? 0;
        row.turns += 1;
        if (event.phase === 'verdict') row.reviewMs += ms;
        else if (event.role === 'coder') row.coderMs += ms;
        else row.otherMs += ms;
        costs.push({
          t: event.t,
          ...(event.runId != null ? { runId: event.runId } : {}),
          stepId: current,
          role: event.role,
          model: event.model,
          ...(event.phase ? { phase: event.phase } : {}),
          wallMs: ms,
          evalCount: event.evalCount ?? 0,
          ...(event.doneReason ? { doneReason: event.doneReason } : {})
        });
        break;
      }
      case 'verdict': {
        const label = event.result === 'nay' && event.text && YAY_TO_NAY_RE.test(event.text) ? 'yay->nay' : event.result;
        rowFor(current).verdicts.push(label);
        break;
      }
      case 'heal':
        rowFor(current).heals += 1;
        break;
      case 'verify':
        if (!event.ok) rowFor(current).verifyFailures += 1;
        break;
      case 'info':
        if (/^Rework #\d+ of step/i.test(event.text)) rowFor(current).reworks += 1;
        break;
      default:
        break;
    }
  }
  costs.sort((a, b) => b.wallMs - a.wallMs || b.evalCount - a.evalCount || a.t - b.t);
  return { steps: order.map(id => rows.get(id) as RunStepSummary), topTurns: costs.slice(0, Math.max(0, topN)) };
}

function compareText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function render(
  list: readonly RunLogEvent[],
  dropped: number,
  clock: () => number,
  mode: 'md' | 'plain',
  opts?: RunLogFormatOptions
): string {
  const stats = collect(list, dropped);
  const anchors = buildAnchors(list);
  const unscoped = unscopedBase(list);
  const lines: string[] = [];
  const title = oneLine(redactRunLogText(opts?.title?.trim() || 'Run log'), 120) || 'Run log';
  lines.push(mode === 'md' ? `# ${title}` : title);
  lines.push('');
  for (const line of headerLines(list, opts?.header, clock(), dropped)) lines.push(line);
  lines.push('');
  lines.push(heading('SUMMARY', mode));
  lines.push('');
  for (const line of summaryLines(stats, anchors, unscoped, list)) lines.push(line);
  lines.push('');
  lines.push(heading('TIMELINE', mode));
  lines.push('');
  appendTimeline(lines, list, anchors, unscoped, mode);
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

function headerLines(
  list: readonly RunLogEvent[],
  header: Record<string, string | number | boolean> | undefined,
  generatedMs: number,
  dropped: number
): string[] {
  const lines: string[] = [];
  if (header) {
    for (const [key, value] of Object.entries(header)) lines.push(`${headerLabel(key)}: ${headerValue(key, value)}`);
  }
  const settings = latestRunSettings(list);
  if (settings) {
    lines.push('settings:');
    for (const line of settingLines(settings)) lines.push(line);
  }
  const generated = iso(generatedMs);
  if (generated) lines.push(`generated: ${generated}`);
  lines.push(dropped > 0 ? `dropped: ${dropped} (oldest events removed)` : `dropped: ${dropped}`);
  return lines;
}

function headerLabel(key: string): string {
  if (key === 'appVersion') return 'version';
  if (key === 'workspaceBasename') return 'workspace';
  return key;
}

function headerValue(key: string, value: string | number | boolean): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  const redacted = redactRunLogText(value);
  if (key === 'workspace' || key === 'workspaceBasename') return workspaceBasename(redacted);
  return oneLine(redacted, 200);
}

function workspaceBasename(value: string): string {
  const trimmed = value.replace(/[\\/]+$/, '');
  const parts = trimmed.split(/[\\/]/);
  const last = parts.at(-1);
  const base = last && last.length > 0 ? last : trimmed;
  return oneLine(base || value, 120);
}

function latestRunSettings(list: readonly RunLogEvent[]): RunLogSettings | undefined {
  for (const event of [...list].reverse()) {
    if (event.kind === 'run-start' && event.settings) return event.settings;
  }
  return undefined;
}

function settingLines(settings: RunLogSettings): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(settings)) {
    const shown = typeof value === 'string' ? oneLine(value, 180) : String(value);
    lines.push(`  ${oneLine(key, 80)}: ${shown}`);
  }
  return lines;
}

function summaryLines(
  stats: RunLogStats,
  anchors: Map<number, RunAnchor>,
  unscoped: number | undefined,
  list: readonly RunLogEvent[]
): string[] {
  const lines: string[] = [];
  if (stats.turns.length === 0) lines.push('turns: none');
  else {
    lines.push('turns:');
    for (const turn of stats.turns) {
      const avg = turn.avgTokPerSec == null ? 'n/a' : `${formatRate(turn.avgTokPerSec)} tok/s`;
      lines.push(`- ${turn.role} / ${turn.model} x ${turn.count} | avg ${avg} | eval ${turn.evalTokens}`);
    }
  }
  const counts = kindCountLine(stats);
  lines.push(counts ? `counts: ${counts}` : 'counts: none');
  lines.push(`failures: ${failureLine(stats.failures)}`);
  for (const line of formatRunWasteLines(analyzeRunWaste(list))) lines.push(line);
  if (stats.repeatedErrors.length === 0) lines.push('repeated-errors: none');
  else {
    lines.push('repeated-errors:');
    for (const item of stats.repeatedErrors) lines.push(`- ${item.count}x ${item.text}`);
  }
  if (stats.longestTurns.length === 0) lines.push('longest-turns: none');
  else {
    lines.push('longest-turns:');
    for (const turn of stats.longestTurns) lines.push(`- ${formatLongTurn(turn, anchors, unscoped)}`);
  }
  return lines;
}

function kindCountLine(stats: RunLogStats): string {
  const parts: string[] = [];
  for (const kind of RUN_LOG_KINDS) {
    const count = stats.byKind[kind] ?? 0;
    if (count > 0) parts.push(`${kind} ${count}`);
  }
  return parts.join(', ');
}

function failureLine(failures: RunLogFailureCounts): string {
  return [
    `tool-errors ${failures.toolErrors}`,
    `non-zero-exits ${failures.nonZeroExits}`,
    `verify-failures ${failures.verifyFailures}`,
    `nay ${failures.nay}`,
    `missing-verdicts ${failures.missingVerdicts}`,
    `failovers ${failures.failovers}`,
    `retries ${failures.retries}`,
    `context-resubmits ${failures.contextResubmits}`,
    `pauses ${failures.pauses}`,
    `errors ${failures.errors}`
  ].join(', ');
}

function formatLongTurn(turn: RunLogLongTurn, anchors: Map<number, RunAnchor>, unscoped: number | undefined): string {
  const rel = formatRel(turn.t - anchorMs(turn.runId, turn.t, anchors, unscoped));
  const rate = turn.tokPerSec != null ? ` ${formatRate(turn.tokPerSec)} tok/s` : '';
  const done = turn.doneReason ? ` done=${oneLine(turn.doneReason, 40)}` : '';
  return `${rel} ${turn.role} / ${turn.model} wall=${formatDuration(turn.wallMs)} eval=${turn.evalCount}${rate}${done}`;
}

function appendTimeline(
  lines: string[],
  list: readonly RunLogEvent[],
  anchors: Map<number, RunAnchor>,
  unscoped: number | undefined,
  mode: 'md' | 'plain'
): void {
  if (list.length === 0) {
    lines.push('(no events)');
    return;
  }
  let runStarts = 0;
  for (const event of list) if (event.kind === 'run-start') runStarts += 1;
  const perRunSettings = runStarts > 1;
  let open = false;
  let currentUnscoped = false;
  let currentId: number | undefined;
  for (const event of list) {
    const unscopedEvent = event.runId == null;
    const changed = !open || unscopedEvent !== currentUnscoped || (!unscopedEvent && event.runId !== currentId);
    if (changed) {
      open = true;
      currentUnscoped = unscopedEvent;
      currentId = event.runId;
      const anchor = event.runId != null ? anchors.get(event.runId) : undefined;
      if (lines.at(-1) !== '') lines.push('');
      lines.push(heading(runHeading(event.runId, anchor?.label), mode));
      if (anchor?.conversationId) lines.push(`conversation: ${oneLine(anchor.conversationId, 120)}`);
      if (perRunSettings && anchor?.settings) {
        lines.push('settings:');
        for (const line of settingLines(anchor.settings)) lines.push(line);
      }
    }
    const rel = formatRel(event.t - anchorMs(event.runId, event.t, anchors, unscoped));
    const view = viewEvent(event, rel);
    lines.push(view.line);
    if (view.detail) lines.push(mode === 'md' && view.fence ? fence(view.detail) : indentBlock(view.detail));
  }
}

function buildAnchors(list: readonly RunLogEvent[]): Map<number, RunAnchor> {
  const anchors = new Map<number, RunAnchor>();
  for (const event of list) {
    if (event.runId == null) continue;
    let anchor = anchors.get(event.runId);
    if (!anchor) {
      anchor = { t: event.t, ...(event.conversationId ? { conversationId: event.conversationId } : {}) };
      anchors.set(event.runId, anchor);
    } else if (event.conversationId && !anchor.conversationId) {
      anchor.conversationId = event.conversationId;
    }
    if (event.kind !== 'run-start') continue;
    anchor.t = event.t;
    if (event.label) anchor.label = event.label;
    if (event.settings) anchor.settings = event.settings;
    if (event.conversationId) anchor.conversationId = event.conversationId;
  }
  return anchors;
}

function unscopedBase(list: readonly RunLogEvent[]): number | undefined {
  for (const event of list) {
    if (event.runId == null) return event.t;
  }
  return undefined;
}

function anchorMs(
  runId: number | undefined,
  fallback: number,
  anchors: Map<number, RunAnchor>,
  unscoped: number | undefined
): number {
  if (runId != null) return anchors.get(runId)?.t ?? fallback;
  return unscoped ?? fallback;
}

function runHeading(runId: number | undefined, label: string | undefined): string {
  if (runId == null) return 'Run (unscoped)';
  const safe = label ? oneLine(label, 80) : '';
  return safe ? `Run #${runId} (${safe})` : `Run #${runId}`;
}

function heading(text: string, mode: 'md' | 'plain'): string {
  return mode === 'md' ? `## ${text}` : text;
}

function viewEvent(event: RunLogEvent, rel: string): EventView {
  switch (event.kind) {
    case 'run-start':
      return { line: joinBits([rel, 'run-start']), fence: false };
    case 'run-stop':
      return { line: joinBits([rel, 'run-stop', event.reason ? oneLine(event.reason, 180) : undefined]), fence: false };
    case 'user':
      return viewNote(rel, ['user', event.action, stepBit(event.stepId)], event.text, false);
    case 'turn':
      return viewTurn(event, rel);
    case 'route':
      return viewNote(
        rel,
        ['route', event.action, nodeTag(event.nodeName, event.nodeId), event.model ? `model=${oneLine(event.model, 80)}` : undefined, stepBit(event.stepId)],
        event.text,
        false
      );
    case 'context':
      return viewNote(
        rel,
        [
          'context',
          event.action,
          event.numCtx != null ? `ctx=${event.numCtx}` : undefined,
          event.promptBudget != null ? `budget=${event.promptBudget}` : undefined,
          event.estPromptTokens != null ? `est=${event.estPromptTokens}` : undefined,
          stepBit(event.stepId)
        ],
        event.text,
        false
      );
    case 'tool':
      return viewTool(event, rel);
    case 'verify':
      return viewVerify(event, rel);
    case 'verdict':
      return viewNote(rel, ['verdict', event.result, stepBit(event.stepId)], event.text, false);
    case 'heal':
      return viewHeal(event, rel);
    case 'swarm-assign':
      return viewSwarm(event, rel);
    case 'escalate':
    case 'pause':
    case 'notice':
    case 'error':
    case 'info':
      return viewNote(rel, [event.kind, stepBit(event.stepId)], event.text, false);
    default:
      return assertNever(event);
  }
}

function viewTurn(event: StoredTurn & { t: number; runId?: number; conversationId?: string }, rel: string): EventView {
  const err = splitDetail(event.error, INLINE_MAX);
  return {
    line: joinBits([
      rel,
      'turn',
      `${event.role}/${event.model}`,
      nodeTag(event.nodeName, event.nodeId),
      event.phase ? `phase=${oneLine(event.phase, 60)}` : undefined,
      event.numCtx != null ? `ctx=${event.numCtx}` : undefined,
      event.promptBudget != null ? `budget=${event.promptBudget}` : undefined,
      event.estPromptTokens != null ? `est=${event.estPromptTokens}` : undefined,
      event.promptEvalCount != null ? `promptEval=${event.promptEvalCount}` : undefined,
      event.evalCount != null ? `eval=${event.evalCount}` : undefined,
      event.reasoningTokens != null ? `reasoning=${event.reasoningTokens}` : undefined,
      event.think !== undefined ? `think=${thinkLabel(event.think)}` : undefined,
      event.tokPerSec != null ? `${formatRate(event.tokPerSec)} tok/s` : undefined,
      event.doneReason ? `done=${oneLine(event.doneReason, 40)}` : undefined,
      event.wallMs != null ? `wall=${formatDuration(event.wallMs)}` : undefined,
      event.wallMs == null && event.totalDurationNs != null ? `total=${formatDuration(event.totalDurationNs / 1e6)}` : undefined,
      event.aborted ? 'aborted' : undefined,
      err.detail ? 'error' : undefined,
      err.inline ? `error=${err.inline}` : undefined
    ]),
    ...(err.detail ? { detail: err.detail } : {}),
    fence: false
  };
}

function thinkLabel(value: boolean | string): string {
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  return oneLine(value, 40);
}

function viewTool(event: Extract<RunLogEvent, { kind: 'tool' }>, rel: string): EventView {
  const body = splitDetail(event.result, INLINE_MAX);
  return {
    line: joinBits([
      rel,
      'tool',
      event.name,
      event.path ? oneLine(event.path, 180) : undefined,
      event.status ? `status=${oneLine(event.status, 40)}` : undefined,
      event.exitCode != null ? `exit=${event.exitCode}` : undefined,
      stepBit(event.stepId),
      body.inline ? `result=${body.inline}` : undefined
    ]),
    ...(body.detail ? { detail: body.detail } : {}),
    fence: true
  };
}

function viewVerify(event: Extract<RunLogEvent, { kind: 'verify' }>, rel: string): EventView {
  const body = splitDetail(event.output, INLINE_MAX);
  return {
    line: joinBits([
      rel,
      'verify',
      event.ok ? 'ok' : 'FAIL',
      event.fingerprint ? `fp=${oneLine(event.fingerprint, 80)}` : undefined,
      stepBit(event.stepId),
      body.inline ? `output=${body.inline}` : undefined
    ]),
    ...(body.detail ? { detail: body.detail } : {}),
    fence: true
  };
}

function viewHeal(event: Extract<RunLogEvent, { kind: 'heal' }>, rel: string): EventView {
  const note = splitDetail(event.note, INLINE_MAX);
  const attempt =
    event.attempt != null && event.max != null
      ? `attempt=${event.attempt}/${event.max}`
      : event.attempt != null
        ? `attempt=${event.attempt}`
        : undefined;
  return {
    line: joinBits([
      rel,
      'heal',
      stepBit(event.stepId),
      attempt,
      event.fingerprint ? `fp=${oneLine(event.fingerprint, 80)}` : undefined,
      note.detail ? 'note' : undefined,
      note.inline
    ]),
    ...(note.detail ? { detail: note.detail } : {}),
    fence: false
  };
}

function viewSwarm(event: Extract<RunLogEvent, { kind: 'swarm-assign' }>, rel: string): EventView {
  const rows: string[] = [];
  for (const item of event.assignments) {
    rows.push(
      joinBits([
        item.wave != null ? `wave=${item.wave}` : undefined,
        item.file ? `file=${oneLine(item.file, 160)}` : undefined,
        item.node ? `node=${oneLine(item.node, 80)}` : undefined,
        item.model ? `model=${oneLine(item.model, 80)}` : undefined,
        item.frontierBackup ? 'frontier-backup' : undefined,
        item.skippedReason ? `skipped=${oneLine(item.skippedReason, 120)}` : undefined
      ])
    );
  }
  const detail = rows.filter(row => row.length > 0).join('\n');
  return {
    line: joinBits([rel, 'swarm-assign', String(event.assignments.length)]),
    ...(detail ? { detail } : {}),
    fence: false
  };
}

function viewNote(rel: string, bits: Array<string | undefined>, text: string | undefined, fence: boolean): EventView {
  const body = splitDetail(text, INLINE_MAX);
  return {
    line: joinBits([rel, ...bits, body.inline]),
    ...(body.detail ? { detail: body.detail } : {}),
    fence
  };
}

function stepBit(stepId: string | undefined): string | undefined {
  return stepId ? `step=${oneLine(stepId, 80)}` : undefined;
}

function nodeTag(nodeName: string | undefined, nodeId: string | undefined): string | undefined {
  const name = nodeName || nodeId;
  return name ? `@${oneLine(name, 80)}` : undefined;
}

function splitDetail(text: string | undefined, inlineMax: number): { inline?: string; detail?: string } {
  if (!text) return {};
  if (text.includes('\n') || text.length > inlineMax) return { detail: text };
  return { inline: text };
}

function joinBits(parts: Array<string | undefined>): string {
  let out = '';
  for (const part of parts) {
    if (!part) continue;
    out = out ? `${out} ${part}` : part;
  }
  return out;
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max)}...`;
}

function formatRel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const ss = total % 60;
  const mm = Math.floor(total / 60);
  return `+${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function formatRate(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 10) / 10;
  if (Object.is(rounded, -0)) return '0';
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${formatRate(ms / 1000)}s`;
}

function iso(ms: number): string {
  if (!Number.isFinite(ms)) return '';
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

function fence(body: string): string {
  let size = 3;
  let run = 0;
  let longest = 0;
  for (const ch of body) {
    if (ch === '`') {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }
  if (longest >= size) size = longest + 1;
  const tick = '`'.repeat(size);
  return `${tick}\n${body}\n${tick}`;
}

function indentBlock(body: string): string {
  const lines = body.split('\n');
  const out: string[] = [];
  for (const line of lines) out.push(`  ${line}`);
  return out.join('\n');
}
