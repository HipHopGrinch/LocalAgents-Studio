import type { ToolCall } from '../types';
import { isReadOnlyToolBatch } from './agentLoop';
import { parseFinalReview } from './continuationReview';
import { CHARS_PER_TOKEN_SEED, fitBudgetForPinnedCtx, type DynamicCtxRole } from './contextSize';
import { pickExplicitStepVerdict } from './fullAuto';
import { parseReviewDelta, parseReviewPlan } from './planOptions';

/**
 * Non-plan answer turn. Tool tags in that reply are not executed.
 * Step and final-source turns use {@link reviewVerdictNowInstruction} so they
 * are not asked for a tag this mode will ignore.
 */
export const REVIEW_VERDICT_NOW_INSTRUCTION =
  'You have used your file reads. Do not call any tools. Reply now with your <review_plan> (or <review_delta task_id=...>) based on what you have.';

export function reviewVerdictNowInstruction(mode?: {
  stepVerdictMode?: boolean;
  finalSourceReview?: boolean;
}): string {
  if (mode?.finalSourceReview) {
    return 'You have used your file reads. Do not call any tools. Reply now with your <final_review> based on what you have.';
  }
  if (mode?.stepVerdictMode) {
    return 'You have used your file reads. Do not call any tools. Reply now with your <step_verdict ...> based on what you have.';
  }
  return REVIEW_VERDICT_NOW_INSTRUCTION;
}

/** Run log + notice when Full auto keeps going after a missing non-plan verdict. */
export const MISSING_REVIEW_VERDICT_NOTICE = 'Reviewer gave no verdict — continuing';

/** Manual review waits for Looks good / Continue. */
export const MISSING_REVIEW_VERDICT_WAIT_NOTICE =
  'Reviewer gave no verdict — click Looks good / Continue';

/** Same seed the context fitter uses (~3.2). Smaller than 4, so the cap stays inside the window. */
export const REVIEW_PRELOAD_CHARS_PER_TOKEN = CHARS_PER_TOKEN_SEED;

/**
 * Share of {@link fitBudgetForPinnedCtx}'s prompt budget that preloaded files
 * and follow-up tool results may use. The rest stays for the system prompt,
 * review instructions, and transcript.
 */
export const REVIEW_PRELOAD_FILE_SHARE = 0.55;

/** Preferred floors. Dropped when they are larger than the file share of the prompt. */
export const REVIEW_PRELOAD_MIN_CHARS_PER_FILE = 5000;
export const REVIEW_PRELOAD_MIN_TOTAL_CHARS = 20000;

/** Hard ceilings so a frontier window does not paste the whole tree. */
export const REVIEW_PRELOAD_MAX_CHARS_PER_FILE = 16000;
export const REVIEW_PRELOAD_MAX_TOTAL_CHARS = 48000;

export interface ReviewPreloadCaps {
  maxFiles: number;
  maxCharsPerFile: number;
  maxTotalChars: number;
}

function fileCharBudget(pinnedCtx: number, role: DynamicCtxRole): number {
  const fit = fitBudgetForPinnedCtx({ pinnedCtx, role });
  const fileTokens = Math.max(1, Math.floor(fit.promptBudget * REVIEW_PRELOAD_FILE_SHARE));
  return Math.max(1, Math.floor(fileTokens * REVIEW_PRELOAD_CHARS_PER_TOKEN));
}

/**
 * Character caps for files preloaded into one review prompt.
 * `pinnedCtx` is the reviewer model's pinned num_ctx.
 * Floors apply only when they fit in the file share of that prompt.
 */
export function reviewPreloadCaps(pinnedCtx: number, maxFiles = 8): ReviewPreloadCaps {
  const charBudget = fileCharBudget(pinnedCtx, 'reviewer');
  const minTotal = REVIEW_PRELOAD_MIN_TOTAL_CHARS <= charBudget ? REVIEW_PRELOAD_MIN_TOTAL_CHARS : 0;
  const maxTotalChars = Math.min(
    REVIEW_PRELOAD_MAX_TOTAL_CHARS,
    Math.max(minTotal, Math.min(charBudget, REVIEW_PRELOAD_MAX_TOTAL_CHARS))
  );
  const minPer = REVIEW_PRELOAD_MIN_CHARS_PER_FILE <= charBudget ? REVIEW_PRELOAD_MIN_CHARS_PER_FILE : 0;
  const maxCharsPerFile = Math.min(
    REVIEW_PRELOAD_MAX_CHARS_PER_FILE,
    maxTotalChars,
    Math.max(minPer, Math.floor(maxTotalChars / 3))
  );
  const files = Math.max(1, Math.floor(maxFiles) || 8);
  return { maxFiles: files, maxCharsPerFile, maxTotalChars };
}

/** How many characters of tool results a follow-up may paste for this pinned window. */
export function reviewFollowUpBudget(pinnedCtx: number, role: DynamicCtxRole = 'reviewer'): {
  pinnedCtx: number;
  promptBudget: number;
  toolChars: number;
} {
  const fit = fitBudgetForPinnedCtx({ pinnedCtx, role });
  return {
    pinnedCtx: fit.pinnedCtx,
    promptBudget: fit.promptBudget,
    toolChars: fileCharBudget(pinnedCtx, role)
  };
}

/** Keep the tail (the verdict instruction) when tool results exceed the file budget. */
export function boundReviewContinuation(prompt: string, maxChars: number): string {
  const text = prompt || '';
  const cap = Math.max(1, Math.floor(maxChars));
  if (text.length <= cap) return text;
  const tailLen = Math.min(900, Math.max(120, Math.floor(cap * 0.35)));
  const headLen = Math.max(0, cap - tailLen - 28);
  return `${text.slice(0, headLen)}\n…(tool results truncated)\n${text.slice(-tailLen)}`;
}

export interface ReviewVerdictTurnInput {
  reviewMode: boolean;
  stepVerdictMode?: boolean;
  finalSourceReview?: boolean;
  tools: ToolCall[];
  raw: string;
  readOnlyContinues: number;
  maxReadOnlyContinues: number;
  /** When set, a step_verdict for a different step does not count. */
  activeStepId?: string;
}

/**
 * True when this reply already contains the tag the current review mode asked for.
 * A step-verdict turn ignores review_plan / review_delta. A final source review
 * accepts only final_review. Other review turns accept review_plan or review_delta,
 * including a trailing unclosed tag.
 */
export function hasStructuredReviewResult(
  raw: string,
  mode: {
    stepVerdictMode?: boolean;
    finalSourceReview?: boolean;
    activeStepId?: string;
  } = {}
): boolean {
  const text = raw || '';
  if (mode.finalSourceReview) return !!parseFinalReview(text);
  if (mode.stepVerdictMode) {
    return (
      pickExplicitStepVerdict(
        [{ id: 'review', role: 'assistant', raw: text, personaHandle: 'reviewer' }],
        mode.activeStepId
      ) != null
    );
  }
  return !!(parseReviewPlan(text) || parseReviewDelta(text));
}

/**
 * One extra answer turn: the read cap is spent, the tools were only reads,
 * and the reviewer still has not emitted the tag for this mode.
 */
export function needsReviewVerdictTurn(input: ReviewVerdictTurnInput): boolean {
  if (!input.reviewMode && !input.stepVerdictMode) return false;
  if (!isReadOnlyToolBatch(input.tools)) return false;
  if (
    input.maxReadOnlyContinues == null ||
    input.readOnlyContinues < input.maxReadOnlyContinues
  ) {
    return false;
  }
  return !hasStructuredReviewResult(input.raw, input);
}

/** Non-plan review with neither a review_plan nor a review_delta in the reply text. */
export function nonPlanReviewLacksMarkup(raw: string): boolean {
  const text = raw || '';
  return !parseReviewPlan(text) && !parseReviewDelta(text);
}
