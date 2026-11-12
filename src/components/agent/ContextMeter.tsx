import React from 'react';
import type { ContextTier } from '../../lib/contextSize';

export interface ContextMeterProps {
  used?: number;
  pinned: number;
  tier?: ContextTier;
  budget?: number;
  model?: string;
  node?: string;
}

function tone(ratio: number, hasUsed: boolean): string {
  if (!hasUsed) return 'bg-zinc-500';
  if (ratio >= 0.85) return 'bg-rose-500';
  if (ratio >= 0.7) return 'bg-amber-400';
  return 'bg-emerald-400';
}

/** Compact used / pinned context bar for the composer. */
export const ContextMeter: React.FC<ContextMeterProps> = ({
  used,
  pinned,
  tier,
  budget,
  model,
  node
}) => {
  if (!pinned || pinned <= 0) return null;
  const hasUsed = typeof used === 'number' && used > 0;
  const ratio = hasUsed ? used / pinned : 0;
  const pct = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  const nearCap = hasUsed && ratio >= 0.85;
  const where = [node, model].filter(Boolean).join(' · ');
  const tip = [
    where && `Node: ${where}`,
    tier && `Fit tier: ${tier}`,
    typeof budget === 'number' && budget > 0 ? `Prompt budget: ${budget.toLocaleString()} tokens` : '',
    hasUsed ? `Last prompt: ${used.toLocaleString()} tokens` : 'No prompt sample for this turn yet',
    `Pinned context: ${pinned.toLocaleString()} tokens`
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <div className="mb-2 px-0.5" title={tip}>
      <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-400 mb-1">
        <span className="truncate">{where || 'Context'}</span>
        <span className={`font-mono shrink-0 ${nearCap ? 'text-rose-300' : 'text-zinc-300'}`}>
          {hasUsed ? used.toLocaleString() : '—'} / {pinned.toLocaleString()}
          {nearCap ? ' · near cap' : ''}
        </span>
      </div>
      <div
        className="h-1 rounded bg-[#2a2a36] overflow-hidden"
        role="meter"
        aria-label="Prompt tokens used of the pinned context"
        aria-valuemin={0}
        aria-valuemax={pinned}
        aria-valuenow={hasUsed ? used : 0}
        aria-valuetext={tip.replace(/\n/g, ', ')}
      >
        <div className={`h-full ${tone(ratio, hasUsed)}`} style={{ width: `${hasUsed ? Math.max(pct, 2) : 0}%` }} />
      </div>
    </div>
  );
};
