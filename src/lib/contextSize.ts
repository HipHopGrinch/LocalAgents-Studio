import { EndpointNode, OllamaModel } from '../types';
import { MODEL_CATALOG } from '../config/modelCatalog';
import { estimateImageTokens } from './images';

/**
 * Rough English-text capacity estimates for a context window.
 *
 * Scheme (labeled as approximate in the UI HelpTip):
 * - 1 token ≈ 0.75 English words
 * - 1 page ≈ 500 words ≈ 667 tokens
 * - 1 short website ≈ 2,500 tokens
 * - 1 medium source file ≈ 1,500 tokens
 * - 1 chat turn (user+assistant) ≈ 400 tokens
 */
export const CTX_WORDS_PER_TOKEN = 0.75;
export const CTX_PAGE_TOKENS = 667;
export const CTX_SHORT_SITE_TOKENS = 2500;
export const CTX_MEDIUM_FILE_TOKENS = 1500;
export const CTX_CHAT_TURN_TOKENS = 400;

/** Common Ollama num_ctx presets shown in Hardware Settings. */
export const COMMON_CTX_SIZES = [
  2048, 4096, 8192, 12288, 16384, 24576, 32768, 65536, 131072, 262144
] as const;

/** Local Ollama default ceiling when the user has not set a per-model pref. */
export const DEFAULT_MODEL_NUM_CTX = 16384;

/**
 * Frontier / cloud APIs (Gemini Flash Lite, Grok, OpenAI, …) manage long context
 * server-side. Studio must not shrink them to the local 16k persona default.
 */
export const DEFAULT_FRONTIER_NUM_CTX = 262144;

export function isFrontierEndpoint(
  node?: Pick<{ type?: string; apiKey?: string }, 'type' | 'apiKey'> | null
): boolean {
  if (!node) return false;
  return node.type === 'openai' || !!node.apiKey;
}

/** Known-wide cloud model names (Gemini Flash*, GPT-4*, Claude*, Grok*). */
export function isWideFrontierModel(modelName?: string): boolean {
  if (!modelName) return false;
  return /gemini|gpt-4|gpt-5|o1|o3|o4|claude|grok|chatgpt/i.test(modelName);
}

export function formatCtxLabel(tokens: number): string {
  if (tokens >= 1024 && tokens % 1024 === 0) {
    const k = tokens / 1024;
    return k >= 1024 ? `${k / 1024}M` : `${k}k`;
  }
  if (tokens >= 1000) {
    const k = Math.round(tokens / 1000);
    return `~${k}k`;
  }
  return String(tokens);
}

export function estimateContextFit(tokens: number): {
  pages: number;
  shortSites: number;
  codeFiles: number;
  chatTurns: number;
  label: string;
} {
  const pages = Math.max(0, Math.round(tokens / CTX_PAGE_TOKENS));
  const shortSites = Math.max(0, Math.round((tokens / CTX_SHORT_SITE_TOKENS) * 10) / 10);
  const codeFiles = Math.max(0, Math.round((tokens / CTX_MEDIUM_FILE_TOKENS) * 10) / 10);
  const chatTurns = Math.max(0, Math.round(tokens / CTX_CHAT_TURN_TOKENS));
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  const label = `~${formatCtxLabel(tokens)} tokens · ~${pages} pages · ~${fmt(shortSites)} short sites · ~${fmt(codeFiles)} code files`;
  return { pages, shortSites, codeFiles, chatTurns, label };
}

/** Known max context for a model name (details → catalog → frontier defaults → undefined). */
export function resolveModelMaxContext(
  modelName: string,
  model?: Pick<OllamaModel, 'details'> | null
): number | undefined {
  const fromDetails = model?.details?.context_length;
  if (typeof fromDetails === 'number' && fromDetails > 0) return fromDetails;

  const lower = modelName.toLowerCase();
  const catalog = MODEL_CATALOG.find(m => {
    const tag = m.tag.toLowerCase();
    return lower === tag || lower.startsWith(tag.split(':')[0] + ':') || tag.startsWith(lower.split(':')[0] + ':');
  });
  if (catalog?.contextMax) return catalog.contextMax;

  // Cloud models are not in the Ollama catalog — do not leave them "unknown" at 16k.
  if (isWideFrontierModel(modelName)) return DEFAULT_FRONTIER_NUM_CTX;
  return undefined;
}

/** Sizes offered in the select, capped by known model max when available. */
export function ctxSizeOptions(maxCtx?: number, current?: number): number[] {
  let base: number[] = [...COMMON_CTX_SIZES];
  if (maxCtx && maxCtx > 0 && !base.includes(maxCtx)) {
    base.push(maxCtx);
  }
  // Keep a previously saved value visible in the list (no free-form number entry).
  if (typeof current === 'number' && current > 0 && !base.includes(current)) {
    base.push(Math.floor(current));
  }
  base.sort((a, b) => a - b);
  if (maxCtx && maxCtx > 0) base = base.filter(s => s <= maxCtx);
  // If current was above max, still offer the clamped presets only — caller snaps the value.
  return base.length ? base : [...COMMON_CTX_SIZES];
}

/** Nearest preset for a stored num_ctx so the UI never needs a free-form number field. */
export function snapNumCtxToOption(value: number, maxCtx?: number): number {
  const options = ctxSizeOptions(maxCtx);
  const n = clampNumCtx(value, maxCtx);
  if (options.includes(n)) return n;
  let best = options[0];
  let bestDist = Math.abs(best - n);
  for (const opt of options) {
    const d = Math.abs(opt - n);
    if (d < bestDist) {
      best = opt;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Option list and selected value for a model context dropdown.
 * The selected value is the stored ceiling when it is allowed, otherwise the nearest preset.
 */
export function modelContextSelect(
  modelName: string,
  model: Pick<OllamaModel, 'details'> | null | undefined,
  storedMax: number
): { nativeMax?: number; value: number; options: number[] } {
  const nativeMax = resolveModelMaxContext(modelName, model);
  const stored = clampNumCtx(storedMax, nativeMax);
  let options = ctxSizeOptions(nativeMax, stored);
  const value = options.includes(stored) ? stored : snapNumCtxToOption(stored, nativeMax);
  if (!options.includes(value)) options = ctxSizeOptions(nativeMax, value);
  return { nativeMax, value, options };
}

/**
 * User-configured context ceiling for this model on this node.
 * Live runs send this same value as `num_ctx` on every request ({@link pinnedNumCtx}).
 *
 * Frontier nodes default to {@link DEFAULT_FRONTIER_NUM_CTX} (256k) when no pref
 * is set — never the local agent 16k fallback — so Gemini / Grok / GPT are not
 * compacted or Model-Fit-tightened as if they were small Ollama models.
 */
export function resolveModelNumCtx(
  node: Pick<EndpointNode, 'modelPrefs' | 'type' | 'apiKey'> | undefined,
  model: string,
  fallback: number = DEFAULT_MODEL_NUM_CTX
): number {
  const pref = node?.modelPrefs?.[model]?.numCtx;
  if (typeof pref === 'number' && pref > 0) return Math.floor(pref);

  if (isFrontierEndpoint(node) || isWideFrontierModel(model)) {
    return DEFAULT_FRONTIER_NUM_CTX;
  }

  return fallback > 0 ? Math.floor(fallback) : DEFAULT_MODEL_NUM_CTX;
}

/** Alias for clarity at call sites that mean "ceiling", not a per-request size. */
export const resolveModelMaxNumCtx = resolveModelNumCtx;

/**
 * The `num_ctx` to send on every request to this (node, model) during a run.
 * This is the configured ceiling. Do not vary it per payload — Ollama sizes the
 * KV cache at load time, so a different num_ctx reloads the weights.
 */
export function pinnedNumCtx(
  node: Pick<EndpointNode, 'modelPrefs' | 'type' | 'apiKey'> | undefined,
  model: string,
  fallback: number = DEFAULT_MODEL_NUM_CTX
): number {
  return resolveModelNumCtx(node, model, fallback);
}

/**
 * Optional fixed KV sizes. Prefer {@link pinnedNumCtx} (the exact ceiling).
 * Snap once at run start only if a host cannot pin an arbitrary value.
 */
export const NUM_CTX_BUCKETS = [4096, 8192, 12288, 16384, 32768, 65536, 131072, 262144] as const;

/** Smallest bucket that is >= `tokens`, so a snap never shrinks the ceiling. */
export function nearestNumCtxBucket(tokens: number): number {
  const n = Math.floor(tokens);
  if (!Number.isFinite(n) || n <= NUM_CTX_BUCKETS[0]) return NUM_CTX_BUCKETS[0];
  for (const bucket of NUM_CTX_BUCKETS) {
    if (n <= bucket) return bucket;
  }
  return NUM_CTX_BUCKETS[NUM_CTX_BUCKETS.length - 1];
}

export function clampNumCtx(value: number, maxCtx?: number): number {
  let n = Math.floor(value);
  if (!Number.isFinite(n) || n < 512) n = 512;
  if (maxCtx && maxCtx > 0) n = Math.min(n, maxCtx);
  return n;
}

export type DynamicCtxRole =
  | 'coder'
  | 'planner'
  | 'reviewer'
  | 'docs'
  | 'assist'
  | 'generic'
  | 'pass1'
  | 'audit';

export type ContextTier = 'tight' | 'standard' | 'wide';

/**
 * Code-heavy seed: ~3.2 characters per token (chars/4 under-counts source by 20–30%).
 * Samples are clamped into this range so one odd `prompt_eval_count` cannot swing the fit.
 */
export const CHARS_PER_TOKEN_SEED = 3.2;
const CHARS_PER_TOKEN_MIN = 2;
const CHARS_PER_TOKEN_MAX = 5;
const CALIBRATION_WINDOW = 12;

const tokenCalibration = new Map<string, { avg: number; n: number }>();

/** Rolling chars/token for `modelKey`, seeded at {@link CHARS_PER_TOKEN_SEED} until samples arrive. */
export function charsPerToken(modelKey?: string): number {
  const key = modelKey?.trim();
  if (!key) return CHARS_PER_TOKEN_SEED;
  const row = tokenCalibration.get(key);
  if (!row) return CHARS_PER_TOKEN_SEED;
  return Math.min(CHARS_PER_TOKEN_MAX, Math.max(CHARS_PER_TOKEN_MIN, row.avg));
}

/**
 * Record one real prefill. `promptChars` is the character length of the text that
 * was sent; `promptEvalCount` is Ollama's (or the provider's) prompt token count.
 * Tiny or non-finite samples are ignored.
 */
export function recordPromptSample(modelKey: string, promptChars: number, promptEvalCount: number): void {
  const key = (modelKey || '').trim();
  if (!key) return;
  if (!(promptChars >= 64) || !(promptEvalCount >= 16)) return;
  const ratio = promptChars / promptEvalCount;
  if (!Number.isFinite(ratio)) return;
  const clamped = Math.min(CHARS_PER_TOKEN_MAX, Math.max(CHARS_PER_TOKEN_MIN, ratio));
  const prev = tokenCalibration.get(key);
  if (!prev) {
    tokenCalibration.set(key, { avg: (CHARS_PER_TOKEN_SEED + clamped) / 2, n: 1 });
    return;
  }
  const weight = Math.min(prev.n, CALIBRATION_WINDOW - 1);
  tokenCalibration.set(key, {
    avg: (prev.avg * weight + clamped) / (weight + 1),
    n: prev.n + 1
  });
}

/** JSON blob for an optional settings/file persist. Pair with {@link hydrateTokenCalibration}. */
export function serializeTokenCalibration(): string {
  const samples: Record<string, { avg: number; n: number }> = {};
  for (const [key, row] of tokenCalibration) samples[key] = { avg: row.avg, n: row.n };
  return JSON.stringify({ v: 1, samples });
}

export function hydrateTokenCalibration(raw: string | null | undefined): void {
  tokenCalibration.clear();
  if (!raw) return;
  try {
    const data = JSON.parse(raw) as { samples?: Record<string, { avg?: number; n?: number }> };
    for (const [key, row] of Object.entries(data.samples || {})) {
      if (!key || !row || typeof row.avg !== 'number' || !Number.isFinite(row.avg)) continue;
      const avg = Math.min(CHARS_PER_TOKEN_MAX, Math.max(CHARS_PER_TOKEN_MIN, row.avg));
      const n = typeof row.n === 'number' && row.n > 0 ? Math.floor(row.n) : 1;
      tokenCalibration.set(key, { avg, n });
    }
  } catch {
    tokenCalibration.clear();
  }
}

/** Test hook. Does not affect a hydrated blob the caller still holds. */
export function resetTokenCalibration(): void {
  tokenCalibration.clear();
}

/** Token estimate. Pass `modelKey` to use the calibrated chars/token for that model. */
export function estimateTextTokens(text: string, modelKey?: string): number {
  const cpt = charsPerToken(modelKey);
  return Math.ceil((text || '').length / (cpt > 0 ? cpt : CHARS_PER_TOKEN_SEED));
}

export function estimateChatPayloadTokens(
  messages: Array<{ role?: string; content?: unknown; images?: unknown[] }>,
  modelKey?: string
): number {
  let total = 0;
  for (const m of messages) {
    total += 4; // role / message framing
    if (typeof m.content === 'string') {
      total += estimateTextTokens(m.content, modelKey);
    } else if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (typeof part === 'string') total += estimateTextTokens(part, modelKey);
        else if (part && typeof part === 'object' && 'text' in part && !('image_url' in part) && !('image' in part)) {
          total += estimateTextTokens(String((part as { text?: string }).text || ''), modelKey);
        } else if (part && typeof part === 'object') {
          total += estimateImageTokens(part as { width?: number; height?: number });
        }
      }
    }
    if (Array.isArray(m.images)) {
      for (const img of m.images) total += estimateImageTokens(img as { width?: number; height?: number });
    }
  }
  return total;
}

export interface OutputBudgetOpts {
  createIntent?: boolean;
  tier?: ContextTier;
}

/**
 * `num_predict` cap for a persona. Send this on the request.
 * Coder 6144 (edits / tight) or 8192 (creates / wide). Planner 3072 or 4096.
 * Reviewer, Pass-1, and audit 2048. Assist 480.
 */
export function outputBudgetFor(role: DynamicCtxRole = 'generic', opts?: OutputBudgetOpts): number {
  switch (role) {
    case 'coder':
      if (opts?.tier === 'tight' || opts?.createIntent === false) return 6144;
      if (opts?.tier === 'wide' || opts?.createIntent === true) return 8192;
      return 6144;
    case 'planner':
      if (opts?.tier === 'wide' || opts?.tier === 'standard') return 4096;
      return 3072;
    case 'reviewer':
    case 'pass1':
    case 'audit':
      return 2048;
    case 'docs':
      return 3072;
    case 'assist':
      return 480;
    default:
      return 2048;
  }
}

/** Reserved room for the model's reply (and tool XML). Same numbers as {@link outputBudgetFor}. */
export function expectedOutputTokens(role: DynamicCtxRole = 'generic', opts?: OutputBudgetOpts): number {
  return outputBudgetFor(role, opts);
}

export interface FitBudget {
  pinnedCtx: number;
  /** num_predict cap for this role. */
  outputReserve: number;
  /** Prompt tokens that may be used so the reserved reply still fits in the pinned window. */
  promptBudget: number;
}

/**
 * How many prompt tokens fit in a pinned num_ctx after the output reserve and a
 * small overhead. Callers shrink the prompt to `promptBudget` instead of changing num_ctx.
 */
export function fitBudgetForPinnedCtx(opts: {
  pinnedCtx: number;
  role?: DynamicCtxRole;
  createIntent?: boolean;
  tier?: ContextTier;
  /** Tool-schema / framing reserve. Default 256. */
  overhead?: number;
}): FitBudget {
  const pinnedCtx = clampNumCtx(opts.pinnedCtx || DEFAULT_MODEL_NUM_CTX);
  const outputReserve = outputBudgetFor(opts.role || 'generic', {
    createIntent: opts.createIntent,
    tier: opts.tier
  });
  const overhead = typeof opts.overhead === 'number' && opts.overhead >= 0 ? Math.floor(opts.overhead) : 256;
  const promptBudget = Math.max(512, pinnedCtx - outputReserve - overhead);
  return { pinnedCtx, outputReserve, promptBudget };
}

/**
 * Active-file body cap for the model-fit tier. Tight keeps 4,000 characters and,
 * when `cursorLine` is set, a window around that line instead of the file head.
 */
export function capActiveFileForTier(content: string, tier: ContextTier, cursorLine?: number): string {
  const maxChars = tier === 'tight' ? 4000 : tier === 'wide' ? 14000 : 8000;
  const text = content || '';
  if (text.length <= maxChars) return text;
  const lines = text.split('\n');
  if (cursorLine && cursorLine > 0 && lines.length > 1) {
    const target = Math.min(lines.length, Math.max(1, Math.floor(cursorLine))) - 1;
    let lo = target;
    let hi = target + 1;
    let size = lines[target].length + 1;
    while (lo > 0 || hi < lines.length) {
      const takeAbove = lo > 0 ? lines[lo - 1].length + 1 : Infinity;
      const takeBelow = hi < lines.length ? lines[hi].length + 1 : Infinity;
      const add = Math.min(takeAbove, takeBelow);
      if (size + add > maxChars - 96) break;
      if (takeAbove <= takeBelow && lo > 0) {
        lo -= 1;
        size += takeAbove;
      } else if (hi < lines.length) {
        hi += 1;
        size += takeBelow;
      } else break;
    }
    const slice = lines.slice(lo, hi).join('\n');
    const noteHead = lo > 0 ? `…(lines 1–${lo} omitted)\n` : '';
    const noteTail = hi < lines.length ? `\n…(lines ${hi + 1}–${lines.length} omitted)` : '';
    const windowed = `${noteHead}${slice}${noteTail}`;
    if (windowed.length <= maxChars + 80) return windowed;
  }
  const head = text.slice(0, Math.max(0, maxChars - 48));
  return `${head}\n…(active file truncated to ${maxChars} characters)`;
}

/** Round up for Ollama num_ctx (256-token steps, minimum 1024). */
export function roundUpNumCtx(tokens: number): number {
  const step = 256;
  const n = Math.ceil(Math.max(0, tokens) / step) * step;
  return Math.max(1024, n);
}

/**
 * Legacy per-request window. Live runs should send {@link pinnedNumCtx} and shrink
 * the prompt to {@link fitBudgetForPinnedCtx} so Ollama does not reload weights.
 * Kept so existing callers keep compiling.
 */
export function pickDynamicNumCtx(opts: {
  messages: Array<{ role?: string; content?: unknown }>;
  maxCtx: number;
  role?: DynamicCtxRole;
  createIntent?: boolean;
  /** Extra tokens for tool schemas / sticky directives (default 256). */
  toolOverhead?: number;
}): number {
  const maxCtx = clampNumCtx(opts.maxCtx || DEFAULT_MODEL_NUM_CTX);
  const input = estimateChatPayloadTokens(opts.messages || []);
  const output = expectedOutputTokens(opts.role || 'generic', {
    createIntent: opts.createIntent
  });
  const overhead = typeof opts.toolOverhead === 'number' ? opts.toolOverhead : 256;
  const margin = Math.ceil(input * 0.08);
  const needed = input + output + overhead + margin;
  return clampNumCtx(roundUpNumCtx(needed), maxCtx);
}
