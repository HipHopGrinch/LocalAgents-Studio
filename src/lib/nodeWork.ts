import type { ChatConversation, ChatMessage, PipelineStep } from '../types';
import { getActiveTask, markStopped } from './executionQueue';

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

const unfinished = (s: PipelineStep) => s.status === 'running' || s.status === 'pending';

/**
 * Fail every card that is still pending or running, for when no more work will report back.
 * Returns `steps` unchanged when nothing was unfinished.
 */
export function failUnfinishedNodeWork(steps: PipelineStep[], content: string): PipelineStep[] {
  if (!steps.some(unfinished)) return steps;
  return steps.map(s => (unfinished(s) ? { ...s, status: 'failed' as const, content } : s));
}

const hasStaleWork = (m: ChatMessage) =>
  !!m.pipelineSteps?.some(unfinished) || !!m.reviewPlan?.tasks.some(t => t.status === 'in_progress');

/**
 * Messages saved while a run was live, for a conversation being opened when no run can be:
 * unfinished Swarm steps fail as Stopped, in-progress review tasks go back to pending.
 * Returns `messages` unchanged when nothing was stale.
 */
export function stopUnfinishedWork(messages: ChatMessage[]): ChatMessage[] {
  if (!messages.some(hasStaleWork)) return messages;
  return messages.map(m => {
    if (!hasStaleWork(m)) return m;
    return {
      ...m,
      ...(m.pipelineSteps ? { pipelineSteps: failUnfinishedNodeWork(m.pipelineSteps, 'Stopped') } : {}),
      ...(m.reviewPlan
        ? {
            reviewPlan: {
              ...m.reviewPlan,
              tasks: m.reviewPlan.tasks.map(t =>
                t.status === 'in_progress' ? { ...t, status: 'pending' as const } : t
              )
            }
          }
        : {})
    };
  });
}

/** A conversation loaded from disk: its messages and its review queue, as `stopUnfinishedWork`. */
export function stopUnfinishedConversation(conversation: ChatConversation): ChatConversation {
  const messages = stopUnfinishedWork(conversation.messages || []);
  const queue = conversation.executionQueue ?? null;
  const active = getActiveTask(queue);
  const executionQueue = queue && active ? markStopped(queue, active.id) : queue;
  if (messages === conversation.messages && executionQueue === queue) return conversation;
  return { ...conversation, messages, executionQueue };
}
