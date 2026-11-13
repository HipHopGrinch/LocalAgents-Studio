/**
 * Request shaping for AgentChat.
 * One pinned num_ctx per model, a persona output cap, and the last prompt sample
 * for the context meter (`lastContextMeter()`). Token calibration persists in localStorage.
 */
import type { EndpointNode } from '../../types';
import type { VolatileContextBlockInput } from '../../lib/tools';
import { buildVolatileContextBlock, isFrontierNode } from '../../lib/tools';
import {
  fitBudgetForPinnedCtx,
  hydrateTokenCalibration,
  outputBudgetFor,
  pinnedNumCtx,
  recordPromptSample,
  serializeTokenCalibration,
  type ContextTier,
  type DynamicCtxRole
} from '../../lib/contextSize';
import { resolveModelFit } from '../../lib/clusterInventory';
import { contextWasExhausted } from '../../lib/contextMonitor';
import { extractContractExports, type SwarmSiblingFile } from '../../lib/swarmContract';
import {
  cappedReasoningReserve,
  modelProfile,
  thinkIsEnabled,
  visibleTokenEstimate,
  type ThinkMode
} from '../../lib/modelProfile';

export interface PinnedChatOptions {
  temperature: number;
  num_ctx: number;
  num_predict: number;
  top_p?: number;
  tier: ContextTier;
  promptBudget: number;
  pinnedCtx: number;
  /** Model thinking mode the budget was sized for. */
  thinks?: ThinkMode;
  /** Output tokens added on top of the visible budget for thinking (0 when none). */
  reasoningReserve?: number;
}

/** Last request the conductor sized. UX can read this for a context meter. */
export interface ContextMeterSnapshot {
  model: string;
  pinnedCtx: number;
  promptBudget: number;
  /** Ollama/provider prompt_eval_count from the last sampled call, when one arrived. */
  promptTokens?: number;
  tier: ContextTier;
  at: number;
}

let lastMeter: ContextMeterSnapshot | null = null;

const CALIBRATION_KEY = 'localagents.tokenCalibration';
let calibrationSaveTimer: ReturnType<typeof setTimeout> | null = null;

try {
  if (typeof localStorage !== 'undefined') {
    hydrateTokenCalibration(localStorage.getItem(CALIBRATION_KEY));
  }
} catch {
  /* storage unavailable: calibration stays per-session */
}

function scheduleCalibrationSave(): void {
  if (typeof localStorage === 'undefined' || calibrationSaveTimer) return;
  calibrationSaveTimer = setTimeout(() => {
    calibrationSaveTimer = null;
    try {
      localStorage.setItem(CALIBRATION_KEY, serializeTokenCalibration());
    } catch {
      /* quota or storage disabled */
    }
  }, 2000);
}

export function lastContextMeter(): ContextMeterSnapshot | null {
  return lastMeter ? { ...lastMeter } : null;
}

/**
 * Alias kept for tests: the 2048-token reviewer cap plus its 6144-token reasoning reserve.
 * Budgets now come from `modelProfile` (see `pinnedChatOptions`), not a frontier-only floor.
 */
export const FRONTIER_REASONING_OUTPUT_FLOOR = 8192;

export function pinnedChatOptions(opts: {
  node: EndpointNode | undefined;
  model: string;
  role: DynamicCtxRole;
  createIntent?: boolean;
  tier?: ContextTier;
  temperature?: number;
  fallbackNumCtx?: number;
}): PinnedChatOptions {
  const pinned = pinnedNumCtx(opts.node, opts.model, opts.fallbackNumCtx);
  const tier =
    opts.tier ??
    resolveModelFit(opts.node, opts.model, opts.role, opts.fallbackNumCtx ?? pinned).tier;
  let predict = outputBudgetFor(opts.role, {
    createIntent: opts.createIntent,
    tier
  });
  const budget = fitBudgetForPinnedCtx({
    pinnedCtx: pinned,
    role: opts.role,
    createIntent: opts.createIntent,
    tier
  });
  // Thinking (local Ollama `think`, or hidden frontier reasoning) counts against the output cap:
  // add a reasoning reserve on top of the visible budget and shrink the prompt budget to match.
  const profile = modelProfile(opts.node, opts.model, { role: opts.role });
  let reasoningReserve = 0;
  if (profile.thinks !== 'off') {
    reasoningReserve = cappedReasoningReserve({
      pinnedCtx: pinned,
      promptBudget: budget.promptBudget,
      reasoningReserve: profile.reasoningReserve
    });
    if (reasoningReserve > 0) {
      predict += reasoningReserve;
      budget.outputReserve = predict;
      budget.promptBudget = Math.max(512, pinned - predict - 256);
    }
  }
  const shaped: PinnedChatOptions = {
    temperature: opts.temperature ?? 0.2,
    num_ctx: pinned,
    num_predict: predict,
    tier,
    promptBudget: budget.promptBudget,
    pinnedCtx: pinned,
    thinks: profile.thinks,
    reasoningReserve
  };
  if (opts.role === 'reviewer' || opts.role === 'pass1' || opts.role === 'audit') {
    shaped.top_p = 0.9;
  }
  lastMeter = {
    model: opts.model,
    pinnedCtx: pinned,
    promptBudget: budget.promptBudget,
    promptTokens: lastMeter?.model === opts.model ? lastMeter.promptTokens : undefined,
    tier,
    at: Date.now()
  };
  return shaped;
}

/** Hard ceiling for a raised `num_predict`, whatever the window allows. */
export const MAX_RAISED_OUTPUT_TOKENS = 16384;

/**
 * Output budget for retrying a reply that stopped at its `num_predict` cap while the
 * window still had room. Capped at 2x the current budget and at the free window
 * (`numCtx - estPromptTokens - safetyMargin`), rounded down to 256.
 * Returns null when that is not at least 512 tokens above `currentBudget`.
 */
export function raisedOutputBudget(opts: {
  numCtx: number;
  /** Measured prompt_eval_count when known, otherwise an estimate. */
  estPromptTokens: number;
  currentBudget: number;
  /** Tool framing / estimate error reserve. Default 256. */
  safetyMargin?: number;
}): number | null {
  const { numCtx, estPromptTokens, currentBudget } = opts;
  if (![numCtx, estPromptTokens, currentBudget].every(Number.isFinite) || currentBudget <= 0) return null;
  const margin = typeof opts.safetyMargin === 'number' && opts.safetyMargin >= 0 ? opts.safetyMargin : 256;
  const room = Math.floor(numCtx) - Math.max(0, Math.floor(estPromptTokens)) - margin;
  const raised = Math.floor(Math.min(room, currentBudget * 2, MAX_RAISED_OUTPUT_TOKENS) / 256) * 256;
  return raised >= currentBudget + 512 ? raised : null;
}

/** Same pinned options with a larger `num_predict` for a retry, or null when there is no room. */
export function withRaisedOutputBudget(
  opts: PinnedChatOptions,
  estPromptTokens: number
): PinnedChatOptions | null {
  const raised = raisedOutputBudget({
    numCtx: opts.num_ctx,
    estPromptTokens,
    currentBudget: opts.num_predict
  });
  return raised == null ? null : { ...opts, num_predict: raised };
}

/**
 * Output budget for the one retry of a frontier reply that stopped for length with window to
 * spare. Unlike `outputCapWasHit` it does not need `evalCount` to reach `numPredict`: a
 * reasoning model's hidden thinking eats the cap and leaves a tiny (or no) visible reply.
 * x4 the current cap, up to {@link MAX_RAISED_OUTPUT_TOKENS} and the free window, rounded down
 * to 256. Null when the stop was not for length, the window was full, or there is no room.
 */
export function frontierCutOffBudget(opts: {
  stats: { promptEvalCount?: number; evalCount?: number; doneReason?: string } | undefined;
  numCtx: number;
  numPredict: number;
  /** Used when the provider sent no prompt token count. */
  estPromptTokens?: number;
}): number | null {
  const { stats, numCtx, numPredict } = opts;
  if (!stats || !/length/i.test(stats.doneReason || '')) return null;
  if (![numCtx, numPredict].every(Number.isFinite) || numCtx < 512 || numPredict <= 0) return null;
  const prompt = stats.promptEvalCount || opts.estPromptTokens || 0;
  if (contextWasExhausted({ ...stats, promptEvalCount: prompt }, numCtx, numCtx)) return null;
  const room = Math.floor(numCtx) - Math.max(0, Math.floor(prompt)) - 256;
  const raised = Math.floor(Math.min(numPredict * 4, MAX_RAISED_OUTPUT_TOKENS, room) / 256) * 256;
  return raised >= numPredict + 512 ? raised : null;
}

/** A local reply with fewer visible tokens than this, after a length stop, was eaten by thinking. */
export const THINKING_STARVED_VISIBLE_TOKENS = 64;

export type CutOffRetryPlan =
  /** Frontier: resend with a larger `max_tokens`. */
  | { kind: 'raise'; numPredict: number }
  /** Local: resend the same packet with `think: false`. */
  | { kind: 'no-think' };

/**
 * One decision for every role (coder, worker, reviewer, planner, heal): should a reply that
 * stopped for length be resent, and how?
 * - Frontier: x4 budget via {@link frontierCutOffBudget} (hidden reasoning ate `max_tokens`).
 * - Local with thinking enabled: when the visible reply is under ~64 tokens while thinking text
 *   is non-empty, resend once with `think: false` (fast and deterministic).
 * Null when the stop was not for length or no retry applies.
 */
export function planCutOffRetry(opts: {
  frontier: boolean;
  stats: { promptEvalCount?: number; evalCount?: number; doneReason?: string } | undefined;
  content?: string;
  thinking?: string;
  /** The `think` value the request carried. */
  thinkSent?: boolean | string | null;
  numCtx: number;
  numPredict: number;
  estPromptTokens?: number;
}): CutOffRetryPlan | null {
  if (!opts.stats || !/length/i.test(opts.stats.doneReason || '')) return null;
  if (opts.frontier) {
    const raised = frontierCutOffBudget({
      stats: opts.stats,
      numCtx: opts.numCtx,
      numPredict: opts.numPredict,
      estPromptTokens: opts.estPromptTokens
    });
    return raised == null ? null : { kind: 'raise', numPredict: raised };
  }
  if (!thinkIsEnabled(opts.thinkSent)) return null;
  if (!(opts.thinking || '').trim()) return null;
  if (visibleTokenEstimate(opts.content) >= THINKING_STARVED_VISIBLE_TOKENS) return null;
  return { kind: 'no-think' };
}

/** Ollama `options` object. num_ctx stays the pinned ceiling. */
export function ollamaOptions(opts: PinnedChatOptions): {
  temperature: number;
  num_ctx: number;
  num_predict: number;
  top_p?: number;
} {
  return {
    temperature: opts.temperature,
    num_ctx: opts.num_ctx,
    num_predict: opts.num_predict,
    ...(opts.top_p != null ? { top_p: opts.top_p } : {})
  };
}

export function notePromptSample(
  model: string,
  messages: Array<{ content?: unknown }>,
  stats?: { promptEvalCount?: number }
): void {
  const count = stats?.promptEvalCount;
  if (!model || !count) return;
  let chars = 0;
  for (const message of messages) {
    if (typeof message.content === 'string') chars += message.content.length;
  }
  recordPromptSample(model, chars, count);
  scheduleCalibrationSave();
  if (lastMeter && lastMeter.model === model) {
    lastMeter = { ...lastMeter, promptTokens: count, at: Date.now() };
  }
}

/**
 * Volatile turn context goes on the user message so the system prefix can stay stable.
 * Skips a second work log when the packet already has one.
 */
export function prependVolatileContext(user: string, input: VolatileContextBlockInput): string {
  const log = input.progressLog?.trim() || '';
  const skipLog = !!log && (user.includes(log) || /^## Work log\r?\nThis is the memory of the task/m.test(user));
  const block = buildVolatileContextBlock({
    ...input,
    progressLog: skipLog ? undefined : input.progressLog
  }).trim();
  if (!block) return user;
  return `${block}\n\n${user}`;
}

function exportLines(content?: string): string[] {
  if (!content) return [];
  const raw = extractContractExports(content, 8);
  if (!raw || raw === '(no exports parsed)') return [];
  return raw
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, 8);
}

/** Path plus export signatures. File body is inlined only when `inline` is set. */
export function siblingFile(
  path: string,
  opts?: { content?: string; exports?: string[]; inline?: boolean }
): SwarmSiblingFile {
  const named = (opts?.exports || []).map(item => item.trim()).filter(Boolean);
  const exports = (named.length ? named : exportLines(opts?.content)).slice(0, 8);
  return {
    path,
    ...(exports.length ? { exports } : {}),
    ...(opts?.inline && opts.content ? { content: opts.content } : {})
  };
}

/**
 * Warm pinned models before a swarm wave. Failures are logged and ignored so a
 * cold node does not abort the wave. Same num_ctx the chat requests will use.
 */
export async function warmModels(
  items: Array<{ node: EndpointNode; model: string }>,
  fallbackNumCtx?: number
): Promise<void> {
  const seen = new Set<string>();
  const jobs: Promise<void>[] = [];
  for (const item of items) {
    if (!item?.node?.url || !item.model || isFrontierNode(item.node)) continue;
    const key = `${item.node.id}\0${item.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ctx = pinnedNumCtx(item.node, item.model, fallbackNumCtx);
    const node = item.node;
    const model = item.model;
    jobs.push(
      (async () => {
        try {
          if (!window.electronAPI?.warmModel) return;
          const res = await window.electronAPI.warmModel(node.url, model, ctx);
          if (res?.error) {
            window.electronAPI.writeLog?.('warn', `Model warm skipped on ${node.name}: ${res.error}`);
          }
        } catch (err) {
          window.electronAPI?.writeLog?.(
            'warn',
            `Model warm skipped on ${node.name}: ${String((err as Error)?.message || err)}`
          );
        }
      })()
    );
  }
  await Promise.all(jobs);
}
