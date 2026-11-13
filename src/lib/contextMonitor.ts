/** Detect a local prompt that fills the context window, then shrink it for a resubmit. */

import { estimateTextTokens } from './contextSize';
import { estimateImageTokens } from './images';

export const CONTEXT_FILL_RATIO = 0.85;

/** First/last lines kept when a large fenced file body is middle-trimmed. */
export const FENCE_KEEP_HEAD_LINES = 80;
export const FENCE_KEEP_TAIL_LINES = 40;

const CAP_NOTE =
  '[Context monitor dropped the rest of this packet so the model can answer. Re-read only the one file you must change.]';

export function estimatePromptTokens(parts: string[], modelKey?: string): number {
  return estimateTextTokens(parts.join('\n'), modelKey);
}

/** True when the prompt leaves too little room to generate. */
export function promptFillsContext(tokens: number, maxCtx: number, ratio = CONTEXT_FILL_RATIO): boolean {
  if (!maxCtx || maxCtx < 512) return false;
  return tokens > Math.floor(maxCtx * ratio);
}

/**
 * The request already ran and the window was full: the model stopped for length,
 * or prompt_eval + eval consumed the num_ctx that was actually sent.
 * `maxCtx` is the configured ceiling. Pass `sentNumCtx` (the options.num_ctx on
 * that request) so a smaller pinned window still trips the retry.
 */
export function contextWasExhausted(
  stats: { promptEvalCount?: number; evalCount?: number; doneReason?: string } | undefined,
  maxCtx: number,
  sentNumCtx?: number
): boolean {
  const window =
    typeof sentNumCtx === 'number' && Number.isFinite(sentNumCtx) && sentNumCtx >= 512
      ? sentNumCtx
      : maxCtx;
  if (!stats || !window || window < 512) return false;
  if (/length|context/i.test(stats.doneReason || '')) return true;
  const prompt = stats.promptEvalCount || 0;
  const generated = stats.evalCount || 0;
  const used = prompt + generated;
  if (used >= window) return true;
  // Prompt left almost no room to answer inside the window that was sent.
  if (prompt > Math.floor(window * 0.9) && generated < 64) return true;
  // prompt_eval + eval filled the sent num_ctx, and the reply itself was short.
  return used >= Math.floor(window * 0.9) && generated < Math.floor(window * 0.25);
}

type SectionKind = 'repo-map' | 'already-written' | 'sibling' | 'protected' | 'other';

interface SectionBlock {
  kind: SectionKind;
  lines: string[];
}

/**
 * Headings that must survive every shrink. Markers match both the current
 * swarm worker packet (`### CONTRACT`, `### TASK`, `### BRIEF`, `### CURRENT FILE`)
 * and older packets (`### TASK INSTRUCTIONS`, `### STRICT TYPESCRIPT CONTRACT`,
 * `User Task / Request`, planner/reviewer/execution directives).
 */
function headingKind(line: string): SectionKind | null {
  const t = line.trim();
  if (!t) return null;
  if (/^REPO MAP\b/i.test(t)) return 'repo-map';
  if (
    /^## Already written\b/i.test(t) ||
    /^### .+\(already written\)\s*$/i.test(t) ||
    /^### DIRECT DEPENDENCIES\b/i.test(t)
  ) {
    return 'already-written';
  }
  if (/^### SIBLINGS\b/i.test(t)) return 'sibling';
  if (
    /^(?:### TASK\b|### STRICT TYPESCRIPT CONTRACT\b|### SHARED NOTES\b|### OVERALL REQUEST\b|### BRIEF\b|### CONTRACT\b|### USER REQUEST\b|### REQUEST\b)/i.test(
      t
    ) ||
    /^## PLANNER STEP\b/i.test(t) ||
    /^### Tasks\s*$/i.test(t) ||
    /^### Reviewer Nay notes\b/i.test(t) ||
    /^User Task\b/i.test(t) ||
    /^\[(?:PLANNER|REVIEWER|EXECUTION|FINAL|ACTIVE PLAN)\b/i.test(t)
  ) {
    return 'protected';
  }
  if (/^\[Active File:/i.test(t) || /^### @\S/.test(t) || /^#{2,6} /.test(t)) return 'other';
  return null;
}

function isFileHeading(line: string): boolean {
  const t = line.trim();
  return /^### CURRENT FILE\b/i.test(t) || /^\[Active File:/i.test(t) || /^### @\S/.test(t);
}

function parseBlocks(text: string): SectionBlock[] {
  const blocks: SectionBlock[] = [];
  let kind: SectionKind = 'other';
  let buf: string[] = [];
  const flush = () => {
    if (!buf.length) return;
    blocks.push({ kind, lines: buf });
    buf = [];
  };
  for (const line of text.split('\n')) {
    let next = headingKind(line);
    if (/^#### \S/.test(line.trim()) && /\.[a-z0-9]+$/i.test(line.trim())) {
      // A `#### file.ext` heading is a written-file body only under an "Already written" heading.
      if (kind === 'already-written') next = 'already-written';
      else if (kind === 'protected') next = null;
    }
    if (next) {
      flush();
      kind = next;
      buf = [line];
    } else {
      buf.push(line);
    }
  }
  flush();
  return blocks;
}

function stripCapNote(text: string): string {
  return text.split(CAP_NOTE).join('');
}

function stubAlreadyWritten(block: SectionBlock): SectionBlock {
  if (block.kind !== 'already-written') return block;
  const heading = block.lines[0] || '## Already written';
  return { kind: block.kind, lines: [heading, '_(sibling body omitted — already on disk)_'] };
}

/** Keep sibling path/export lines; drop inlined file bodies. */
function stripSiblingBodies(block: SectionBlock): SectionBlock {
  if (block.kind !== 'sibling') return block;
  const text = block.lines.join('\n').replace(/```[^\n]*\n[\s\S]*?```/g, '_(sibling body omitted — already on disk)_');
  return { kind: block.kind, lines: text.split('\n') };
}

function trimOneFence(block: string): string {
  const lines = block.split('\n');
  const head = FENCE_KEEP_HEAD_LINES;
  const tail = FENCE_KEEP_TAIL_LINES;
  if (lines.length <= head + tail + 2) return block;
  const closeAt = lines[lines.length - 1].startsWith('```') ? lines.length - 1 : lines.length;
  const body = lines.slice(1, closeAt);
  if (body.length <= head + tail) return block;
  const omitted = body.length - head - tail;
  const close = lines[closeAt]?.startsWith('```') ? lines[closeAt] : '```';
  return [
    lines[0],
    ...body.slice(0, head),
    `…(${omitted} lines omitted for context)…`,
    ...body.slice(-tail),
    close
  ].join('\n');
}

function windowLines(lines: string[]): string[] {
  const head = FENCE_KEEP_HEAD_LINES;
  const tail = FENCE_KEEP_TAIL_LINES;
  if (lines.length <= head + tail) return lines;
  const omitted = lines.length - head - tail;
  return [...lines.slice(0, head), `…(${omitted} lines omitted for context)…`, ...lines.slice(-tail)];
}

function trimBlockFences(block: SectionBlock): SectionBlock {
  if (block.kind === 'protected' || block.kind === 'repo-map' || block.kind === 'already-written') return block;
  let lines = block.lines;
  const original = lines.join('\n');
  if (/```/.test(original)) {
    lines = original.replace(/```[^\n]*\n[\s\S]*?```/g, fence => trimOneFence(fence)).split('\n');
  } else if (isFileHeading(lines[0] || '')) {
    // Current-file packets are often raw text, not a fence.
    lines = [lines[0], ...windowLines(lines.slice(1))];
  }
  if (lines.join('\n') === original) return block;
  return { kind: block.kind, lines };
}

function joinBlocks(blocks: SectionBlock[]): string {
  return blocks
    .map(b => b.lines.join('\n'))
    .join('\n')
    .trim();
}

/**
 * Keep every protected block, and emit them ahead of file bodies.
 * Fill the remaining budget from the head of unprotected blocks.
 */
function capKeepingProtected(blocks: SectionBlock[], cap: number): string {
  const protectedBlocks = blocks.filter(b => b.kind === 'protected' && b.lines.join('\n').trim());
  const unprotected = blocks.filter(b => b.kind !== 'protected' && b.lines.join('\n').trim());
  const protectedText = protectedBlocks.map(b => b.lines.join('\n')).join('\n');
  if (!unprotected.length) return protectedText.trim();

  const noteReserve = CAP_NOTE.length + 2;
  let budget = cap - protectedText.length - noteReserve;
  const out: string[] = [];
  if (protectedText.trim()) out.push(protectedText);
  let dropped = false;
  for (const block of unprotected) {
    const text = block.lines.join('\n');
    if (!text.trim()) continue;
    if (budget <= 0) {
      dropped = true;
      continue;
    }
    if (text.length <= budget) {
      out.push(text);
      budget -= text.length + 1;
    } else {
      out.push(text.slice(0, Math.max(0, budget)));
      budget = 0;
      dropped = true;
    }
  }
  const body = out.join('\n').trim();
  return dropped ? `${body}\n\n${CAP_NOTE}` : body;
}

/**
 * Shrink a user packet by labeled sections.
 * Drops the repo map, then sibling / "Already written" bodies, then the middle
 * of large fenced file bodies (first ~80 and last ~40 lines). Protected sections
 * (task, contract, user request, planner/reviewer/execution directives) are kept.
 * A char cap keeps that protected suffix plus the head of whatever remains.
 */
export function shrinkUserPacket(text: string, level: number, opts?: { cap?: boolean }): string {
  const capSize = level >= 2 ? 6000 : 14000;
  const doCap = opts?.cap !== false;
  let blocks = parseBlocks(stripCapNote(text || ''));
  blocks = blocks.filter(b => b.kind !== 'repo-map');
  if (level >= 1) {
    blocks = blocks.map(stubAlreadyWritten).map(stripSiblingBodies).map(trimBlockFences);
  }
  if (!doCap) return joinBlocks(blocks);
  const assembled = joinBlocks(blocks);
  if (assembled.length <= capSize) return assembled;
  return capKeepingProtected(blocks, capSize);
}

export interface FittedPrompt {
  userContent: string;
  history: Array<{ role: string; content: string; images?: Array<string | { width?: number; height?: number }> }>;
  shrinks: number;
  note: string;
  /** Images still attached after the fit. Omitted when the caller passed none. */
  images?: Array<string | { width?: number; height?: number }>;
  droppedImages?: number;
}

type Hist = FittedPrompt['history'][number];
type ImagePart = string | { width?: number; height?: number };

function imageTokenSum(list?: ImagePart[]): number {
  return (list || []).reduce((sum, img) => sum + estimateImageTokens(img), 0);
}

/**
 * Shrink history and the user packet until the estimate fits.
 * Order: repo map, sibling bodies, fence middles, images, then a protected char cap.
 * `promptBudget` (from fitBudgetForPinnedCtx) is a hard token ceiling. Otherwise the
 * legacy 85% fill check against `maxCtx` is used.
 */
export function fitPromptToContext(opts: {
  system: string;
  userContent: string;
  history: Hist[];
  maxCtx: number;
  frontier?: boolean;
  modelKey?: string;
  images?: ImagePart[];
  /** Prompt-token ceiling for a pinned num_ctx. When set, this replaces the 85% fill test. */
  promptBudget?: number;
}): FittedPrompt {
  const passImages = opts.images?.slice();
  if (opts.frontier) {
    return {
      userContent: opts.userContent,
      history: opts.history,
      shrinks: 0,
      note: '',
      ...(passImages ? { images: passImages, droppedImages: 0 } : {})
    };
  }

  let userContent = opts.userContent;
  let history = opts.history.slice();
  let images: ImagePart[] = passImages ? passImages.slice() : [];
  let droppedImages = 0;
  let shrinks = 0;

  const countImgs = () => images.length + history.reduce((n, h) => n + (h.images?.length || 0), 0);
  const measure = () =>
    estimateTextTokens(
      [opts.system, ...history.map(h => h.content), userContent].join('\n'),
      opts.modelKey
    ) +
    imageTokenSum(images) +
    history.reduce((n, h) => n + imageTokenSum(h.images), 0);
  const over = () => {
    const tokens = measure();
    if (typeof opts.promptBudget === 'number' && opts.promptBudget > 0) return tokens > opts.promptBudget;
    return promptFillsContext(tokens, opts.maxCtx);
  };
  const dropImgs = () => {
    const n = countImgs();
    if (!n) return false;
    droppedImages += n;
    images = [];
    history = history.map(h => (h.images?.length ? { ...h, images: undefined } : h));
    return true;
  };

  // 1. Labeled sections (map, siblings, fence middles) — no char cap yet.
  if (over()) {
    shrinks = 1;
    history = history.slice(-1);
    userContent = shrinkUserPacket(userContent, 1, { cap: false });
  }
  // 2. Images before the blunt text cap, so a screenshot cannot push the task out.
  if (over() && dropImgs()) {
    shrinks = Math.max(shrinks, 2);
    history = [];
  }
  // 3. Char cap that keeps the protected suffix.
  if (over()) {
    shrinks = shrinks === 0 ? 1 : Math.max(shrinks + 1, 2);
    history = [];
    userContent = shrinkUserPacket(userContent, 2);
  }
  if (over() && dropImgs()) shrinks += 1;
  if (over()) {
    shrinks += 1;
    history = [];
    userContent = shrinkUserPacket(userContent, 2);
  }

  const note = shrinks
    ? `Context monitor: prompt filled ${opts.maxCtx} tokens, so the packet was shrunk (${shrinks}) and resent.`
    : '';
  return {
    userContent,
    history,
    shrinks,
    note,
    ...(passImages || droppedImages ? { images, droppedImages } : {})
  };
}
