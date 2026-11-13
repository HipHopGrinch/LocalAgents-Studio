/**
 * One capability profile per (node, model): does it think, and how many output tokens does
 * that thinking need on top of the visible reply?
 *
 * Local Ollama: thinking is a user preference (`node.modelPrefs[model].think`) resolved by
 * `resolveThinkOption`, and Ollama counts thinking tokens against `num_predict`.
 * Frontier: reasoning is hidden but counts against `max_tokens`. It is recognised by model
 * name, or learned from a turn whose stats show reasoning tokens (or a length stop with a
 * near-empty visible reply). The learned set persists in localStorage.
 */
import type { EndpointNode, OllamaModel } from '../types';
import type { DynamicCtxRole } from './contextSize';
import { resolveThinkOption, type ThinkPersona } from './thinking';

export type ThinkMode = 'off' | 'on' | 'hidden';
export type ProfileSource = 'pref' | 'name' | 'learned' | 'none';

export interface ModelProfile {
  thinks: ThinkMode;
  source: ProfileSource;
  /** Output tokens to add on top of the visible budget; 0 when the model does not think. */
  reasoningReserve: number;
}

/** Output tokens reserved for thinking, by role. Visible-reply budgets are separate. */
export const REASONING_RESERVE_BY_ROLE: Readonly<Record<DynamicCtxRole, number>> = {
  planner: 6144,
  reviewer: 6144,
  pass1: 6144,
  audit: 6144,
  coder: 4096,
  docs: 4096,
  generic: 2048,
  assist: 1024
};

export function reasoningReserveFor(role: DynamicCtxRole | undefined): number {
  return REASONING_RESERVE_BY_ROLE[role || 'generic'] ?? REASONING_RESERVE_BY_ROLE.generic;
}

/**
 * Frontier model names (provider prefix and `vendor/` stripped, lower case) that reason before
 * answering. Tested in `modelProfile.selftest.ts`; extend here only.
 */
export const REASONING_MODEL_NAME_PATTERNS: readonly RegExp[] = [
  /^o[134](?:$|[-_.:])/, // o1, o3-mini, o4-mini
  /^gpt-5(?!.*chat)/, // gpt-5, gpt-5-mini; gpt-5-chat-latest does not reason
  /thinking/, // *-thinking, claude *:thinking
  /reason/, // *-reasoning, deepseek-reasoner
  /^deepseek-r1/,
  /^qwq/,
  /^magistral/,
  /^gemini-(?:2\.5|[3-9](?:\.\d+)?)(?:-|$)/, // 2.5 / 3 / 3.5 / 4 families
  /^grok-4/,
  /^grok-3-mini/
];

/** Names that match a reasoning pattern but run without it. */
export const NON_REASONING_MODEL_NAME_PATTERNS: readonly RegExp[] = [
  /non[-_ ]?reason/, // grok-4-fast-non-reasoning
  /-lite(?:$|[-_.:])/ // gemini-2.5-flash-lite, gemini-4-*-lite
];

function baseModelName(model: string): string {
  const lower = String(model || '').trim().toLowerCase();
  const slash = lower.lastIndexOf('/');
  return slash >= 0 ? lower.slice(slash + 1) : lower;
}

export function isReasoningModelName(model: string): boolean {
  const lower = String(model || '').trim().toLowerCase();
  if (!lower) return false;
  const base = baseModelName(lower);
  if (NON_REASONING_MODEL_NAME_PATTERNS.some(re => re.test(base))) return false;
  return REASONING_MODEL_NAME_PATTERNS.some(re => re.test(base));
}

// ---------------------------------------------------------------------------------------------
// Learned frontier reasoning models
// ---------------------------------------------------------------------------------------------

const LEARNED_KEY = 'localagents.reasoningModels';
const LEARNED_MAX = 64;
/** A length stop with fewer visible tokens than this means hidden reasoning ate the budget. */
export const LEARN_VISIBLE_TOKEN_MAX = 64;

const learned = new Map<string, number>();
let learnedSaveTimer: ReturnType<typeof setTimeout> | null = null;

function learnedKey(model: string): string {
  return baseModelName(model);
}

export function serializeLearnedReasoning(): string {
  return JSON.stringify({ v: 1, models: [...learned.keys()] });
}

export function hydrateLearnedReasoning(raw: string | null | undefined): void {
  learned.clear();
  if (!raw) return;
  try {
    const data = JSON.parse(raw) as { models?: unknown };
    if (!Array.isArray(data.models)) return;
    for (const name of data.models.slice(0, LEARNED_MAX)) {
      if (typeof name === 'string' && name.trim()) learned.set(learnedKey(name), Date.now());
    }
  } catch {
    learned.clear();
  }
}

export function resetLearnedReasoning(): void {
  learned.clear();
}

export function isLearnedReasoning(model: string): boolean {
  return learned.has(learnedKey(model));
}

function scheduleLearnedSave(): void {
  if (typeof localStorage === 'undefined' || learnedSaveTimer) return;
  learnedSaveTimer = setTimeout(() => {
    learnedSaveTimer = null;
    try {
      localStorage.setItem(LEARNED_KEY, serializeLearnedReasoning());
    } catch {
      /* quota or storage disabled */
    }
  }, 1000);
}

try {
  if (typeof localStorage !== 'undefined') hydrateLearnedReasoning(localStorage.getItem(LEARNED_KEY));
} catch {
  /* storage unavailable: learning stays per-session */
}

/** Rough visible-token count for a reply (chars / 4). */
export function visibleTokenEstimate(content: string | undefined): number {
  return Math.ceil((content || '').trim().length / 4);
}

/**
 * Record what a finished frontier turn revealed. Returns true when the model was newly learned
 * as a hidden-reasoning model: it reported reasoning tokens, or stopped for length with almost
 * no visible reply.
 */
export function noteReasoningObservation(
  model: string,
  obs: { reasoningTokens?: number; doneReason?: string; visibleContent?: string }
): boolean {
  const key = learnedKey(model);
  if (!key || learned.has(key)) return false;
  const reasoned = typeof obs.reasoningTokens === 'number' && obs.reasoningTokens > 0;
  const starved =
    /length/i.test(obs.doneReason || '') && visibleTokenEstimate(obs.visibleContent) < LEARN_VISIBLE_TOKEN_MAX;
  if (!reasoned && !starved) return false;
  if (learned.size >= LEARNED_MAX) {
    const oldest = learned.keys().next().value;
    if (oldest !== undefined) learned.delete(oldest);
  }
  learned.set(key, Date.now());
  scheduleLearnedSave();
  return true;
}

// ---------------------------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------------------------

function nodeIsFrontier(node: EndpointNode | undefined): boolean {
  return !!node && (node.type === 'openai' || !!node.apiKey);
}

/**
 * Effective Ollama `think` value for this node + model (undefined = omit, false = off).
 * Shared by request bodies and the budget math so they never disagree.
 */
export function resolveNodeThink(
  node: EndpointNode | undefined,
  model: string,
  persona?: ThinkPersona
): boolean | string | undefined {
  const live = node?.models?.find(m => m.name === model);
  const meta = node?.modelMeta?.[model];
  const info: Pick<OllamaModel, 'name' | 'thinking' | 'capabilities'> | undefined =
    live ||
    (meta ? { name: model, capabilities: meta.capabilities, thinking: meta.thinking } : undefined);
  return resolveThinkOption(info, node?.modelPrefs?.[model]?.think, { persona });
}

/** True for any `think` value that turns thinking on. */
export function thinkIsEnabled(think: boolean | string | null | undefined): boolean {
  if (think === undefined || think === null || think === false) return false;
  if (typeof think === 'string') return !/^(false|off|none|0|)$/i.test(think.trim());
  return true;
}

export function modelProfile(
  node: EndpointNode | undefined,
  model: string,
  opts?: { role?: DynamicCtxRole; persona?: ThinkPersona }
): ModelProfile {
  const reserve = reasoningReserveFor(opts?.role);
  const think = resolveNodeThink(node, model, opts?.persona);
  const prefOn = thinkIsEnabled(think);
  if (nodeIsFrontier(node)) {
    if (prefOn) return { thinks: 'hidden', source: 'pref', reasoningReserve: reserve };
    if (isReasoningModelName(model)) return { thinks: 'hidden', source: 'name', reasoningReserve: reserve };
    if (isLearnedReasoning(model)) return { thinks: 'hidden', source: 'learned', reasoningReserve: reserve };
    return { thinks: 'off', source: 'none', reasoningReserve: 0 };
  }
  if (prefOn) return { thinks: 'on', source: 'pref', reasoningReserve: reserve };
  return { thinks: 'off', source: 'none', reasoningReserve: 0 };
}

/**
 * Output reserve actually added on top of the visible budget. Never more than a third of the
 * pinned window, half of the prompt budget it replaces, or what leaves `promptBudget >= 512`.
 * Rounded down to 256; 0 when under 256.
 */
export function cappedReasoningReserve(opts: {
  pinnedCtx: number;
  promptBudget: number;
  reasoningReserve: number;
}): number {
  const { pinnedCtx, promptBudget, reasoningReserve } = opts;
  if (![pinnedCtx, promptBudget, reasoningReserve].every(Number.isFinite) || reasoningReserve <= 0) return 0;
  const cap = Math.min(
    reasoningReserve,
    Math.floor(pinnedCtx / 3),
    Math.floor(promptBudget / 2),
    promptBudget - 512
  );
  const rounded = Math.floor(cap / 256) * 256;
  return rounded >= 256 ? rounded : 0;
}

// ---------------------------------------------------------------------------------------------
// Inline <think> blocks and reasoning-token reporting
// ---------------------------------------------------------------------------------------------

const LEADING_THINK_OPEN = /^\s*<(think|thinking)>/i;
const ORPHAN_THINK_CLOSE = /<\/(?:think|thinking)>/i;
/** An orphan close tag after tool/verdict markup means the text before it is not reasoning. */
const STRUCTURED_MARKUP = /<(?:write_file|edit_file|run_command|read_file|list_dir|search|step_verdict|review_plan|execution_plan|plan_option)\b/i;

/**
 * Move a leading `<think>...</think>` / `<thinking>...</thinking>` block (or several) out of
 * reply text. An unclosed leading block is all reasoning (the reply was cut). A lone
 * `</think>` with no opener (templates that prefill the open tag) splits the text there unless
 * markup that is real output precedes it. Only leading blocks are touched, so a file body that
 * mentions `<think>` further in is never eaten. Returns `raw` unchanged when nothing matched.
 */
export function splitInlineThinking(raw: string): { content: string; thinking: string } {
  const text = typeof raw === 'string' ? raw : '';
  if (!text || (!/<think/i.test(text) && !/<\/think/i.test(text))) return { content: text, thinking: '' };
  let rest = text;
  let thinking = '';
  let matched = false;
  for (;;) {
    const open = rest.match(LEADING_THINK_OPEN);
    if (!open) break;
    matched = true;
    const tag = open[1];
    const afterOpen = rest.slice(open[0].length);
    const closeAt = afterOpen.search(new RegExp(`</${tag}>`, 'i'));
    if (closeAt < 0) {
      thinking += (thinking ? '\n' : '') + afterOpen.trim();
      rest = '';
      break;
    }
    thinking += (thinking ? '\n' : '') + afterOpen.slice(0, closeAt).trim();
    rest = afterOpen.slice(closeAt + `</${tag}>`.length);
  }
  if (!matched) {
    const close = rest.match(ORPHAN_THINK_CLOSE);
    if (close && close.index !== undefined) {
      const before = rest.slice(0, close.index);
      if (!STRUCTURED_MARKUP.test(before) && !/<think/i.test(before)) {
        thinking = before.trim();
        rest = rest.slice(close.index + close[0].length);
        matched = true;
      }
    }
  }
  if (!matched) return { content: text, thinking: '' };
  return { content: rest.replace(/^\s+/, ''), thinking };
}

/** Approximate reasoning tokens from thinking text (chars / 4) when the provider sent no count. */
export function estimateReasoningTokens(thinking: string | undefined): number | undefined {
  const len = (thinking || '').trim().length;
  return len > 0 ? Math.ceil(len / 4) : undefined;
}

/** `think` / `reasoningTokens` fields for a run-log turn event; empty when the turn did not think. */
export function turnThinkFields(result: {
  think?: boolean | string;
  thinking?: string;
  stats?: { reasoningTokens?: number };
}): { think?: boolean | string; reasoningTokens?: number } {
  const out: { think?: boolean | string; reasoningTokens?: number } = {};
  const reported = result.stats?.reasoningTokens;
  const reasoningTokens =
    typeof reported === 'number' && Number.isFinite(reported) ? reported : estimateReasoningTokens(result.thinking);
  if (result.think !== undefined && thinkIsEnabled(result.think)) out.think = result.think;
  else if (reasoningTokens != null && reasoningTokens > 0) out.think = true;
  if (reasoningTokens != null && reasoningTokens > 0 && typeof reported !== 'number') out.reasoningTokens = reasoningTokens;
  return out;
}

/**
 * Label for a frontier turn in the run log: `think` stays undefined unless the model is known
 * (or learned) to reason.
 */
export function frontierThinkLabel(model: string): 'hidden' | undefined {
  return isReasoningModelName(model) || isLearnedReasoning(model) ? 'hidden' : undefined;
}
