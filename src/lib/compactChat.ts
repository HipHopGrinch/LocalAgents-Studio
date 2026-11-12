import { ChatMessage } from '../types';
import { estimateTextTokens } from './contextSize';

/** Token count of the text that would be sent back to the model. Pass the routed model key to use calibration. */
export function historyTokens(messages: ChatMessage[], modelKey?: string): number {
  return messages.reduce(
    (sum, message) => sum + estimateTextTokens(message.raw || message.display || '', modelKey),
    0
  );
}

/**
 * True when history exceeds ~55% of the routed model's num_ctx.
 * `numCtx` must be that model's pinned context, not the selected node's ceiling.
 */
export function shouldCompact(messages: ChatMessage[], numCtx: number, modelKey?: string): boolean {
  if (messages.length < 6) return false;
  // Keep more room than the old 40% cut so tool results survive longer.
  const budget = Math.max(4000, Math.floor((numCtx || 16384) * 0.55));
  return historyTokens(messages, modelKey) > budget;
}

/** Plan, contract path, and work log kept at the front of every compacted summary. */
export interface CompactPinnedState {
  planSummary?: string;
  contractPath?: string;
  workLog?: string;
}

function pinnedPrefix(pinned?: CompactPinnedState): string {
  if (!pinned) return '';
  const lines: string[] = [];
  if (pinned.planSummary?.trim()) lines.push(`Plan: ${pinned.planSummary.trim()}`);
  if (pinned.contractPath?.trim()) lines.push(`Contract: ${pinned.contractPath.trim()}`);
  if (pinned.workLog?.trim()) lines.push(`Work log:\n${pinned.workLog.trim()}`);
  return lines.join('\n');
}

function pathNote(verb: string, attrs: string): string {
  const path = /path="([^"]*)"/i.exec(attrs)?.[1];
  return path ? `${verb} ${path}` : verb;
}

/** Last assistant turn keeps tool paths, not file bodies. */
function withoutFileBodies(message: ChatMessage): ChatMessage {
  const strip = (text: string) =>
    text
      .replace(/<write_file\b([^>]*)>[\s\S]*?<\/write_file>/gi, (_m, attrs: string) => pathNote('Wrote', attrs))
      .replace(/<edit_file\b([^>]*)>[\s\S]*?<\/edit_file>/gi, (_m, attrs: string) => pathNote('Edited', attrs))
      .replace(/<write_file\b([^>]*)>[\s\S]*$/gi, (_m, attrs: string) => pathNote('Wrote', attrs))
      .replace(/<edit_file\b([^>]*)>[\s\S]*$/gi, (_m, attrs: string) => pathNote('Edited', attrs));
  return {
    ...message,
    raw: strip(message.raw || ''),
    display: strip(message.display || ''),
    toolCalls: message.toolCalls?.map(tool =>
      tool.name === 'write_file' || tool.name === 'edit_file'
        ? { ...tool, body: undefined, result: undefined }
        : tool
    )
  };
}

function toolOneLiners(message: ChatMessage): string[] {
  const notes: string[] = [];
  const take = (name: string, path?: string, status?: string, result?: string) => {
    if (name === 'write_file' || name === 'edit_file') {
      if (!path) return;
      notes.push(
        `Tool: ${status === 'done' ? (name === 'edit_file' ? 'Edited' : 'Wrote') : 'Proposed'} ${path}`
      );
      return;
    }
    if (name === 'run_command') {
      const cmd = (result || '').split('\n')[0]?.slice(0, 80) || path || 'command';
      const exit = /Exit code:\s*(\d+)/i.exec(result || '');
      notes.push(`Tool: Ran command (${exit ? `exit ${exit[1]}` : status || 'done'}) — ${cmd}`);
      return;
    }
    if (name === 'read_file' && path) notes.push(`Tool: Read ${path}`);
    if (name === 'list_dir' && path) notes.push(`Tool: Listed ${path}`);
  };
  for (const tool of message.toolCalls || []) {
    take(tool.name, tool.args?.path, tool.status, tool.result || tool.body);
  }
  for (const step of message.pipelineSteps || []) {
    for (const tool of step.toolCalls || []) {
      take(tool.name, tool.args?.path || step.targetFile, tool.status, tool.result || tool.body);
    }
  }
  return notes;
}

function shortenMessage(message: ChatMessage, keepImages: boolean, keepTools: boolean): ChatMessage {
  const notes = toolOneLiners(message);
  const prose = (message.display || message.raw || '').replace(/\s+/g, ' ').trim().slice(0, 700);
  const text = [prose, notes.length ? notes.join('\n') : ''].filter(Boolean).join('\n').trim() || '(empty)';
  return {
    ...message,
    raw: text,
    display: (message.display || '').length <= 900 && keepTools ? message.display || text : text,
    thinking: undefined,
    images: keepImages ? message.images : undefined,
    toolCalls: keepTools
      ? (message.toolCalls || []).map(t => ({
          ...t,
          body: undefined,
          result: t.result ? t.result.slice(0, 240) : t.result
        }))
      : undefined,
    pipelineSteps: undefined
  };
}

/**
 * Fold older turns into one short note. Keep the first user ask and the last 3 turns
 * with tool one-liners. Full file bodies are dropped. `pinned` (plan, contract path,
 * work log) is always prepended to the compacted summary.
 */
export function compactMessages(messages: ChatMessage[], pinned?: CompactPinnedState): ChatMessage[] {
  if (messages.length < 6) return messages;
  const recent = messages.slice(-3);
  const firstUser = messages.find(message => message.role === 'user');
  const dropped = messages.slice(0, messages.length - 3).filter(message => message.id !== firstUser?.id);
  const lines = [
    ...new Set(
      dropped.flatMap(message => {
        const bits: string[] = [];
        if (message.role === 'user') {
          const asked = (message.display || message.raw || '').replace(/\s+/g, ' ').trim().slice(0, 180);
          if (asked) bits.push(`Asked: ${asked}`);
        }
        bits.push(...toolOneLiners(message));
        return bits;
      })
    )
  ].slice(-40);

  const pin = pinnedPrefix(pinned);
  const summary: ChatMessage = {
    id: `compact-${Date.now()}`,
    role: 'assistant',
    raw: [
      pin,
      '[Compacted earlier chat]',
      `Folded ${dropped.length} messages. Finished steps and the next step are in the work log, which is still in context.`,
      lines.join('\n')
    ]
      .filter(Boolean)
      .join('\n'),
    display: `Compacted ${dropped.length} earlier messages. The work log still has the finished steps and the next step.`,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    notice: 'Compacted conversation'
  };

  const head =
    firstUser && !recent.some(message => message.id === firstUser.id)
      ? [shortenMessage(firstUser, false, false)]
      : [];
  const lastUserId = [...recent].reverse().find(message => message.role === 'user')?.id;
  const folded = [
    ...head,
    summary,
    ...recent.map(message => shortenMessage(message, message.id === lastUserId, true))
  ];
  let lastAssistant = -1;
  for (let i = 0; i < folded.length; i++) {
    if (folded[i].role === 'assistant') lastAssistant = i;
  }
  if (lastAssistant >= 0) folded[lastAssistant] = withoutFileBodies(folded[lastAssistant]);
  return folded;
}
