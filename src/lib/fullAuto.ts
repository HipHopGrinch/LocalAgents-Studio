import type { PlanOption } from '../types';
import { matchPlanOption, parseStepVerdict } from './planOptions';
import { inferDeliveryFromText } from './projectScaffold';

/** One short reviewer turn when a step verdict tag was missing. */
export const VERDICT_REASK_PROMPT =
  'Reply with ONLY a <step_verdict> block: <step_verdict><result>yay|nay</result><notes>...</notes></step_verdict>';

export const MISSING_VERDICT_NOTE = 'Reviewer gave no explicit verdict.';

/**
 * Re-ask for a verdict that still names the step and carries what the first prompt had.
 * The re-ask runs in a fresh context, so without the header the Reviewer does not know which
 * step it is judging and goes reading files (or judges the wrong step).
 */
export function verdictReaskPromptWithContext(input: {
  stepId: string;
  /** `formatStepForReviewer(plan, step)` for the step being judged. */
  header: string;
  filesHint?: string;
  filesBody?: string;
  /** Green-verify statement, when Studio just saw one. */
  verifyStatement?: string;
  /** End-of-plan pass on a step that was marked failed. */
  debt?: boolean;
}): string {
  const files = input.filesBody?.trim() || '(No file bodies were loaded for this step.)';
  return `${input.header}

${input.filesHint ? `${input.filesHint}\n\n` : ''}${files}
${input.verifyStatement ? `\n${input.verifyStatement}\n` : ''}
Your previous reply had no <step_verdict>. Judge plan step #${input.stepId} now${
    input.debt ? ' (an end-of-plan pass on a step that was marked failed)' : ''
  }, and no other step. The files above are already loaded: do not read files or call tools.
${VERDICT_REASK_PROMPT}`;
}

/** One short reviewer turn when a review-fix task verdict tag was missing. */
export function reviewDeltaReaskPrompt(taskId: string): string {
  return `Reply with ONLY a <review_delta task_id="${taskId}"> block: <verdict>completed|failed</verdict><notes>...</notes></review_delta>`;
}

/** {@link reviewDeltaReaskPrompt} with the task header and the file bodies the first prompt had. */
export function reviewDeltaReaskPromptWithContext(
  taskId: string,
  input: { header: string; filesHint?: string; filesBody?: string }
): string {
  const files = input.filesBody?.trim() || '(No file bodies were loaded for this task.)';
  return `${input.header}

${input.filesHint ? `${input.filesHint}\n\n` : ''}${files}

Your previous reply had no <review_delta>. Verify ONLY task #${taskId} now. The files above are already loaded: do not read files or call tools.
${reviewDeltaReaskPrompt(taskId)}`;
}

export const MISSING_DELTA_NOTE = 'Reviewer gave no verdict on the fix task after one re-ask — treated as Fail.';

/** What the review-fix path records for a reply that never named completed or failed. */
export function missingDeltaAsFail(taskId: string): {
  taskId: string;
  verdict: 'failed';
  notes: string;
} {
  return { taskId, verdict: 'failed', notes: MISSING_DELTA_NOTE };
}

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

/** Recorded on a step that advanced on green verify because the Reviewer never gave a verdict. */
export function noVerdictAdvanceNote(stepId: string): string {
  return `Reviewer gave no verdict for step #${stepId}; project verify passed, so the step advanced without a Reviewer verdict.`;
}

const FINDING_WORDS =
  /\b(bug|error|wrong|incorrect|missing|broken|fails?|failing|failed|stubs?|placeholder|mismatch|undefined|unwired|unused|never called|not (?:implemented|wired|handled|exported|imported)|does(?:n't| not)|do(?:n't| not)|should)\b/i;

/**
 * True when a reply with no verdict tag still lists real problems (a prose Nay), as opposed to
 * an empty reply, tool calls only, or a short "let me look" line.
 */
export function hasProseFindings(text: string): boolean {
  const plain = plainNote(text, 4000);
  return plain.length >= 80 && FINDING_WORDS.test(plain);
}

export interface ProseVerdict {
  result: 'yay' | 'nay';
  notes: string;
}

const PROSE_EDGE = '[\\s>*_#`"\'(\\[-]*';
const PROSE_LEAD_YN = new RegExp(`^${PROSE_EDGE}(yay|nay)\\b`, 'i');
// Bare pass/fail only count as a lone leading word ("PASS", "Fail — ..."), never as "Pass the ...".
const PROSE_LEAD_PF = new RegExp(`^${PROSE_EDGE}(pass|fail)\\b\\s*(?:[:.,;!\\-–—)\\]*_\`]|$)`, 'i');
const PROSE_LABELED =
  /\b(?:final\s+)?(?:verdict|result|decision)\s*(?:is|[:=\-–—])\s*[*_`"'(\[]*\s*(yay|nay|pass(?:ed)?|fail(?:ed)?|approved?|rejected?)\b/gi;

function proseWordResult(word: string): 'yay' | 'nay' {
  return /^(yay|pass|approve)/i.test(word) ? 'yay' : 'nay';
}

/**
 * Verdict from a reply that has no `<step_verdict>` tag: a leading yay/nay/PASS/FAIL, or an
 * explicit "Verdict: yay" / "result: fail" label. Text that gives both answers, or neither,
 * is null so the caller keeps its missing-verdict handling.
 */
export function parseProseVerdict(text: string): ProseVerdict | null {
  const plain = plainNote(text, 4000);
  if (!plain) return null;
  const found = new Set<'yay' | 'nay'>();
  const lead = PROSE_LEAD_YN.exec(plain) || PROSE_LEAD_PF.exec(plain);
  if (lead) found.add(proseWordResult(lead[1]));
  for (const match of plain.matchAll(PROSE_LABELED)) found.add(proseWordResult(match[1]));
  if (found.size !== 1) return null;
  const result = [...found][0];
  const body = (lead ? plain.slice(lead[0].length) : plain)
    .replace(/^[\s:.,;!\-–—*_`]+/, '')
    .trim()
    .slice(0, NOTE_CAP);
  return { result, notes: body || (result === 'yay' ? 'Reviewer passed the step.' : 'Reviewer failed the step.') };
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

/**
 * Newest Reviewer reply with no usable `<step_verdict>` whose prose still states a verdict
 * (see {@link parseProseVerdict}). Callers try {@link pickExplicitStepVerdict} first.
 */
export function pickProseStepVerdict<T extends ReviewVerdictMessage>(
  messages: T[],
  activeStepId?: string
): { message: T; parsed: ExplicitStepVerdict } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!looksLikeReviewer(message)) continue;
    const text = message.raw || message.display || '';
    if (/<step_verdict\b/i.test(text)) continue;
    const prose = parseProseVerdict(text);
    if (prose) {
      return {
        message,
        parsed: { stepId: activeStepId != null ? String(activeStepId) : '', result: prose.result, notes: prose.notes }
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
