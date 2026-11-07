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
  | 'resume'
  | 'project-review'
  | 'other';

export interface StudioActivity {
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
  return [...stack, { phase, label, detail, startedAt: Date.now() }];
}

export function popActivity(stack: StudioActivity[]): StudioActivity[] {
  if (!stack.length) return stack;
  return stack.slice(0, -1);
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
