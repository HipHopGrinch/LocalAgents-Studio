import React from 'react';
import { PanelRightClose, Share2 } from 'lucide-react';
import { PipelineStep } from '../../types';
import { stripStepVerdictMarkup } from '../../lib/planOptions';
import { formatWorkerStatus } from './ActivityIndicator';

export interface NodeWorkPanelProps {
  steps: PipelineStep[];
  /** Header status when the parent knows who is working. Per-step lines still come from each step. */
  persona?: string;
  agentHandle?: string;
  node?: string;
  model?: string;
  file?: string;
  /** Sentence status when there is no structured worker (activity stack or plan notice). */
  statusText?: string;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** `bar` is a short horizontal strip (narrow / stacked layout). */
  collapseLayout?: 'rail' | 'bar';
}

function cleanStepBody(text: string): string {
  return stripStepVerdictMarkup(text || '')
    .replace(/<\/?(?:summary|notes|result|verdict|step_id)\b[^>]*>/gi, '')
    .trim();
}

function dotClass(status: PipelineStep['status']): string {
  if (status === 'running') return 'bg-amber-400 animate-pulse motion-reduce:animate-none';
  if (status === 'completed') return 'bg-emerald-400';
  if (status === 'failed') return 'bg-rose-400';
  return 'bg-zinc-500';
}

/** Pinned node→file worker cards (third column). A status dot pulses while running. */
export const NodeWorkPanel: React.FC<NodeWorkPanelProps> = ({
  steps,
  persona,
  agentHandle,
  node,
  model,
  file,
  statusText,
  collapsed = false,
  onToggleCollapsed,
  collapseLayout = 'rail'
}) => {
  const overview =
    formatWorkerStatus({ persona, agentHandle, node, model, file }) ||
    (statusText && statusText !== 'Working' ? statusText : '');
  const running = steps.some(step => step.status === 'running');

  if (collapsed) {
    const label = steps.length ? `Show node work, ${steps.length} steps` : 'Show node work';
    if (collapseLayout === 'bar') {
      return (
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded={false}
          aria-label={label}
          title={overview || 'Show node work'}
          className="flex h-full w-full items-center gap-2 px-2.5 bg-[var(--surface-1)] text-[11px] font-semibold text-amber-200/90 hover:bg-[#1c1c24]"
        >
          <Share2 className="w-3.5 h-3.5 shrink-0" />
          <span>Node work</span>
          <span
            className={`h-1.5 w-1.5 rounded-full ${running ? 'bg-amber-400 animate-pulse motion-reduce:animate-none' : 'bg-zinc-600'}`}
            aria-hidden="true"
          />
          {overview ? <span className="truncate font-normal text-zinc-400">{overview}</span> : null}
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={onToggleCollapsed}
        aria-expanded={false}
        aria-label={label}
        title={overview || 'Show node work'}
        className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[var(--surface-1)] text-zinc-400 hover:text-zinc-100 hover:bg-[#1c1c24]"
      >
        <Share2 className="w-3.5 h-3.5 text-amber-300/90 shrink-0" />
        <span
          className={`h-1.5 w-1.5 rounded-full shrink-0 ${running ? 'bg-amber-400 animate-pulse motion-reduce:animate-none' : 'bg-zinc-600'}`}
          aria-hidden="true"
        />
        <span className="text-[10px] font-semibold tracking-wide text-amber-200/80 [writing-mode:vertical-rl]">
          Node work
        </span>
      </button>
    );
  }

  const header = (
    <div className="p-2.5 border-b border-[var(--border)] shrink-0">
      <div className="flex items-center gap-1.5 text-[11px] uppercase font-bold tracking-wider text-amber-300/90">
        <Share2 className="w-3.5 h-3.5" />
        <span className="flex-1">Node work</span>
        {onToggleCollapsed && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-expanded
            aria-label="Hide node work"
            title="Hide node work"
            className="p-0.5 rounded text-zinc-400 hover:text-white hover:bg-[#252530]"
          >
            <PanelRightClose className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {overview ? (
        <p className="mt-1 text-[11px] font-medium normal-case tracking-normal text-zinc-300 truncate" title={overview}>
          {overview}
        </p>
      ) : null}
    </div>
  );

  if (!steps.length) {
    return (
      <div className="flex flex-col h-full min-h-0 bg-[var(--surface-1)] border-l border-[var(--border)]">
        {header}
        <div className="flex-1 min-h-0 p-2.5">
          <div className="rounded-md border border-dashed border-[#2a2a36] bg-[#0e0e12] px-2.5 py-3 text-[11px] text-zinc-400 leading-relaxed">
            Worker nodes appear here while Coder / Swarm / Reviewer runs.
          </div>
        </div>
      </div>
    );
  }

  return (
      <div className="flex flex-col h-full min-h-0 bg-[var(--surface-1)] border-l border-[var(--border)]">
        {header}
        <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-2">
        {steps.map((step, sIdx) => {
          const running = step.status === 'running';
          const line = formatWorkerStatus({
            persona: step.role,
            agentHandle: step.agentHandle,
            node: step.nodeName,
            model: step.modelName,
            file: step.targetFile
          });
          return (
            <div
              key={`${step.nodeId}-${step.targetFile || sIdx}`}
              className={`rounded-lg p-2.5 text-[11px] bg-[var(--surface-1)] border ${
                running ? 'border-amber-400/70' : 'border-[#282834]'
              }`}
            >
              <div className="flex items-start gap-2">
                <span
                  className={`mt-1 h-1.5 w-1.5 rounded-full shrink-0 ${dotClass(step.status)}`}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-zinc-200 truncate" title={line}>
                    {line || step.nodeName}
                  </div>
                  <div
                    className={`font-mono text-[11px] mt-0.5 ${
                      step.status === 'completed'
                        ? 'text-emerald-400'
                        : step.status === 'failed'
                          ? 'text-red-400'
                          : step.status === 'pending'
                            ? 'text-zinc-400'
                            : 'text-amber-400'
                    }`}
                  >
                    {step.status}
                    {step.stats?.tokensPerSec != null ? ` (${step.stats.tokensPerSec} t/s)` : ''}
                  </div>
                  <div className="text-zinc-300 whitespace-pre-wrap max-h-28 overflow-y-auto font-mono text-[11px] mt-1">
                    {cleanStepBody(step.content) ||
                      (running ? 'In progress…' : 'Waiting to start…')}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
