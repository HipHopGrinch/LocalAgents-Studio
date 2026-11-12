import React from 'react';
import { AlertTriangle } from 'lucide-react';

export interface ErrorCardProps {
  /** Short, human-readable cause. */
  cause: string;
  node?: string;
  model?: string;
  onRetry?: () => void;
  onOpenHardware?: () => void;
  className?: string;
}

/** First line of a raw error, clipped so cards stay readable. */
export function clipErrorCause(raw: string | undefined, fallback: string): string {
  const line = (raw || '')
    .split(/\r?\n/)
    .map(part => part.trim())
    .find(Boolean);
  const clipped = (line || '').replace(/^error:\s*/i, '').slice(0, 180);
  return clipped || fallback;
}

/**
 * Shared failure card for the conductor. AgentChat can pass Retry and
 * Open Hardware once those actions are wired.
 */
export const ErrorCard: React.FC<ErrorCardProps> = ({
  cause,
  node,
  model,
  onRetry,
  onOpenHardware,
  className = ''
}) => {
  const where = [node, model].map(part => (part || '').trim()).filter(Boolean).join(' · ');
  return (
    <div
      role="alert"
      className={`rounded-md border border-rose-500/40 bg-rose-950/40 px-2.5 py-2 space-y-1.5 ${className}`}
    >
      <div className="flex items-start gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5 text-rose-300 shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-[11px] text-rose-100 leading-snug">{cause}</p>
      </div>
      {where ? <p className="text-[11px] text-zinc-400 font-mono truncate">{where}</p> : null}
      {(onRetry || onOpenHardware) && (
        <div className="flex flex-wrap gap-1.5">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="px-2 py-1 rounded text-[11px] font-medium bg-rose-600 hover:bg-rose-500 text-white"
            >
              Retry
            </button>
          )}
          {onOpenHardware && (
            <button
              type="button"
              onClick={onOpenHardware}
              className="px-2 py-1 rounded text-[11px] font-medium border border-[#3a3a48] text-zinc-200 hover:bg-[#252530]"
            >
              Open Hardware
            </button>
          )}
        </div>
      )}
    </div>
  );
};
