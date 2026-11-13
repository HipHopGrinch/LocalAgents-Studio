/**
 * One consistent reading for the composer's context meter: used tokens, window, model and
 * node always come from the same request. Never one model's prompt over another model's window.
 */

export interface MeterSnapshotInput {
  model: string;
  pinnedCtx: number;
  promptTokens?: number;
}

export interface MeterMessageInput {
  role: string;
  model?: string;
  endpointName?: string;
  stats?: { promptTokens?: number; numCtx?: number };
}

export interface MeterReading {
  used?: number;
  pinned: number;
  model?: string;
  node?: string;
}

export interface MeterTargetInput {
  model?: string;
  node?: string;
  pinned: number;
}

export function resolveContextMeter(input: {
  snapshot: MeterSnapshotInput | null;
  /** Oldest first, as the transcript stores them. */
  messages: MeterMessageInput[];
  /** Selected chat target, shown while no request has been sized yet. */
  target: MeterTargetInput;
  /** Node names that have this model enabled. A name is shown only when exactly one does. */
  nodesFor?: (model: string) => string[];
}): MeterReading {
  const { snapshot, messages, target } = input;
  const sampled = (model?: string) => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== 'assistant' || !((m.stats?.promptTokens || 0) > 0)) continue;
      if (model !== undefined && m.model !== model) continue;
      return m;
    }
    return undefined;
  };
  const soleNode = (model: string) => {
    const names = input.nodesFor?.(model) || [];
    return names.length === 1 ? names[0] : undefined;
  };

  if (snapshot && snapshot.pinnedCtx > 0 && snapshot.model) {
    const match = sampled(snapshot.model);
    const node = match?.endpointName || soleNode(snapshot.model);
    if (snapshot.promptTokens && snapshot.promptTokens > 0) {
      return { used: snapshot.promptTokens, pinned: snapshot.pinnedCtx, model: snapshot.model, node };
    }
    // No sample on the snapshot yet: a message of the same model carries its own window.
    if (match?.stats?.numCtx) {
      return { used: match.stats.promptTokens, pinned: match.stats.numCtx, model: snapshot.model, node };
    }
    return { pinned: snapshot.pinnedCtx, model: snapshot.model, node };
  }

  const last = sampled();
  if (last?.stats?.numCtx && last.model) {
    return {
      used: last.stats.promptTokens,
      pinned: last.stats.numCtx,
      model: last.model,
      node: last.endpointName
    };
  }
  return { pinned: target.pinned, model: target.model, node: target.node };
}
