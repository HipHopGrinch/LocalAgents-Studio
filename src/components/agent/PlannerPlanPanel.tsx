import React, { useRef, useState } from 'react';
import { ListChecks, Pause, Play } from 'lucide-react';
import { PlannerPlan } from '../../types';

export interface PlannerPlanPanelProps {
  plan: PlannerPlan;
  /** True while a worker turn is streaming. */
  isBusy?: boolean;
  /** True after Stop / app reopen while the plan is still active. */
  isPaused?: boolean;
  onPause?: () => void;
  onResume?: () => void;
  /** Rendered only when provided. AgentChat wires these next wave. */
  onSkipStep?: (stepId: string) => void;
  onEditStepTask?: (stepId: string, taskId: string, text: string) => void;
  onRetryStep?: (stepId: string) => void;
  onUndoStep?: (stepId: string) => void;
}

interface TaskDraft {
  stepId: string;
  taskId: string;
  text: string;
}

function statusClassFor(status: string, active: boolean): string {
  if (status === 'completed') return 'text-emerald-400';
  if (status === 'failed') return 'text-rose-400';
  if (status === 'abandoned' || status === 'skipped') return 'text-zinc-400';
  if (status === 'in_progress' || active) return 'text-amber-300';
  return 'text-zinc-400';
}

/** Durable plan panel — steps + task status (fills tall orchestration column). */
export const PlannerPlanPanel: React.FC<PlannerPlanPanelProps> = ({
  plan,
  isBusy = false,
  isPaused = false,
  onPause,
  onResume,
  onSkipStep,
  onEditStepTask,
  onRetryStep,
  onUndoStep
}) => {
  const [editing, setEditing] = useState<TaskDraft | null>(null);
  const editingRef = useRef<TaskDraft | null>(null);
  editingRef.current = editing;

  const commitEdit = () => {
    const current = editingRef.current;
    if (!current) return;
    editingRef.current = null;
    setEditing(null);
    const next = current.text.trim();
    if (next && onEditStepTask) onEditStepTask(current.stepId, current.taskId, next);
  };

  if (!plan.steps.length) return null;
  return (
    <div className="flex flex-col min-h-0 flex-1 rounded-md border border-[#2a2a36] bg-[var(--surface-1)] px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[11px] uppercase font-bold tracking-wider text-sky-300/90 shrink-0">
        <ListChecks className="w-3 h-3" />
        <span>Planner plan · {plan.status}</span>
        {plan.delivery && (
          <span className="ml-auto text-[11px] normal-case font-semibold px-1.5 py-0.5 rounded bg-sky-600/20 text-sky-200 border border-sky-500/30">
            {plan.delivery}
          </span>
        )}
      </div>
      <p className="text-[11px] text-zinc-300 mt-1 leading-snug shrink-0">{plan.summary}</p>
      {plan.steps.some(s => s.tasks.some(t => t.file)) && (
        <p className="mt-1 text-[11px] text-zinc-400 shrink-0 truncate" title={plan.steps.flatMap(s => s.tasks.map(t => t.file || '')).filter(Boolean).join(', ')}>
          Files: {plan.steps.flatMap(s => s.tasks.map(t => t.file).filter(Boolean)).slice(0, 4).join(' · ')}
        </p>
      )}
      {isPaused && plan.status === 'active' && (
        <div className="mt-1.5 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-100 leading-snug shrink-0">
          {plan.blockedReason ? (
            <>
              <span className="font-semibold text-amber-200">Blocked</span>
              {typeof plan.healAttempts === 'number' ? ` · heal ${plan.healAttempts}` : ''}.{' '}
              {plan.blockedReason.slice(0, 180)}
              {plan.blockedReason.length > 180 ? '…' : ''} Press{' '}
              <span className="font-semibold text-emerald-300">Heal and continue</span> (Play) to
              run compiler-driven heal without adding steps.
            </>
          ) : (
            <>
              Paused{plan.resumePhase ? ` at ${plan.resumePhase}` : ''}. Closing Studio keeps this
              checkpoint — press <span className="font-semibold text-emerald-300">Play</span> to
              resume the active step.
            </>
          )}
        </div>
      )}
      {!isPaused && !isBusy && plan.status === 'active' && !plan.resumePhase && (
        <div className="mt-1.5 rounded border border-[#2a2a36] bg-[#14141a] px-2 py-1.5 text-[11px] text-zinc-400 leading-snug shrink-0">
          Idle. Ready for the next step.
        </div>
      )}
      <ol className="mt-2 space-y-1.5 list-none overflow-y-auto min-h-0 flex-1 pr-0.5">
        {plan.steps.map(step => {
          const active = plan.activeStepId === step.id;
          const status = String(step.status);
          const statusClass = statusClassFor(status, active);
          const reviewClass = status === 'failed' ? 'text-rose-300/90' : 'text-sky-300/90';
          const showRunControls = active && plan.status === 'active' && (onPause || onResume);
          const showSkip = !!onSkipStep && (status === 'pending' || status === 'in_progress');
          const showRetry =
            !!onRetryStep &&
            (status === 'failed' || status === 'skipped' || status === 'abandoned' || status === 'in_progress');
          const showUndo =
            !!onUndoStep &&
            (status === 'completed' ||
              status === 'failed' ||
              status === 'skipped' ||
              status === 'abandoned' ||
              status === 'in_progress');
          const statusLabel = isPaused && active ? 'paused' : status.replace(/_/g, ' ');
          return (
            <li
              key={step.id}
              className={`rounded border px-2 py-1.5 ${
                active
                  ? 'border-amber-500/40 bg-amber-500/5'
                  : 'border-[#2a2a36] bg-[#0e0e12]'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                    <span className={`font-mono text-[11px] uppercase ${statusClass}`}>
                      {statusLabel}
                    </span>
                    <span className="font-semibold text-zinc-100">
                      Step {step.id}: {step.title}
                    </span>
                  </div>
                </div>
                {showRunControls && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={onPause}
                      disabled={!isBusy}
                      title="Pause this step (same as the red Stop by Send)"
                      aria-label="Pause"
                      className={`p-1 rounded border transition ${
                        isBusy
                          ? 'border-rose-500/50 bg-rose-600/25 text-rose-200 hover:bg-rose-600/40'
                          : 'border-[#2a2a36] text-zinc-500 cursor-default opacity-50'
                      }`}
                    >
                      <Pause className="w-3 h-3" fill="currentColor" />
                    </button>
                    <button
                      type="button"
                      onClick={onResume}
                      disabled={isBusy}
                      title={
                        plan.blockedReason
                          ? 'Heal and continue — run stack verify and one compiler-driven Coder pass'
                          : 'Resume this step — Auto-apply / Auto-review / Swarm stay as checked'
                      }
                      aria-label={plan.blockedReason ? 'Heal and continue' : 'Resume'}
                      className={`p-1 rounded border transition ${
                        isBusy
                          ? 'border-[#2a2a36] text-zinc-500 cursor-default opacity-50'
                          : 'border-emerald-500/50 bg-emerald-600/25 text-emerald-200 hover:bg-emerald-600/40'
                      }`}
                    >
                      <Play className="w-3 h-3" fill="currentColor" />
                    </button>
                  </div>
                )}
              </div>
              {(showSkip || showRetry || showUndo) && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {showSkip && onSkipStep && (
                    <button
                      type="button"
                      onClick={() => onSkipStep(step.id)}
                      disabled={isBusy && status === 'in_progress'}
                      title={isBusy && status === 'in_progress' ? 'Pause this step before skipping it' : undefined}
                      className="px-1.5 py-0.5 rounded border border-[#3a3a48] text-[11px] text-zinc-200 hover:bg-[#252530] disabled:opacity-50 disabled:cursor-default disabled:hover:bg-transparent"
                    >
                      Skip
                    </button>
                  )}
                  {showRetry && onRetryStep && (
                    <button
                      type="button"
                      onClick={() => onRetryStep(step.id)}
                      className="px-1.5 py-0.5 rounded border border-amber-500/40 text-[11px] text-amber-100 hover:bg-amber-500/10"
                    >
                      Retry
                    </button>
                  )}
                  {showUndo && onUndoStep && (
                    <button
                      type="button"
                      onClick={() => onUndoStep(step.id)}
                      className="px-1.5 py-0.5 rounded border border-rose-500/40 text-[11px] text-rose-100 hover:bg-rose-500/10"
                    >
                      Undo
                    </button>
                  )}
                </div>
              )}
              <ul className="mt-1 space-y-0.5">
                {step.tasks.map(t => {
                  const mark =
                    t.status === 'completed'
                      ? '✓'
                      : t.status === 'failed'
                        ? '!'
                        : t.status === 'in_progress'
                          ? '›'
                          : '·';
                  const isEditing = editing?.stepId === step.id && editing.taskId === t.id;
                  return (
                    <li key={t.id} className="text-[11px] text-zinc-300 font-mono">
                      {isEditing ? (
                        <input
                          autoFocus
                          value={editing.text}
                          aria-label={`Edit task ${t.id}`}
                          onChange={e => {
                            const next = { stepId: step.id, taskId: t.id, text: e.target.value };
                            editingRef.current = next;
                            setEditing(next);
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitEdit();
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              editingRef.current = null;
                              setEditing(null);
                            }
                          }}
                          onBlur={commitEdit}
                          className="w-full bg-[#18181d] border border-[#2c2c38] rounded px-1 py-0.5 text-[11px] text-zinc-200 font-mono"
                        />
                      ) : (
                        <div className="flex items-center gap-1 min-w-0">
                          <span className="truncate">
                            {mark} #{t.id} {t.title}
                            {t.file ? ` — ${t.file}` : ''}
                          </span>
                          {onEditStepTask && (
                            <button
                              type="button"
                              onClick={() => {
                                const next = { stepId: step.id, taskId: t.id, text: t.title };
                                editingRef.current = next;
                                setEditing(next);
                              }}
                              className="shrink-0 text-sky-300 hover:text-sky-200"
                              aria-label={`Edit task ${t.id}`}
                            >
                              Edit
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {step.reviewNote && (
                <p className={`text-[11px] ${reviewClass} mt-1 leading-snug`}>
                  Review: {step.reviewNote}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
};
