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
import { extractContractExports, type SwarmSiblingFile } from '../../lib/swarmContract';

export interface PinnedChatOptions {
  temperature: number;
  num_ctx: number;
  num_predict: number;
  top_p?: number;
  tier: ContextTier;
  promptBudget: number;
  pinnedCtx: number;
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
  const predict = outputBudgetFor(opts.role, {
    createIntent: opts.createIntent,
    tier
  });
  const budget = fitBudgetForPinnedCtx({
    pinnedCtx: pinned,
    role: opts.role,
    createIntent: opts.createIntent,
    tier
  });
  const shaped: PinnedChatOptions = {
    temperature: opts.temperature ?? 0.2,
    num_ctx: pinned,
    num_predict: predict,
    tier,
    promptBudget: budget.promptBudget,
    pinnedCtx: pinned
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
  const skipLog = /\bWork log\b/i.test(user);
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
