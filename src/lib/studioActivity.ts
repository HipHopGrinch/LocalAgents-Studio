/**
 * Nested activity labels so Generating chrome stays visible during
 * non-streaming work (install, tsc, Pass handoffs, escalate).
 */

export type StudioActivityPhase =
  | 'planner'
  | 'coder'
  | 'review'
  | 'swarm'
  | 'pass1'
  | 'pass2'
  | 'tool'
  | 'install'
  | 'verify'
  | 'escalate'
  | 'heal'
  | 'resume'
  | 'project-review'
  | 'other';

/** Identity of one pushed frame. A late end of a finished run must only remove its own frame. */
export type ActivityHandle = number;

let nextActivityId = 1;

export interface StudioActivity {
  /** Unique per pushed frame; see ActivityHandle. */
  id: ActivityHandle;
  phase: StudioActivityPhase;
  label: string;
  detail?: string;
  startedAt: number;
}

export function activityLabelOf(stack: StudioActivity[]): string | null {
  if (!stack.length) return null;
  const top = stack[stack.length - 1];
  return top.detail ? `${top.label} — ${top.detail}` : top.label;
}

export function pushActivity(
  stack: StudioActivity[],
  phase: StudioActivityPhase,
  label: string,
  detail?: string
): StudioActivity[] {
  return [...stack, { id: nextActivityId++, phase, label, detail, startedAt: Date.now() }];
}

export function popActivity(stack: StudioActivity[]): StudioActivity[] {
  if (!stack.length) return stack;
  return stack.slice(0, -1);
}

/** Handle of the frame on top of the stack (the one a pushActivity just added). */
export function topActivityHandle(stack: StudioActivity[]): ActivityHandle | undefined {
  return stack.length ? stack[stack.length - 1].id : undefined;
}

/**
 * Remove exactly one frame by handle. Returns the same array when the frame is
 * already gone (a stop or chat switch cleared the stack), so callers can no-op.
 */
export function removeActivity(stack: StudioActivity[], handle: ActivityHandle): StudioActivity[] {
  const index = stack.findIndex(item => item.id === handle);
  if (index < 0) return stack;
  return [...stack.slice(0, index), ...stack.slice(index + 1)];
}

export function replaceTopActivity(
  stack: StudioActivity[],
  phase: StudioActivityPhase,
  label: string,
  detail?: string
): StudioActivity[] {
  if (!stack.length) return pushActivity(stack, phase, label, detail);
  const next = stack.slice(0, -1);
  return pushActivity(next, phase, label, detail);
}
