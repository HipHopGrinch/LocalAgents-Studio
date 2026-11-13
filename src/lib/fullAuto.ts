import type { PlanOption } from '../types';
import { matchPlanOption, parseStepVerdict } from './planOptions';
import { inferDeliveryFromText } from './projectScaffold';

/** One short reviewer turn when a step verdict tag was missing. */
export const VERDICT_REASK_PROMPT =
  'Reply with ONLY a <step_verdict> block: <step_verdict><result>yay|nay</result><notes>...</notes></step_verdict>';

export const MISSING_VERDICT_NOTE = 'Reviewer gave no explicit verdict.';

export const CODER_WRITES_FAILED_NOTE = 'Coder writes failed or are still pending.';

const NOTE_CAP = 600;

/** Drop think-blocks and tags. Empty input stays empty so callers can substitute a fallback. */
export function plainNote(text: string, cap = NOTE_CAP): string {
  return (text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, cap);
}

/** Nay notes when the reviewer never emitted an explicit yay/nay. */
export function nayNotesFromReviewerProse(text: string, cap = NOTE_CAP): string {
  return plainNote(text, cap) || MISSING_VERDICT_NOTE;
}

/** Nay notes from failed or still-pending write/edit tool rows. */
export function nayNotesFromToolErrors(lines: string[], cap = NOTE_CAP): string {
  return plainNote(lines.join('\n'), cap) || CODER_WRITES_FAILED_NOTE;
}

/**
 * A plan card Full auto may lock.
 * Paid, stop, and copy stay manual. retry-local is the stuck ladder, not a delivery plan.
 */
export function isFullAutoPlanOption(option: PlanOption): boolean {
  return !option.action || option.action === 'run';
}

/**
 * Pick a delivery plan: title/description match, then delivery, then the first runnable option.
 * Returns null when fewer than two options exist or every option needs a person.
 */
export function chooseFullAutoPlanOption(
  options: PlanOption[],
  requestText: string
): PlanOption | null {
  if (!options || options.length < 2) return null;
  const runnable = options.filter(isFullAutoPlanOption);
  if (!runnable.length) return null;
  const matched = matchPlanOption(requestText || '', options);
  if (matched && isFullAutoPlanOption(matched)) return matched;
  const want = inferDeliveryFromText(requestText || '');
  if (want) {
    const byDelivery = runnable.find(option => {
      const delivery =
        option.delivery || inferDeliveryFromText(`${option.title} ${option.description}`);
      return delivery === want;
    });
    if (byDelivery) return byDelivery;
  }
  return runnable[0];
}

export function fullAutoPickNotice(option: PlanOption): string {
  return `Full auto picked option ${option.id}: ${option.title}`;
}

export interface ReviewVerdictMessage {
  id: string;
  role: string;
  raw?: string;
  display?: string;
  personaHandle?: string;
  stepVerdict?: {
    stepId: string;
    result: string;
    notes: string;
  };
}

export function messagesFromOrigin<T extends { id: string }>(messages: T[], originId?: string): T[] {
  if (!originId) return [];
  const start = messages.findIndex(message => message.id === originId);
  if (start < 0) return [];
  return messages.slice(start);
}

function looksLikeReviewer(message: ReviewVerdictMessage): boolean {
  if (message.role !== 'assistant') return false;
  if (message.personaHandle === 'reviewer' || message.stepVerdict) return true;
  return /<step_verdict\b/i.test(message.raw || '');
}

export interface ExplicitStepVerdict {
  stepId: string;
  result: 'yay' | 'nay';
  notes: string;
}

/**
 * Last `<step_verdict>` in one reply. Closed blocks are preferred, but a trailing
 * unclosed tag after the last `</step_verdict>` wins — local models often omit the close.
 * `parseStepVerdict` only sees the first tag, so callers parse this slice.
 */
export function lastClosedStepVerdictBlock(raw: string): string {
  const text = (raw || '').replace(/<think>[\s\S]*?<\/think>/gi, '');
  const re = /<step_verdict\b[^>]*>[\s\S]*?<\/step_verdict\s*>/gi;
  let last = '';
  let lastEnd = 0;
  for (let match = re.exec(text); match; match = re.exec(text)) {
    last = match[0];
    lastEnd = match.index + match[0].length;
  }
  const unclosed = /<step_verdict\b[^>]*>[\s\S]*$/i.exec(text.slice(lastEnd));
  if (unclosed && /<step_verdict\b/i.test(unclosed[0])) return unclosed[0];
  return last;
}

function verdictFitsStep(stepId: string, activeStepId?: string): boolean {
  if (!activeStepId) return true;
  if (!stepId) return true;
  return String(stepId) === String(activeStepId);
}

/**
 * Newest explicit yay/nay in this review turn.
 * A step id that is present and different is skipped. An empty id is kept.
 * Within one message the last closed tag wins over a stored verdict and over the first tag.
 * Prose with no tag is not a verdict (`parseStepVerdict` allowMissing stays 'missing').
 */
export function pickExplicitStepVerdict<T extends ReviewVerdictMessage>(
  messages: T[],
  activeStepId?: string
): { message: T; parsed: ExplicitStepVerdict } | null {
  const active = activeStepId != null && String(activeStepId) !== '' ? String(activeStepId) : '';
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!looksLikeReviewer(message)) continue;
    const block = lastClosedStepVerdictBlock(message.raw || '');
    const parsed = parseStepVerdict(block || message.raw || '', { allowMissing: true });
    if (parsed.result === 'yay' || parsed.result === 'nay') {
      if (!verdictFitsStep(parsed.stepId, active)) continue;
      return {
        message,
        parsed: {
          stepId: active || parsed.stepId,
          result: parsed.result,
          notes: parsed.notes
        }
      };
    }
    const stored = message.stepVerdict;
    if (
      stored &&
      (stored.result === 'yay' || stored.result === 'nay') &&
      verdictFitsStep(stored.stepId, active)
    ) {
      return {
        message,
        parsed: {
          stepId: active || stored.stepId || '',
          result: stored.result,
          notes: stored.notes || ''
        }
      };
    }
  }
  return null;
}

export function newestReviewerMessage<T extends ReviewVerdictMessage>(messages: T[]): T | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (looksLikeReviewer(messages[i])) return messages[i];
  }
  return undefined;
}

export interface PlanChoiceMessage {
  id: string;
  role: string;
  planOptions?: PlanOption[];
  selectedPlanOptionId?: string;
}

/** Newest unchosen card in this planner turn. A selection anywhere in the turn ends auto-pick. */
export function pendingPlanChoice<T extends PlanChoiceMessage>(
  messages: T[],
  originId?: string
): T | null {
  const slice = messagesFromOrigin(messages, originId);
  if (!slice.length) return null;
  if (slice.some(message => !!message.selectedPlanOptionId)) return null;
  for (let i = slice.length - 1; i >= 0; i--) {
    const message = slice[i];
    if (message.role !== 'assistant') continue;
    if ((message.planOptions?.length || 0) >= 2) return message;
  }
  return null;
}

/** Per-step one-shot flags. A new step id clears both. */
export interface FullAutoStepGate {
  stepId: string;
  verdictReasked: boolean;
  coderRedispatched: boolean;
}

export function gateForStep(previous: FullAutoStepGate | null, stepId: string): FullAutoStepGate {
  const id = String(stepId);
  if (previous && previous.stepId === id) return previous;
  return { stepId: id, verdictReasked: false, coderRedispatched: false };
}

/** True until a re-ask has actually returned on a live run. Checking does not spend the flag. */
export function canReaskMissingVerdict(previous: FullAutoStepGate | null, stepId: string): boolean {
  return !gateForStep(previous, stepId).verdictReasked;
}

/** Call only after the re-ask turn returned while its conductor run was still live. */
export function rememberVerdictReask(previous: FullAutoStepGate | null, stepId: string): FullAutoStepGate {
  return { ...gateForStep(previous, stepId), verdictReasked: true };
}

export function takeVerdictReask(
  previous: FullAutoStepGate | null,
  stepId: string
): { gate: FullAutoStepGate; allowed: boolean } {
  const current = gateForStep(previous, stepId);
  if (current.verdictReasked) return { gate: current, allowed: false };
  return { gate: rememberVerdictReask(current, stepId), allowed: true };
}

export function canCoderRedispatch(previous: FullAutoStepGate | null, stepId: string): boolean {
  return !gateForStep(previous, stepId).coderRedispatched;
}

/** Spend the flag before the nested dispatch awaits, so a rework inside it cannot retry again. */
export function rememberCoderRedispatch(
  previous: FullAutoStepGate | null,
  stepId: string
): FullAutoStepGate {
  return { ...gateForStep(previous, stepId), coderRedispatched: true };
}

/** Give back a spent re-dispatch when its run died. A gate that now belongs to another step is left alone. */
export function releaseCoderRedispatch(
  previous: FullAutoStepGate | null,
  stepId: string
): FullAutoStepGate | null {
  if (!previous || previous.stepId !== String(stepId)) return previous;
  if (!previous.coderRedispatched) return previous;
  return { ...previous, coderRedispatched: false };
}

export function takeCoderRedispatch(
  previous: FullAutoStepGate | null,
  stepId: string
): { gate: FullAutoStepGate; allowed: boolean } {
  const current = gateForStep(previous, stepId);
  if (current.coderRedispatched) return { gate: current, allowed: false };
  return { gate: rememberCoderRedispatch(current, stepId), allowed: true };
}
