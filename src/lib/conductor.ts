import type { PlannerPlan, PlanBlockerKind } from '../types';
import {
  applyStepVerdict,
  canHealAdvanceOnGreenVerify,
  continuePastFailedStep,
  editStepTask,
  markPlanFinalReview,
  planReadyForRelease,
  retryFailedStep,
  setStepBlockerKind,
  skipStep
} from './plannerPlan';
import { resetEditRepeatGuard } from './agentLoop';

/**
 * Pure phase transitions for the Conductor. AgentChat should call this instead of
 * inlining Yay/heal/stop branches. `paused` is not stored on the plan.
 */
export type ConductorEvent =
  | { type: 'CODER_DONE'; stepId?: string }
  | { type: 'VERDICT'; stepId?: string; result: 'yay' | 'nay' | 'missing'; notes?: string }
  | {
      type: 'VERIFY';
      ok: boolean;
      fingerprint?: string;
      blockerKind?: PlanBlockerKind;
      stepId?: string;
      note?: string;
    }
  | { type: 'HEAL_EXHAUSTED'; stepId?: string; note?: string }
  | { type: 'STOP' }
  | { type: 'RESUME' }
  | { type: 'SKIP_STEP'; stepId: string; note?: string }
  | { type: 'RETRY_STEP'; stepId: string }
  | {
      type: 'EDIT_STEP_TASK';
      stepId: string;
      taskId: string;
      title?: string;
      description?: string;
      file?: string;
    };

export type ConductorEffect =
  | 'coder-to-review'
  | 'verdict-yay'
  | 'verdict-nay'
  | 'verdict-missing'
  | 'verify-advanced'
  | 'verify-held'
  | 'verify-failed'
  | 'heal-deferred'
  | 'stopped'
  | 'resumed'
  | 'skipped'
  | 'retried'
  | 'edited'
  | 'noop';

export interface ConductorTransition {
  plan: PlannerPlan;
  paused: boolean;
  effect: ConductorEffect;
}

export type RunToken = number;

export interface ConductorEnterInput {
  /** Stop was pressed and no later Send/Play has cleared it. */
  stopLatched: boolean;
  /** User Send / Play. The only callers allowed to start work while stop is latched. */
  clearStop: boolean;
  parentToken: RunToken | null;
  parentCurrent: boolean;
  /** Token of the run currently holding the UI lock, if any. */
  heldToken: RunToken | null;
  heldCurrent: boolean;
  locked: boolean;
}

export type ConductorEnterDecision =
  | { action: 'join'; token: RunToken }
  | { action: 'begin' }
  | { action: 'refuse' };

/**
 * Whether `enter` / `bindRun` may join or start a run.
 * A latched Stop refuses both join and begin unless this is a user Send/Play (`clearStop`).
 * A parent token joins only while it is still the current generation.
 * `bindRun(null)` joins the held run only when that same token is still current and Stop is clear.
 */
export function decideConductorEnter(input: ConductorEnterInput): ConductorEnterDecision {
  if (input.stopLatched && !input.clearStop) return { action: 'refuse' };
  if (input.parentToken != null) {
    if (input.parentCurrent) return { action: 'join', token: input.parentToken };
    return { action: 'refuse' };
  }
  if (!input.clearStop && input.heldToken != null && input.heldCurrent && !input.stopLatched) {
    return { action: 'join', token: input.heldToken };
  }
  if (input.locked) return { action: 'refuse' };
  return { action: 'begin' };
}

/** An owner may release the lock only while its token is still the current generation. */
export function shouldReleaseRunLock(tokenIsCurrent: boolean): boolean {
  return tokenIsCurrent;
}

function stamp(plan: PlannerPlan, patch: Partial<PlannerPlan> = {}): PlannerPlan {
  return { ...plan, ...patch, updatedAt: Date.now() };
}

/**
 * A Reviewer Nay leaves the active step `failed`. A rework must run that same step again,
 * not let `activateNextStep` skip it. A step whose heal budget is spent (`healExhausted`),
 * an abandoned step, or a plan with no failed active step comes back unchanged.
 * `healAttempts` survives so a rework cannot reset the per-plan heal budget.
 */
export function reopenActiveStepForRework(plan: PlannerPlan): PlannerPlan {
  const active = plan.activeStepId
    ? plan.steps.find(s => String(s.id) === String(plan.activeStepId))
    : undefined;
  if (!active || active.status !== 'failed' || active.healExhausted) return plan;
  const reopened = retryFailedStep(plan, active.id);
  if (reopened === plan) return plan;
  return { ...reopened, healAttempts: plan.healAttempts || 0, blockedReason: plan.blockedReason };
}

/** Coder rounds one review-fix task may take before the loop stops. */
export const MAX_REVIEW_FIX_ROUNDS = 3;

export function reviewFixKey(taskId: string, title: string): string {
  return `${taskId}:${(title || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 80)}`;
}

/**
 * Count one Coder round for a review-fix task. Past the cap the counter does not move,
 * so a repeated entry stays capped instead of drifting upward.
 */
export function takeReviewFixRound(
  rounds: Record<string, number>,
  key: string,
  max = MAX_REVIEW_FIX_ROUNDS
): { rounds: Record<string, number>; round: number; capped: boolean } {
  const round = (rounds[key] || 0) + 1;
  if (round > max) return { rounds, round, capped: true };
  return { rounds: { ...rounds, [key]: round }, round, capped: false };
}

/**
 * Review-fix task ids in the same turn that are still open. Open review-fix work wins over
 * dispatching the mirrored `review-fixes` plan as an ordinary plan step.
 */
export function reviewFixesOwnTheTurn(opts: {
  openTasks: boolean;
  activeStepId?: string | null;
  planId?: string | null;
}): boolean {
  if (!opts.openTasks) return false;
  return opts.activeStepId === 'review-fixes' || !!opts.planId?.startsWith('plan-review-');
}

/** Targeted Coder heals one step gets for a logic Nay that survives its reworks while verify passes. */
export const MAX_LOGIC_HEAL_ROUNDS = 2;

/** One-line chat notice when Full auto/heal moves past a step that never passed review. */
export function leftFailedNotice(
  stepId: string | number,
  nextId: string | number,
  nextTitle: string,
  opts?: { logicIssue?: boolean }
): string {
  const why = opts?.logicIssue
    ? 'verify passes but the Reviewer still found a logic issue; rework and logic heal budget spent'
    : 'rework and heal budget spent';
  return `Step #${stepId} was left FAILED (${why}) — continuing with step #${nextId}: ${nextTitle}`;
}

function stepIdOf(plan: PlannerPlan, explicit?: string): string {
  return String(explicit || plan.activeStepId || '');
}

function afterYay(plan: PlannerPlan): PlannerPlan {
  if (planReadyForRelease(plan)) return markPlanFinalReview(plan);
  return stamp(plan, { resumePhase: 'coder', healAttempts: 0, blockedReason: undefined });
}

/** Apply one conductor event. Does not touch the network, the filesystem, or React state. */
export function transition(plan: PlannerPlan, event: ConductorEvent): ConductorTransition {
  switch (event.type) {
    case 'STOP':
      return { plan, paused: true, effect: 'stopped' };
    case 'RESUME':
      return { plan, paused: false, effect: 'resumed' };
    case 'CODER_DONE': {
      const stepId = stepIdOf(plan, event.stepId);
      return {
        plan: stamp(plan, {
          resumePhase: 'review',
          ...(stepId ? { activeStepId: stepId } : {})
        }),
        paused: false,
        effect: 'coder-to-review'
      };
    }
    case 'VERDICT': {
      const stepId = stepIdOf(plan, event.stepId);
      if (event.result === 'missing') {
        return {
          plan: stamp(plan, {
            resumePhase: 'verdict',
            ...(stepId ? { activeStepId: stepId } : {})
          }),
          paused: false,
          effect: 'verdict-missing'
        };
      }
      const next = applyStepVerdict(plan, {
        stepId,
        result: event.result,
        notes: event.notes || ''
      });
      if (next === plan) return { plan, paused: false, effect: 'noop' };
      if (event.result === 'nay') {
        return { plan: stamp(next, { resumePhase: 'coder' }), paused: false, effect: 'verdict-nay' };
      }
      return { plan: afterYay(next), paused: false, effect: 'verdict-yay' };
    }
    case 'VERIFY': {
      const stepId = stepIdOf(plan, event.stepId);
      let next = plan;
      const current = next.steps.find(s => String(s.id) === stepId);
      const keepReview = current?.blockerKind === 'review';
      if (stepId && event.blockerKind && !(keepReview && event.blockerKind === 'compiler')) {
        next = setStepBlockerKind(next, stepId, event.blockerKind);
      } else if (stepId && !event.ok && !keepReview) {
        next = setStepBlockerKind(next, stepId, 'compiler');
      }
      next = stamp(next, {
        lastVerifyOk: event.ok,
        ...(event.fingerprint ? { lastErrorFingerprint: event.fingerprint } : {})
      });
      if (!event.ok) return { plan: next, paused: false, effect: 'verify-failed' };
      if (!stepId || !canHealAdvanceOnGreenVerify(next, stepId)) {
        return { plan: stamp(next, { resumePhase: 'review' }), paused: false, effect: 'verify-held' };
      }
      next = applyStepVerdict(next, {
        stepId,
        result: 'yay',
        notes: event.note || 'Compiler verify passed.'
      });
      next = stamp(next, {
        healAttempts: 0,
        blockedReason: undefined,
        lastVerifyOk: true,
        ...(event.fingerprint ? { lastErrorFingerprint: event.fingerprint } : {})
      });
      return { plan: afterYay(next), paused: false, effect: 'verify-advanced' };
    }
    case 'HEAL_EXHAUSTED': {
      const stepId = stepIdOf(plan, event.stepId);
      if (!stepId) return { plan, paused: false, effect: 'noop' };
      const next = continuePastFailedStep(
        plan,
        stepId,
        event.note || `Heal budget used on step #${stepId}.`
      );
      return { plan: next, paused: false, effect: 'heal-deferred' };
    }
    case 'SKIP_STEP': {
      const next = skipStep(plan, event.stepId, event.note);
      if (next === plan) return { plan, paused: false, effect: 'noop' };
      return { plan: next, paused: false, effect: 'skipped' };
    }
    case 'RETRY_STEP': {
      const next = retryFailedStep(plan, event.stepId);
      if (next === plan) return { plan, paused: false, effect: 'noop' };
      return { plan: next, paused: false, effect: 'retried' };
    }
    case 'EDIT_STEP_TASK': {
      const next = editStepTask(plan, event.stepId, event.taskId, {
        ...(event.title !== undefined ? { title: event.title } : {}),
        ...(event.description !== undefined ? { description: event.description } : {}),
        ...(event.file !== undefined ? { file: event.file } : {})
      });
      if (next === plan) return { plan, paused: false, effect: 'noop' };
      return { plan: next, paused: false, effect: 'edited' };
    }
    default:
      return { plan, paused: false, effect: 'noop' };
  }
}

/**
 * Run identity, lock, and abort list for one Conductor session.
 * AgentChat should use this for FLOW-1/2/3/13: begin() at Send/Play, isCurrent()
 * before every commit, tryLock() at entry, registerAbort() for each stream (append),
 * stop() on Stop and on chat switch.
 */
export class ConductorSession {
  private generation = 0;
  private locked = false;
  private controller = new AbortController();
  private aborts: Array<() => void> = [];

  /** Start a run. Invalidates the previous token and aborts its signal and handles. */
  begin(): RunToken {
    this.endRun();
    this.generation += 1;
    resetEditRepeatGuard();
    return this.generation;
  }

  isCurrent(token: RunToken): boolean {
    return token !== 0 && token === this.generation;
  }

  /** Synchronous guard. False when a run already holds the lock. */
  tryLock(): boolean {
    if (this.locked) return false;
    this.locked = true;
    return true;
  }

  unlock(): void {
    this.locked = false;
  }

  holdsLock(): boolean {
    return this.locked;
  }

  /**
   * Release the lock only when `token` is still the current generation.
   * A stopped run's finally must not unlock the run that Send/Play started next.
   */
  releaseIfCurrent(token: RunToken): boolean {
    if (!shouldReleaseRunLock(this.isCurrent(token))) return false;
    this.locked = false;
    return true;
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** Append a cancel handle. Never replaces earlier handles. */
  registerAbort(fn: () => void): void {
    this.aborts.push(fn);
  }

  /**
   * Bump the generation, abort the current signal, and call every registered abort.
   * Releases the run lock so the next Send can tryLock().
   */
  stop(): void {
    this.generation += 1;
    this.locked = false;
    this.endRun();
  }

  apply(plan: PlannerPlan, event: ConductorEvent): ConductorTransition {
    return transition(plan, event);
  }

  private endRun(): void {
    const fns = this.aborts.splice(0, this.aborts.length);
    const previous = this.controller;
    this.controller = new AbortController();
    if (!previous.signal.aborted) previous.abort();
    for (const fn of fns) {
      try {
        fn();
      } catch {
        // One listener must not prevent the rest from running.
      }
    }
  }
}

export function createConductorSession(): ConductorSession {
  return new ConductorSession();
}
