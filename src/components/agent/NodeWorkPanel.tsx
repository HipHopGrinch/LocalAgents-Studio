import React from 'react';
import { Share2 } from 'lucide-react';
import { PipelineStep } from '../../types';
import { stripStepVerdictMarkup } from '../../lib/planOptions';

export interface NodeWorkPanelProps {
  steps: PipelineStep[];
}

function cleanStepBody(text: string): string {
  return stripStepVerdictMarkup(text || '')
    .replace(/<\/?(?:summary|notes|result|verdict|step_id)\b[^>]*>/gi, '')
    .trim();
}

/** Pinned node→file worker cards (third column). Golden glow while running. */
export const NodeWorkPanel: React.FC<NodeWorkPanelProps> = ({ steps }) => {
  if (!steps.length) {
    return (
      <div className="flex flex-col h-full min-h-0 bg-[#121215] border-l border-[#27272a]">
        <div className="p-2.5 border-b border-[#27272a] shrink-0">
          <div className="flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-wider text-amber-300/90">
            <Share2 className="w-3.5 h-3.5" />
            <span>Node work</span>
          </div>
        </div>
        <div className="flex-1 min-h-0 p-2.5">
          <div className="rounded-md border border-dashed border-[#2a2a36] bg-[#0e0e12] px-2.5 py-3 text-[10px] text-zinc-500 leading-relaxed">
            Worker nodes appear here while Coder / Swarm / Reviewer runs.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#121215] border-l border-[#27272a]">
      <div className="p-2.5 border-b border-[#27272a] shrink-0">
        <div className="flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-wider text-amber-300/90">
          <Share2 className="w-3.5 h-3.5" />
          <span>Node work</span>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-2">
        {steps.map((step, sIdx) => {
          const running = step.status === 'running';
          return (
            <div
              key={`${step.nodeId}-${step.targetFile || sIdx}`}
              className={`rounded-lg p-2.5 text-[11px] bg-[#121215] border transition-shadow ${
                running
                  ? 'border-amber-400/70 shadow-[0_0_0_1px_rgba(251,191,36,0.35),0_0_14px_rgba(251,191,36,0.35)] animate-pulse'
                  : 'border-[#282834]'
              }`}
            >
              <div className="flex items-center justify-between font-mono text-[10px] mb-1 gap-2">
                <span className="text-indigo-300 font-bold truncate">
                  {step.nodeName}
                  {step.targetFile ? ` → ${step.targetFile}` : ''}
                </span>
                <span
                  className={`shrink-0 ${
                    step.status === 'completed'
                      ? 'text-emerald-400'
                      : step.status === 'failed'
                        ? 'text-red-400'
                        : step.status === 'pending'
                          ? 'text-zinc-500'
                          : 'text-amber-400'
                  }`}
                >
                  {step.status}
                  {step.stats?.tokensPerSec != null ? ` (${step.stats.tokensPerSec} t/s)` : ''}
                </span>
              </div>
              {step.role ? (
                <div className="text-[9px] text-zinc-500 font-mono mb-1">{step.role}</div>
              ) : null}
              <div className="text-zinc-300 whitespace-pre-wrap max-h-28 overflow-y-auto font-mono text-[10px]">
                {cleanStepBody(step.content) ||
                  (running ? 'Working…' : 'Awaiting computation…')}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
