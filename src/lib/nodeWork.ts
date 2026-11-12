import type { PipelineStep } from '../types';

/** Cards are matched by computer plus target (file, or the role label when there is no file). */
export function nodeWorkKey(step: Pick<PipelineStep, 'nodeId' | 'targetFile' | 'role'>): string {
  return `${step.nodeId}::${step.targetFile || step.role || ''}`;
}

export function findNodeWorkIndex(
  steps: PipelineStep[],
  key: Pick<PipelineStep, 'nodeId' | 'targetFile' | 'role'>
): number {
  const want = nodeWorkKey(key);
  return steps.findIndex(s => nodeWorkKey(s) === want);
}

/**
 * Merge `step` into the card at `indexHint`, or the card with the same key, or append.
 * Pass the start card's index when the finished step has a different target
 * (a turn that starts as "workspace" and ends as "src/App.tsx").
 */
export function upsertNodeWork(
  prev: PipelineStep[],
  step: PipelineStep,
  indexHint?: number
): PipelineStep[] {
  const idx =
    typeof indexHint === 'number' && indexHint >= 0 && indexHint < prev.length
      ? indexHint
      : findNodeWorkIndex(prev, step);
  if (idx < 0) return [...prev, step];
  const next = [...prev];
  next[idx] = { ...next[idx], ...step };
  return next;
}

/** Mark every card still running as `status`. Returns `steps` unchanged when nothing was running. */
export function settleRunningNodeWork(
  steps: PipelineStep[],
  status: 'completed' | 'failed',
  content: string
): PipelineStep[] {
  if (!steps.some(s => s.status === 'running')) return steps;
  return steps.map(s => (s.status === 'running' ? { ...s, status, content } : s));
}
