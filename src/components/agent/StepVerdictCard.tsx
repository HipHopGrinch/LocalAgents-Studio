import React from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';

export interface StepVerdictCardProps {
  stepId: string;
  stepTitle: string;
  result: 'yay' | 'nay';
  notes: string;
  sent?: boolean;
  disabled?: boolean;
  /** When auto-review is off — user confirms applying the verdict to the plan */
  onApply?: () => void;
  needsConfirm?: boolean;
}

/** Reviewer pass/fail for the active Planner step. `result` stays yay/nay for stored plans. */
export const StepVerdictCard: React.FC<StepVerdictCardProps> = ({
  stepId,
  stepTitle,
  result,
  notes,
  sent,
  disabled,
  onApply,
  needsConfirm
}) => {
  const passed = result === 'yay';
  return (
    <div className="mt-3 space-y-2 pt-2 border-t border-[#31313e]">
      <div
        className={`flex items-center space-x-1.5 text-[11px] uppercase font-bold tracking-wider ${
          passed ? 'text-emerald-300/90' : 'text-rose-300/90'
        }`}
      >
        {passed ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
        <span>
          Step {stepId} · {passed ? 'Pass' : 'Fail'}
        </span>
      </div>
      <p className="text-[11px] text-zinc-300 leading-relaxed">
        <span className="font-medium text-zinc-100">{stepTitle}</span>
        {notes ? ` — ${notes}` : ''}
      </p>
      {needsConfirm && onApply && (
        <>
          <button
            type="button"
            disabled={disabled || sent}
            onClick={onApply}
            className={`w-full flex items-center justify-center gap-2 rounded-md px-3 py-2 text-[12px] font-sans font-medium border transition ${
              sent
                ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-200 cursor-default'
                : passed
                  ? 'bg-emerald-600 hover:bg-emerald-500 border-emerald-500/50 text-white'
                  : 'bg-rose-600 hover:bg-rose-500 border-rose-500/50 text-white'
            }`}
          >
            {sent ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Applied to plan</span>
              </>
            ) : passed ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Accept & continue</span>
              </>
            ) : (
              <>
                <XCircle className="w-3.5 h-3.5" />
                <span>Accept & send fixes</span>
              </>
            )}
          </button>
          {!sent && (
            <p className="text-[11px] text-zinc-400">
              {passed
                ? 'Accepting a pass advances the plan to the next step.'
                : 'Accepting a fail sends the fixes to the coder.'}
            </p>
          )}
        </>
      )}
    </div>
  );
};
