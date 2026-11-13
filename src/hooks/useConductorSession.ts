import { useRef } from 'react';
import { createEditRepeatGuard, type EditRepeatGuard } from '../lib/agentLoop';
import {
  createConductorSession,
  decideConductorEnter,
  type ConductorSession,
  type RunToken
} from '../lib/conductor';
import { isRetriableStreamError, type ChatHandle, type ChatResult } from '../lib/ollamaClient';

/** Identity of one Send / Play / Heal run. Nested work must keep this object, not re-read a ref after await. */
export interface ConductorRun {
  token: RunToken;
  /** Conversation that owned the run when it started. Plan writes use this id. */
  conversationId: string | null;
}

export interface ConductorRunHandle {
  run: ConductorRun;
  /** True when this call acquired the lock and must unlock in a finally. */
  owned: boolean;
}

/**
 * One ConductorSession per AgentChat, plus the abort list and per-run edit guard.
 * Send / Play / Heal call `enter`. Nested work passes the parent run so it does not
 * take the lock again. Stop and conversation switches call `stop`.
 */
export function useConductorSession() {
  const sessionRef = useRef<ConductorSession | null>(null);
  if (!sessionRef.current) sessionRef.current = createConductorSession();
  const session = sessionRef.current;

  const stopRequestedRef = useRef(false);
  const activeAbortsRef = useRef<Array<() => void>>([]);
  const runRef = useRef<ConductorRun | null>(null);
  const heldRef = useRef(false);
  const editProgressRef = useRef<EditRepeatGuard>(createEditRepeatGuard());

  const isCurrent = (token: RunToken) => session.isCurrent(token);

  const live = (run: ConductorRun | null | undefined) =>
    !!run && session.isCurrent(run.token) && !stopRequestedRef.current;

  /** Append a cancel handle. Never replaces handles already registered for this run. */
  const registerAbort = (abort: () => void) => {
    session.registerAbort(abort);
    activeAbortsRef.current.push(abort);
  };

  /**
   * Start a run, or join `parent` when that token is still current.
   * `clearStop` is only applied when this call acquires the lock (Send / Play).
   * A latched Stop refuses both join and begin until that user action.
   */
  const enter = (
    conversationId: string | null,
    opts?: { clearStop?: boolean; parent?: ConductorRun | null }
  ): ConductorRunHandle | null => {
    const parent = opts?.parent ?? null;
    const current = runRef.current;
    const decision = decideConductorEnter({
      stopLatched: stopRequestedRef.current,
      clearStop: !!opts?.clearStop,
      parentToken: parent ? parent.token : null,
      parentCurrent: !!(parent && session.isCurrent(parent.token)),
      heldToken: heldRef.current && current ? current.token : null,
      heldCurrent: !!(current && session.isCurrent(current.token)),
      locked: session.holdsLock()
    });
    if (decision.action === 'refuse') return null;
    if (decision.action === 'join') {
      const run =
        parent && parent.token === decision.token
          ? parent
          : current && current.token === decision.token
            ? current
            : null;
      if (!run) return null;
      return { run, owned: false };
    }
    if (!session.tryLock()) return null;
    if (opts?.clearStop) stopRequestedRef.current = false;
    const token = session.begin();
    const run: ConductorRun = { token, conversationId };
    runRef.current = run;
    heldRef.current = true;
    editProgressRef.current = createEditRepeatGuard();
    activeAbortsRef.current = [];
    return { run, owned: true };
  };

  /** Unlock only when this owner token is still the current generation. */
  const leave = (owned: boolean, token: RunToken) => {
    if (!owned) return;
    if (!session.releaseIfCurrent(token)) return;
    heldRef.current = false;
    if (!runRef.current || runRef.current.token === token) runRef.current = null;
  };

  /** Invalidate the run, abort every registered stream, and release the lock. */
  const stop = () => {
    stopRequestedRef.current = true;
    heldRef.current = false;
    runRef.current = null;
    activeAbortsRef.current = [];
    session.stop();
  };

  return {
    session,
    stopRequestedRef,
    activeAbortsRef,
    runRef,
    heldRef,
    editProgressRef,
    isCurrent,
    live,
    registerAbort,
    enter,
    leave,
    stop
  };
}

/**
 * Await one chat stream. Registers the abort handle (append).
 * Retriable stream failures retry once on the same request.
 * Aborted, cancelled, or stale runs return `{ aborted: true }` and must not apply tools.
 */
export async function awaitConductorChat(
  open: () => ChatHandle,
  opts: {
    registerAbort: (abort: () => void) => void;
    live: () => boolean;
    /** Same-node stream retry is about to run. Must not throw. */
    onStreamRetry?: (error: unknown) => void;
  }
): Promise<{ aborted: true } | { aborted: false; result: ChatResult; handle: ChatHandle }> {
  const once = async (
    allowRetry: boolean
  ): Promise<{ aborted: true } | { aborted: false; result: ChatResult; handle: ChatHandle }> => {
    const handle = open();
    opts.registerAbort(handle.abort);
    try {
      const result = await handle.done;
      if (result.aborted || handle.signal.aborted || handle.aborted || !opts.live()) {
        return { aborted: true };
      }
      return { aborted: false, result, handle };
    } catch (err) {
      if (allowRetry && isRetriableStreamError(err) && opts.live()) {
        try {
          opts.onStreamRetry?.(err);
        } catch {
          /* retry logging must not replace the retry */
        }
        return once(false);
      }
      throw err;
    }
  };
  return once(true);
}
