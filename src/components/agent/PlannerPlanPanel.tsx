import React from 'react';
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
}

/** Durable plan panel — steps + task status (fills tall orchestration column). */
export const PlannerPlanPanel: React.FC<PlannerPlanPanelProps> = ({
  plan,
  isBusy = false,
  isPaused = false,
  onPause,
  onResume
}) => {
  if (!plan.steps.length) return null;
  return (
    <div className="flex flex-col min-h-0 flex-1 rounded-md border border-[#2a2a36] bg-[#121215] px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-wider text-sky-300/90 shrink-0">
        <ListChecks className="w-3 h-3" />
        <span>Planner plan · {plan.status}</span>
        {plan.delivery && (
          <span className="ml-auto text-[9px] normal-case font-semibold px-1.5 py-0.5 rounded bg-sky-600/20 text-sky-200 border border-sky-500/30">
            {plan.delivery}
          </span>
        )}
      </div>
      <p className="text-[11px] text-zinc-300 mt-1 leading-snug shrink-0">{plan.summary}</p>
      {plan.steps.some(s => s.tasks.some(t => t.file)) && (
        <p className="mt-1 text-[9px] text-zinc-500 shrink-0 truncate" title={plan.steps.flatMap(s => s.tasks.map(t => t.file || '')).filter(Boolean).join(', ')}>
          Files: {plan.steps.flatMap(s => s.tasks.map(t => t.file).filter(Boolean)).slice(0, 4).join(' · ')}
        </p>
      )}
      {isPaused && plan.status === 'active' && (
        <div className="mt-1.5 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-100 leading-snug shrink-0">
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
      <ol className="mt-2 space-y-1.5 list-none overflow-y-auto min-h-0 flex-1 pr-0.5">
        {plan.steps.map(step => {
          const active = plan.activeStepId === step.id;
          const statusClass =
            step.status === 'completed'
              ? 'text-emerald-400'
              : step.status === 'failed'
                ? 'text-rose-400'
                : step.status === 'in_progress' || active
                  ? 'text-amber-300'
                  : 'text-zinc-500';
          const reviewClass =
            step.status === 'failed' ? 'text-rose-300/90' : 'text-sky-300/90';
          const showControls = active && plan.status === 'active' && (onPause || onResume);
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
                    <span className={`font-mono text-[9px] uppercase ${statusClass}`}>
                      {isPaused && active ? 'paused' : step.status.replace('_', ' ')}
                    </span>
                    <span className="font-semibold text-zinc-100">
                      Step {step.id}: {step.title}
                    </span>
                  </div>
                </div>
                {showControls && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={onPause}
                      disabled={!isBusy}
                      title="Pause this step (same as the red Stop by Send)"
                      className={`p-1 rounded border transition ${
                        isBusy
                          ? 'border-rose-500/50 bg-rose-600/25 text-rose-200 hover:bg-rose-600/40'
                          : 'border-[#2a2a36] text-zinc-600 cursor-default opacity-50'
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
                          ? 'border-[#2a2a36] text-zinc-600 cursor-default opacity-50'
                          : 'border-emerald-500/50 bg-emerald-600/25 text-emerald-200 hover:bg-emerald-600/40'
                      }`}
                    >
                      <Play className="w-3 h-3" fill="currentColor" />
                    </button>
                  </div>
                )}
              </div>
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
                  return (
                    <li key={t.id} className="text-[10px] text-zinc-400 font-mono truncate">
                      {mark} #{t.id} {t.title}
                      {t.file ? ` — ${t.file}` : ''}
                    </li>
                  );
                })}
              </ul>
              {step.reviewNote && (
                <p className={`text-[10px] ${reviewClass} mt-1 leading-snug`}>
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
