import React from 'react';

interface StatsPanelProps {
  localTokens: number;
  frontierTokens: number;
  tokenStatsScope: 'global' | 'project';
  onTokenStatsScopeChange?: (scope: 'global' | 'project') => void;
  onResetTokenStats?: () => void;
  hasProject: boolean;
  projectLabel?: string;
}

export const StatsPanel: React.FC<StatsPanelProps> = ({
  localTokens,
  frontierTokens,
  tokenStatsScope,
  onTokenStatsScopeChange,
  onResetTokenStats,
  hasProject,
  projectLabel
}) => (
  <div className="flex-1 p-6 flex flex-col space-y-6 overflow-y-auto">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-sm font-bold text-zinc-100">Local Agent Token Economy</h3>
        <p className="text-xs text-zinc-400 mt-1">
          LocalAgents runs heavy agent loops on your local Ollama GPUs without API charges.
          {tokenStatsScope === 'project' && projectLabel
            ? ` Showing project “${projectLabel}”.`
            : tokenStatsScope === 'project'
              ? ' Open a project to track per-project tokens.'
              : ' Showing lifetime (global) totals.'}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        {onTokenStatsScopeChange && (
          <div
            role="group"
            aria-label="Token stats scope"
            className="flex items-center rounded-lg border border-[#30303a] bg-[#121215] p-0.5"
          >
            <button
              type="button"
              onClick={() => onTokenStatsScopeChange('global')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
                tokenStatsScope === 'global' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Global
            </button>
            <button
              type="button"
              onClick={() => onTokenStatsScopeChange('project')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
                tokenStatsScope === 'project' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
              }`}
              title={hasProject ? 'Current project totals' : 'Open a project to track per-project tokens'}
            >
              Project
            </button>
          </div>
        )}
        {onResetTokenStats && (
          <button
            type="button"
            onClick={onResetTokenStats}
            disabled={tokenStatsScope === 'project' && !hasProject}
            className="inline-flex items-center px-2.5 py-1 text-[11px] font-medium text-zinc-300 bg-[#1c1c22] hover:bg-[#272730] disabled:opacity-40 disabled:cursor-not-allowed border border-[#30303a] rounded-md transition"
            title={
              tokenStatsScope === 'project' ? 'Reset token stats for this project' : 'Reset lifetime global token stats'
            }
          >
            Reset
          </button>
        )}
      </div>
    </div>

    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div className="bg-[#121215] border border-[#272730] rounded-xl p-4 space-y-1">
        <span className="text-[11px] text-zinc-400 font-medium">Free Local Tokens Generated</span>
        <div className="text-2xl font-bold font-mono text-emerald-400">{localTokens.toLocaleString()}</div>
        <p className="text-[11px] text-zinc-500">Processed entirely on your local GPUs</p>
      </div>
      <div className="bg-[#121215] border border-[#272730] rounded-xl p-4 space-y-1">
        <span className="text-[11px] text-zinc-400 font-medium">Frontier Cloud Tokens Used</span>
        <div className="text-2xl font-bold font-mono text-sky-400">{frontierTokens.toLocaleString()}</div>
        <p className="text-[11px] text-zinc-500">Grok / OpenAI / Frontier calls</p>
      </div>
      <div className="bg-emerald-950/10 border border-emerald-500/30 rounded-xl p-4 space-y-1">
        <span className="text-[11px] text-emerald-300 font-medium">Estimated API Cost Saved</span>
        <div className="text-2xl font-bold font-mono text-emerald-300">
          ${((localTokens / 1000000) * 15).toFixed(2)}
        </div>
        <p className="text-[11px] text-emerald-500/80">Based on standard frontier token rates</p>
      </div>
    </div>
  </div>
);
