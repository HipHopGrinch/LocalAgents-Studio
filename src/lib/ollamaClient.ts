import { ChatEvent, PullEvent } from '../types';
import { detectRepeatedToolTagSpam } from './agentLoop';
import {
  frontierThinkLabel,
  noteReasoningObservation,
  splitInlineThinking
} from './modelProfile';

export type StreamFailureCode = 'idle_timeout' | 'absolute_timeout' | 'stall' | 'aborted' | 'stream_error';

/** Thrown when a chat stream fails. `retriable` is set for idle stalls and deadlines. */
export class StreamChatError extends Error {
  readonly retriable: boolean;
  readonly code: StreamFailureCode;
  readonly requestId: string;

  constructor(
    message: string,
    init: { retriable: boolean; code: StreamFailureCode; requestId: string }
  ) {
    super(message);
    this.name = 'StreamChatError';
    this.retriable = init.retriable;
    this.code = init.code;
    this.requestId = init.requestId;
  }
}

export function isRetriableStreamError(err: unknown): err is StreamChatError {
  return err instanceof StreamChatError && err.retriable;
}

/**
 * Classify a main-process chat failure. Idle / stall / absolute deadline are retriable.
 * User abort is not a stream error — `streamChat` resolves `{ aborted: true }` and flips `handle.signal`.
 */
export function classifyStreamError(
  message: string | undefined,
  hint?: { retriable?: boolean; code?: string }
): { retriable: boolean; code: StreamFailureCode } {
  const code = (hint?.code || '').toLowerCase();
  if (code === 'idle_timeout' || code === 'absolute_timeout' || code === 'stall') {
    return { retriable: true, code };
  }
  const msg = message || '';
  if (/absolute[\s_-]*timeout|deadline exceeded|exceeded the \d+ minute/i.test(msg)) {
    return { retriable: true, code: 'absolute_timeout' };
  }
  if (/stall(ed)?|no (?:output|chunk|token|data)/i.test(msg)) {
    return { retriable: true, code: 'stall' };
  }
  if (/idle[\s_-]*timeout|timed out|timeout/i.test(msg) && !/abort/i.test(msg)) {
    return { retriable: true, code: 'idle_timeout' };
  }
  if (hint?.retriable) return { retriable: true, code: 'stall' };
  return { retriable: false, code: 'stream_error' };
}

type ChatHandler = (e: ChatEvent) => void;
type PullHandler = (e: PullEvent) => void;

const chatHandlers = new Map<string, ChatHandler>();
const pullHandlers = new Map<string, PullHandler>();
let subscribed = false;

function ensureSubscribed() {
  if (subscribed || !window.electronAPI) return;
  subscribed = true;
  window.electronAPI.onChatEvent(e => chatHandlers.get(e.requestId)?.(e));
  window.electronAPI.onPullEvent(e => pullHandlers.get(e.requestId)?.(e));
}

const newId = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export interface ChatResult {
  content: string;
  thinking: string;
  /** User cancel or tool-spam cut. Do not apply tool calls when this is true. */
  aborted: boolean;
  stats: ChatEvent['stats'];
  /** `think` the request carried (local), or 'hidden' for a known reasoning frontier model. */
  think?: boolean | string;
  /** Stream stopped because the model repeated the same tool tag. */
  toolSpamAborted?: boolean;
  abortReason?: 'user' | 'tool_spam';
}

export interface ChatHandle {
  requestId: string;
  done: Promise<ChatResult>;
  abort: () => void;
  /**
   * Aborted as soon as the user cancels (or tool-spam cuts the stream).
   * Check `signal.aborted` before applying tool calls — the promise still resolves
   * `{ aborted: true }` so existing callers keep working.
   */
  signal: AbortSignal;
  /** Live mirror of `signal.aborted`. Timeouts reject instead of setting this. */
  readonly aborted: boolean;
}

/** Stream chat completions through the main process (Ollama or OpenAI-compatible Frontier like Grok). */
export function streamChat(
  url: string,
  body: Record<string, unknown>,
  onDelta: (content: string, thinking: string) => void,
  nodeType?: 'ollama' | 'openai',
  apiKey?: string
): ChatHandle {
  ensureSubscribed();
  const requestId = newId('chat');
  const abortController = new AbortController();
  let abortedFlag = false;
  const markAborted = () => {
    abortedFlag = true;
    if (!abortController.signal.aborted) abortController.abort();
  };
  let content = '';
  let thinking = '';
  let frame = 0;
  let spamAborted = false;
  let settled = false;
  const frontier = nodeType === 'openai' || !!apiKey;
  const sentThink = body.think as boolean | string | undefined;
  // Local: the `think` value sent. Frontier: 'hidden' when the model is known to reason.
  const thinkLabel: boolean | string | undefined = frontier ? frontierThinkLabel(String(body.model || '')) : sentThink;

  const fail = (
    reject: (err: StreamChatError) => void,
    message: string | undefined,
    hint?: { retriable?: boolean; code?: string }
  ) => {
    if (settled) return;
    settled = true;
    chatHandlers.delete(requestId);
    const cls = classifyStreamError(message, hint);
    reject(
      new StreamChatError(message || 'Unknown error', {
        retriable: cls.retriable,
        code: cls.code,
        requestId
      })
    );
  };

  const done = new Promise<ChatResult>((resolve, reject) => {
    const settle = (result: ChatResult) => {
      if (settled) return;
      settled = true;
      chatHandlers.delete(requestId);
      resolve(result);
    };
    chatHandlers.set(requestId, e => {
      if (e.type === 'chunk') {
        if (spamAborted || settled) return;
        content += e.content || '';
        thinking += e.thinking || '';
        // Local models sometimes collapse into repeating the same <read_file/> — cut it off.
        if (detectRepeatedToolTagSpam(content)) {
          spamAborted = true;
          if (frame) cancelAnimationFrame(frame);
          frame = 0;
          onDelta(content, thinking);
          markAborted();
          window.electronAPI.abortStream(requestId);
          settle({
            content,
            thinking,
            aborted: true,
            toolSpamAborted: true,
            abortReason: 'tool_spam',
            stats: {}
          });
          return;
        }
        // Coalesce UI updates to one per animation frame - streaming 100+ tok/s would otherwise re-render per token
        if (!frame) {
          frame = requestAnimationFrame(() => {
            frame = 0;
            onDelta(content, thinking);
          });
        }
      } else {
        if (spamAborted || settled) return;
        if (frame) cancelAnimationFrame(frame);
        onDelta(content, thinking);
        if (e.type === 'done') {
          // Inline <think> blocks belong to `thinking`, never to the reply that tools/verdicts parse.
          const split = splitInlineThinking(content);
          const stats = e.stats;
          if (frontier) {
            noteReasoningObservation(String(body.model || ''), {
              reasoningTokens: stats?.reasoningTokens,
              doneReason: stats?.doneReason,
              visibleContent: split.content
            });
          }
          settle({
            content: split.content,
            thinking: split.thinking ? (thinking ? `${thinking}\n${split.thinking}` : split.thinking) : thinking,
            aborted: false,
            stats,
            ...(thinkLabel !== undefined ? { think: thinkLabel } : {})
          });
        }
        else if (e.type === 'aborted') {
          // A timeout that the main process reports as an abort is still a retriable failure.
          const cls = classifyStreamError(e.error, { retriable: e.retriable, code: e.code });
          if (e.error && cls.retriable) {
            fail(reject, e.error, { retriable: true, code: cls.code });
            return;
          }
          markAborted();
          settle({ content, thinking, aborted: true, abortReason: 'user', stats: {} });
        } else {
          fail(reject, e.error, { retriable: e.retriable, code: e.code });
        }
      }
    });
  });

  window.electronAPI.chat(requestId, url, body, nodeType, apiKey).catch(err => {
    chatHandlers.get(requestId)?.({ requestId, type: 'error', error: String(err) });
  });

  return {
    requestId,
    done,
    signal: abortController.signal,
    get aborted() {
      return abortedFlag || abortController.signal.aborted;
    },
    abort: () => {
      markAborted();
      window.electronAPI.abortStream(requestId);
    }
  };
}

export interface PullHandle {
  requestId: string;
  done: Promise<void>;
  abort: () => void;
}

export function pullModel(url: string, model: string, onProgress: (status: string, completed?: number, total?: number) => void): PullHandle {
  ensureSubscribed();
  const requestId = newId('pull');
  const done = new Promise<void>((resolve, reject) => {
    pullHandlers.set(requestId, e => {
      if (e.type === 'progress') onProgress(e.status || '', e.completed, e.total);
      else {
        pullHandlers.delete(requestId);
        if (e.type === 'done') resolve();
        else if (e.type === 'aborted') reject(new Error('Cancelled'));
        else reject(new Error(e.error || 'Pull failed'));
      }
    });
  });
  window.electronAPI.pullModel(requestId, url, model);
  return { requestId, done, abort: () => window.electronAPI.abortStream(requestId) };
}
