import React from 'react';
import { Cloud, Sparkles, Zap } from 'lucide-react';
import { SPECIALTY_META, type ClusterAutoConfigPlan } from '../../lib/clusterAdvisor';

export interface AutoConfigSummaryRow {
  nodeId: string;
  nodeName: string;
  specialty: string;
  specialtyLabel: string;
  primaryModel?: string;
  numCtx?: number;
  numCtxLabel: string;
}

export function formatAutoConfigCtx(numCtx?: number): string {
  if (!numCtx || numCtx <= 0) return 'not set';
  if (numCtx % 1024 === 0) return `${numCtx / 1024}k`;
  return numCtx.toLocaleString();
}

/** Per-node rows AgentChat can render or pass straight into `AutoConfigConfirm`. */
export function autoConfigSummaryRows(plan: ClusterAutoConfigPlan): AutoConfigSummaryRow[] {
  return plan.nodes.map(rec => {
    const numCtx = rec.primaryModel ? rec.modelNumCtx[rec.primaryModel] : undefined;
    const meta = SPECIALTY_META[rec.specialty];
    return {
      nodeId: rec.nodeId,
      nodeName: rec.nodeName,
      specialty: rec.specialty,
      specialtyLabel: meta?.label || rec.specialty,
      primaryModel: rec.primaryModel,
      numCtx,
      numCtxLabel: formatAutoConfigCtx(numCtx)
    };
  });
}

export interface AutoConfigConfirmProps {
  plan: ClusterAutoConfigPlan;
  /** `confirm` asks before writing settings. `applied` offers Undo. */
  mode: 'confirm' | 'applied';
  busy?: boolean;
  canUndo?: boolean;
  onApply?: () => void;
  onUndo?: () => void;
  onSelectNode?: (nodeId: string) => void;
  /** Rationale, disabled-model notes, and suggested pulls. Default on. */
  showDetails?: boolean;
  pullProgress?: Record<string, { status: string }>;
  onPull?: (nodeId: string, tag: string) => void;
  /** Used to hide pull buttons on Frontier nodes. */
  nodeTypeById?: Record<string, string | undefined>;
}

/**
 * Summary of a Smart Auto-Configure plan.
 * Hardware settings shows this before Apply and after, with Undo.
 * AgentChat can render the same card for its quick button:
 * build a plan, render mode="confirm", snapshot nodes, then onApply / onUndo.
 */
export const AutoConfigConfirm: React.FC<AutoConfigConfirmProps> = ({
  plan,
  mode,
  busy = false,
  canUndo = false,
  onApply,
  onUndo,
  onSelectNode,
  showDetails = true,
  pullProgress,
  onPull,
  nodeTypeById
}) => {
  const rows = autoConfigSummaryRows(plan);

  return (
    <div className="bg-[#111116] border border-[#2b2b38] rounded-lg p-3 space-y-2.5 max-h-80 overflow-y-auto">
      <div className="flex items-start justify-between gap-2 flex-wrap border-b border-[#23232e] pb-2">
        <div className="min-w-0 space-y-0.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            {mode === 'applied' ? 'Applied configuration' : 'Review before applying'}
          </p>
          <p className="text-[11px] text-zinc-200 font-medium">{plan.summary}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
          {mode === 'confirm' && onApply && (
            <button
              type="button"
              onClick={onApply}
              disabled={busy}
              className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-[11px] font-semibold"
            >
              Apply configuration
            </button>
          )}
          {mode === 'applied' && onApply && (
            <button
              type="button"
              onClick={onApply}
              disabled={busy}
              className="px-2.5 py-1 rounded bg-emerald-600/80 hover:bg-emerald-500 disabled:opacity-40 text-white text-[11px] font-semibold"
            >
              Apply again
            </button>
          )}
          {canUndo && onUndo && (
            <button
              type="button"
              onClick={onUndo}
              disabled={busy}
              className="px-2.5 py-1 rounded bg-[#1e1e26] hover:bg-[#2a2a34] border border-amber-500/40 text-amber-200 text-[11px] font-semibold disabled:opacity-40"
            >
              Undo
            </button>
          )}
        </div>
      </div>

      <ul className="space-y-1.5">
        {rows.map(row => {
          const body = (
            <>
              <span className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-zinc-100 truncate">{row.nodeName}</span>
                <span className="text-[11px] text-indigo-200 shrink-0">{row.specialtyLabel}</span>
              </span>
              <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] font-mono text-zinc-300">
                <span>
                  Pinned model:{' '}
                  <strong className="text-indigo-300">{row.primaryModel || 'none installed'}</strong>
                </span>
                <span>
                  num_ctx: <strong className="text-emerald-300">{row.numCtxLabel}</strong>
                </span>
                <span>
                  Specialty: <strong className="text-amber-200">{row.specialty}</strong>
                </span>
              </span>
            </>
          );
          const className =
            'w-full text-left p-2.5 rounded-lg bg-[#17171f] border border-[#292936] space-y-0 block';
          if (!onSelectNode) {
            return (
              <li key={row.nodeId} className={className}>
                {body}
              </li>
            );
          }
          return (
            <li key={row.nodeId}>
              <button
                type="button"
                onClick={() => onSelectNode(row.nodeId)}
                className={`${className} hover:border-indigo-500/50 transition`}
              >
                {body}
              </button>
            </li>
          );
        })}
      </ul>

      {showDetails && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1">
          {plan.nodes.map(rec => {
            const meta = SPECIALTY_META[rec.specialty];
            const nodeType = nodeTypeById?.[rec.nodeId];
            return (
              <div key={`${rec.nodeId}-detail`} className="p-2.5 rounded-lg bg-[#17171f] border border-[#292936] space-y-1.5">
                <div className="flex items-center justify-between gap-1.5">
                  <span className="text-xs font-bold text-zinc-100 truncate">{rec.nodeName}</span>
                  {meta && (
                    <span className={`text-[11px] font-mono uppercase px-1.5 py-0.5 rounded border ${meta.badgeClass}`}>
                      {meta.shortLabel}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">{rec.rationale}</p>
                <p className="text-[11px] font-mono text-zinc-400">
                  Usable VRAM {rec.usableVramGB} GB (reserve {rec.recommendedReserveVramGB} GB)
                </p>
                {rec.disabledModels.length > 0 && (
                  <p className="text-[11px] text-amber-300/90">
                    Disables {rec.disabledModels.length} secondary model
                    {rec.disabledModels.length === 1 ? '' : 's'} ({rec.disabledModels.slice(0, 3).join(', ')}) so
                    Ollama keeps one primary model resident.
                  </p>
                )}
                {rec.recommendedPulls.length > 0 && nodeType !== 'openai' && onPull && (
                  <div className="pt-1 flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] uppercase tracking-wide text-zinc-500">Suggested pulls</span>
                    {rec.recommendedPulls.map(p => {
                      const prog = pullProgress?.[`${rec.nodeId}:${p.tag}`];
                      return (
                        <button
                          key={p.tag}
                          type="button"
                          onClick={() => onPull(rec.nodeId, p.tag)}
                          disabled={!!prog}
                          className="px-2 py-0.5 rounded text-[11px] font-mono bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-200 border border-indigo-500/30 transition disabled:opacity-50"
                          title={`${p.tag} (${p.sizeGB} GB · ~${p.estimatedTokPerSec} tok/s) — ${p.reason}`}
                        >
                          {prog ? `${p.tag} (${prog.status})` : `Pull ${p.tag}`}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export interface ClusterAutoConfigBarProps {
  nodeCount: number;
  cloudBusy: boolean;
  plan: ClusterAutoConfigPlan | null;
  open: boolean;
  mode: 'confirm' | 'applied';
  canUndo: boolean;
  statusNote: string | null;
  onPreview: () => void;
  onAudit: () => void;
  onToggleOpen: () => void;
  onApply: () => void;
  onUndo: () => void;
  onDismissNote: () => void;
  onSelectNode?: (nodeId: string) => void;
  pullProgress?: Record<string, { status: string }>;
  onPull?: (nodeId: string, tag: string) => void;
  nodeTypeById?: Record<string, string | undefined>;
}

/** Banner above Endpoints: preview, cloud audit, confirm, and undo. */
export const ClusterAutoConfigBar: React.FC<ClusterAutoConfigBarProps> = ({
  nodeCount,
  cloudBusy,
  plan,
  open,
  mode,
  canUndo,
  statusNote,
  onPreview,
  onAudit,
  onToggleOpen,
  onApply,
  onUndo,
  onDismissNote,
  onSelectNode,
  pullProgress,
  onPull,
  nodeTypeById
}) => (
  <div className="px-3 py-2.5 border-b border-[#27272a] bg-gradient-to-r from-indigo-950/35 via-[#16161d] to-violet-950/30 flex flex-col gap-2">
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <div className="flex items-center gap-2 min-w-0">
        <Sparkles className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <div className="text-xs font-bold text-zinc-100 flex items-center gap-1.5 flex-wrap">
            <span>Smart Cluster Auto-Configurator</span>
            <span className="text-[11px] font-mono uppercase px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              Multi-GPU Physics + Cloud Strategist
            </span>
          </div>
          <p className="text-[11px] text-zinc-400">
            Pins one primary model per GPU, sets num_ctx and VRAM overhead, and assigns a specialty. Apply asks
            for confirmation and can be undone.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
        <button
          type="button"
          onClick={onPreview}
          disabled={nodeCount === 0 || cloudBusy}
          className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow flex items-center gap-1.5 transition disabled:opacity-40"
          title="Build a plan and review pinned model, num_ctx, and specialty before applying"
        >
          <Zap className="w-3.5 h-3.5 text-amber-300" aria-hidden="true" />
          <span>Smart Auto-Configure Cluster</span>
        </button>
        <button
          type="button"
          onClick={onAudit}
          disabled={nodeCount === 0 || cloudBusy}
          className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-sky-600/25 hover:bg-sky-600/40 text-sky-200 border border-sky-500/40 flex items-center gap-1.5 transition disabled:opacity-40"
          title="Ask the Cloud Frontier model to audit roles, primary models, and context limits"
        >
          <Cloud className="w-3.5 h-3.5 text-sky-300" aria-hidden="true" />
          <span>{cloudBusy ? 'Auditing Cluster…' : 'Cloud Strategist Audit'}</span>
        </button>
        {canUndo && (
          <button
            type="button"
            onClick={onUndo}
            className="px-2 py-1 rounded text-[11px] text-amber-200 hover:text-amber-100 bg-[#1e1e26] border border-amber-500/40"
          >
            Undo
          </button>
        )}
        {plan && (
          <button
            type="button"
            onClick={onToggleOpen}
            className="px-2 py-1 rounded text-[11px] text-zinc-400 hover:text-zinc-200 bg-[#1e1e26] border border-[#2e2e3a]"
            aria-expanded={open}
          >
            {open ? 'Hide Plan' : 'Show Plan'}
          </button>
        )}
      </div>
    </div>

    {statusNote && (
      <div className="text-[11px] text-emerald-300 bg-emerald-950/30 border border-emerald-500/30 rounded px-2.5 py-1 flex items-center justify-between gap-2">
        <span>{statusNote}</span>
        <button
          type="button"
          onClick={onDismissNote}
          className="text-zinc-400 hover:text-white text-[11px] px-1"
          aria-label="Dismiss auto-configure status"
        >
          ✕
        </button>
      </div>
    )}

    {open && plan && (
      <AutoConfigConfirm
        plan={plan}
        mode={mode}
        busy={cloudBusy}
        canUndo={canUndo}
        onApply={onApply}
        onUndo={onUndo}
        onSelectNode={onSelectNode}
        pullProgress={pullProgress}
        onPull={onPull}
        nodeTypeById={nodeTypeById}
      />
    )}
  </div>
);
