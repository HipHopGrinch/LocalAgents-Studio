/** Detect a local prompt that fills the context window, then shrink it for a resubmit. */

export const CONTEXT_FILL_RATIO = 0.85;

export function estimatePromptTokens(parts: string[]): number {
  return Math.ceil(parts.join('\n').length / 4);
}

/** True when the prompt leaves too little room to generate. */
export function promptFillsContext(tokens: number, maxCtx: number, ratio = CONTEXT_FILL_RATIO): boolean {
  if (!maxCtx || maxCtx < 512) return false;
  return tokens > Math.floor(maxCtx * ratio);
}

/**
 * The request already ran and the window was full: the model stopped for length,
 * or the prompt itself consumed almost the whole context.
 */
export function contextWasExhausted(
  stats: { promptEvalCount?: number; evalCount?: number; doneReason?: string } | undefined,
  maxCtx: number
): boolean {
  if (!stats || !maxCtx || maxCtx < 512) return false;
  if (/length|context/i.test(stats.doneReason || '')) return true;
  const prompt = stats.promptEvalCount || 0;
  const generated = stats.evalCount || 0;
  return prompt > Math.floor(maxCtx * 0.9) && generated < 64;
}

/** Drop the repo map and shorten inlined file bodies. Level 2 keeps only the task text. */
export function shrinkUserPacket(text: string, level: number): string {
  let body = text || '';
  body = body.replace(/REPO MAP[\s\S]*?(?=\n## |\n### MODEL FIT|\n\[PLANNER|\n\[REVIEWER|\n\[EXECUTION|\n\[FINAL|$)/i, '');
  if (level >= 1) {
    body = body.replace(/```[\s\S]*?```/g, (block) => {
      if (block.length <= 1200) return block;
      return `${block.slice(0, 1200)}\n…(truncated for context)\n\`\`\``;
    });
  }
  const cap = level >= 2 ? 6000 : 14000;
  if (body.length > cap) {
    body = `${body.slice(0, cap)}\n\n[Context monitor dropped the rest of this packet so the model can answer. Re-read only the one file you must change.]`;
  }
  return body.trim();
}

export interface FittedPrompt {
  userContent: string;
  history: Array<{ role: string; content: string }>;
  shrinks: number;
  note: string;
}

/** Shrink history and the user packet until the estimate fits, at most twice. */
export function fitPromptToContext(opts: {
  system: string;
  userContent: string;
  history: Array<{ role: string; content: string }>;
  maxCtx: number;
  frontier?: boolean;
}): FittedPrompt {
  if (opts.frontier) {
    return { userContent: opts.userContent, history: opts.history, shrinks: 0, note: '' };
  }
  let userContent = opts.userContent;
  let history = opts.history.slice();
  let shrinks = 0;
  const measure = () =>
    estimatePromptTokens([opts.system, ...history.map(h => h.content), userContent]);
  while (shrinks < 2 && promptFillsContext(measure(), opts.maxCtx)) {
    shrinks += 1;
    history = shrinks === 1 ? history.slice(-1) : [];
    userContent = shrinkUserPacket(userContent, shrinks);
  }
  const note = shrinks
    ? `Context monitor: prompt filled ${opts.maxCtx} tokens, so the packet was shrunk (${shrinks}) and resent.`
    : '';
  return { userContent, history, shrinks, note };
}
