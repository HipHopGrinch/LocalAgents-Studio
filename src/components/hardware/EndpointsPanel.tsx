import React from 'react';
import { Cpu, Download, Key, Plus, Sliders, Trash2, Upload } from 'lucide-react';
import { EndpointNode, HardwareProfile, NodeRole } from '../../types';
import { GPU_PRESETS } from '../../config/defaults';
import { findNodeHoldingDev, isRoleAuto } from '../../lib/tools';
import { SPECIALTY_META } from '../../lib/clusterAdvisor';

const ROLE_OPTIONS: { value: NodeRole; label: string; hint: string }[] = [
  { value: 'coder', label: 'Coder', hint: 'coding / Auto-Node coder picks' },
  { value: 'planner', label: 'Planner', hint: 'Planner persona & Swarm Pass-1' },
  { value: 'reviewer', label: 'Reviewer', hint: 'reviewer persona & review tasks' },
  { value: 'docs', label: 'Docs', hint: 'docs persona & README/test tasks' }
];

const OVERHEAD_PRESETS = [
  {
    id: 'windows_desktop' as const,
    label: 'Windows Desktop (1.0 GB)',
    reserve: 1.0,
    hint: 'Primary Windows monitor connected to this GPU'
  },
  {
    id: 'headless_linux' as const,
    label: 'Headless Linux (0.2 GB)',
    reserve: 0.2,
    hint: 'Headless Linux server (e.g. GTX 1080 Ti with 10.8 GB usable VRAM)'
  },
  {
    id: 'igpu_display' as const,
    label: 'iGPU Display / 100% Dedicated (0.1 GB)',
    reserve: 0.1,
    hint: 'Windows/Linux display runs on iGPU — dGPU 100% free for Ollama (e.g. Laptop RTX 3060)'
  }
];

interface EndpointsPanelProps {
  nodes: EndpointNode[];
  currentNode?: EndpointNode;
  selectedNodeId: string;
  isNarrow: boolean;
  mobilePane: 'list' | 'detail';
  onMobilePane: (pane: 'list' | 'detail') => void;
  onSelectNode: (id: string) => void;
  onUpdateNodeProp: (field: 'name' | 'url' | 'apiKey' | 'type', value: string) => void;
  onSetRoleAuto: (auto: boolean) => void;
  onToggleAllowedRole: (role: NodeRole, checked: boolean) => void;
  onUpdateDevNode: (enabled: boolean) => void;
  onUpdateFreeTier: (enabled: boolean, dailyCap?: number, rpm?: number) => void;
  onDeleteNode: (id: string) => void;
  onApplyGpuPreset: (presetName: string) => void;
  onUpdateHardware: (field: keyof HardwareProfile, value: string | number) => void;
  onSetVramOverheadMode: (mode: 'windows_desktop' | 'headless_linux' | 'igpu_display') => void;
  onDetectHardware: () => void;
  onOpenExport: () => void;
  onOpenImport: () => void;
  onAddNode: () => void;
  banner?: React.ReactNode;
}

function EmptyEndpoints({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-6 py-8 text-zinc-500">
      <Cpu className="w-10 h-10 text-indigo-400/50 mb-3" aria-hidden="true" />
      <p className="text-sm font-semibold text-zinc-200">No endpoints configured</p>
      <p className="text-xs mt-2 max-w-sm leading-relaxed">
        Add a local Ollama node (for example <code className="text-indigo-300">http://127.0.0.1:11434</code>) or a
        Frontier API to get started.
      </p>
      <button
        type="button"
        onClick={onAdd}
        className="mt-4 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded-lg flex items-center space-x-1.5 transition"
      >
        <Plus className="w-3.5 h-3.5" aria-hidden="true" />
        <span>Add Node / Frontier API</span>
      </button>
    </div>
  );
}

export const EndpointsPanel: React.FC<EndpointsPanelProps> = ({
  nodes,
  currentNode,
  selectedNodeId,
  isNarrow,
  mobilePane,
  onMobilePane,
  onSelectNode,
  onUpdateNodeProp,
  onSetRoleAuto,
  onToggleAllowedRole,
  onUpdateDevNode,
  onUpdateFreeTier,
  onDeleteNode,
  onApplyGpuPreset,
  onUpdateHardware,
  onSetVramOverheadMode,
  onDetectHardware,
  onOpenExport,
  onOpenImport,
  onAddNode,
  banner
}) => {
  const showList = !isNarrow || mobilePane === 'list';
  const showDetail = !isNarrow || mobilePane === 'detail';
  const empty = nodes.length === 0;
  const showListEmpty = empty && isNarrow && showList;
  const showDetailEmpty = empty && showDetail && !(isNarrow && showList);

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      {banner}
      <div className="flex-1 flex overflow-hidden min-h-0">
        <div
          className={`${
            isNarrow ? (mobilePane === 'list' ? 'w-full' : 'hidden') : 'w-64 border-r'
          } border-[#27272a] bg-[#121215] flex flex-col justify-between p-2 shrink-0`}
        >
          <div className="space-y-1 overflow-y-auto">
            <div className="text-[11px] uppercase font-bold text-zinc-500 px-2 py-1 tracking-wider">
              Configured Endpoints
            </div>
            {showListEmpty && <EmptyEndpoints onAdd={onAddNode} />}
            {nodes.map(n => {
              const isFrontier = n.type === 'openai' || !!n.apiKey;
              const selected = selectedNodeId === n.id;
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => {
                    onSelectNode(n.id);
                    if (isNarrow) onMobilePane('detail');
                  }}
                  aria-pressed={selected}
                  className={`w-full text-left p-2.5 rounded-lg transition text-xs flex flex-col space-y-1 ${
                    selected
                      ? 'bg-indigo-600/20 border border-indigo-500/40 text-white'
                      : 'bg-[#18181d] border border-transparent text-zinc-300 hover:bg-[#202026]'
                  }`}
                >
                  <span className="flex items-center justify-between">
                    <span className="font-semibold truncate">{n.name}</span>
                    <span
                      className={`w-2 h-2 rounded-full ${
                        n.online ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]' : 'bg-red-500'
                      }`}
                      aria-hidden="true"
                    />
                  </span>
                  <span className="flex items-center justify-between text-[11px] text-zinc-400 font-mono gap-1">
                    <span className="truncate flex items-center gap-1 min-w-0">
                      {n.isDevNode && (
                        <span className="shrink-0 text-[11px] uppercase tracking-wide text-sky-300 bg-sky-500/15 border border-sky-500/30 px-1 rounded">
                          Dev
                        </span>
                      )}
                      {n.specialty && SPECIALTY_META[n.specialty] && (
                        <span
                          className={`shrink-0 text-[11px] uppercase tracking-wide px-1 rounded border ${SPECIALTY_META[n.specialty].badgeClass}`}
                          title={SPECIALTY_META[n.specialty].description}
                        >
                          {SPECIALTY_META[n.specialty].shortLabel}
                        </span>
                      )}
                      <span className="truncate">
                        {isFrontier
                          ? 'Frontier API'
                          : `${Math.max(0, +(n.hardware.vramGB - (n.hardware.reserveVramGB ?? 1)).toFixed(1))}/${n.hardware.vramGB}GB`}
                      </span>
                    </span>
                    {n.online && n.latency !== null && (
                      <span className="text-emerald-400 shrink-0">{n.latency}ms</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="space-y-1.5 pt-2 border-t border-[#27272a]">
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={onOpenExport}
                disabled={nodes.length === 0}
                className="py-1.5 px-1.5 border border-[#2d2d38] hover:border-indigo-500/60 text-zinc-400 hover:text-indigo-200 text-[11px] rounded-lg flex items-center justify-center space-x-1 transition disabled:opacity-40"
                title="Save encrypted backup of node setup (names, URLs, API keys, model prefs)"
              >
                <Download className="w-3 h-3 shrink-0" aria-hidden="true" />
                <span>Export</span>
              </button>
              <button
                type="button"
                onClick={onOpenImport}
                className="py-1.5 px-1.5 border border-[#2d2d38] hover:border-indigo-500/60 text-zinc-400 hover:text-indigo-200 text-[11px] rounded-lg flex items-center justify-center space-x-1 transition"
                title="Restore node setup from an encrypted .enc backup"
              >
                <Upload className="w-3 h-3 shrink-0" aria-hidden="true" />
                <span>Import</span>
              </button>
            </div>
            <button
              type="button"
              onClick={onAddNode}
              className="w-full py-2 border border-dashed border-[#2d2d38] hover:border-indigo-500 text-zinc-400 hover:text-indigo-300 text-xs rounded-lg flex items-center justify-center space-x-1.5 transition"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Add Node / Frontier API</span>
            </button>
          </div>
        </div>

        <div
          className={`${
            isNarrow ? (mobilePane === 'detail' ? 'w-full' : 'hidden') : 'flex-1'
          } p-4 sm:p-5 overflow-y-auto space-y-5 min-w-0`}
        >
          {isNarrow && currentNode && mobilePane === 'detail' && (
            <button
              type="button"
              onClick={() => onMobilePane('list')}
              className="text-[11px] text-indigo-300 hover:text-indigo-200"
            >
              ← All endpoints
            </button>
          )}
          {showDetailEmpty && <EmptyEndpoints onAdd={onAddNode} />}
          {currentNode && (
            <>
              <div className="bg-[#121215] border border-[#272730] rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center space-x-2 min-w-0 flex-wrap">
                    <span className="text-sm font-bold text-zinc-100 truncate">{currentNode.name}</span>
                    {currentNode.type === 'openai' ? (
                      <span className="text-[11px] bg-sky-500/20 text-sky-300 border border-sky-500/30 px-2 py-0.5 rounded font-mono">
                        Frontier API (OpenAI Compatible)
                      </span>
                    ) : (
                      <span className="text-[11px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded font-mono">
                        Local Ollama Node
                      </span>
                    )}
                    {currentNode.specialty && SPECIALTY_META[currentNode.specialty] && (
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded font-mono border ${SPECIALTY_META[currentNode.specialty].badgeClass}`}
                        title={SPECIALTY_META[currentNode.specialty].description}
                      >
                        {SPECIALTY_META[currentNode.specialty].label}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onDeleteNode(currentNode.id)}
                    className="text-xs text-red-400 hover:text-red-300 flex items-center space-x-1 p-1"
                    aria-label={`Delete ${currentNode.name}`}
                    title="Delete node"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Delete</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="text-[11px] text-zinc-400 font-medium" htmlFor="node-display-name">
                      Node Display Name
                    </label>
                    <input
                      id="node-display-name"
                      type="text"
                      value={currentNode.name}
                      onChange={e => onUpdateNodeProp('name', e.target.value)}
                      className="w-full mt-1 bg-[#1a1a20] border border-[#2a2a36] text-zinc-200 rounded px-2.5 py-1.5 outline-none font-sans"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-zinc-400 font-medium" htmlFor="node-endpoint-url">
                      Endpoint URL
                    </label>
                    <input
                      id="node-endpoint-url"
                      type="text"
                      value={currentNode.url}
                      onChange={e => onUpdateNodeProp('url', e.target.value)}
                      className="w-full mt-1 bg-[#1a1a20] border border-[#2a2a36] text-zinc-200 rounded px-2.5 py-1.5 outline-none font-mono text-[11px]"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <span className="text-[11px] text-zinc-400 font-medium">Allowed Roles</span>
                    <div className="mt-1.5 space-y-1.5 rounded border border-[#2a2a36] bg-[#1a1a20] px-2.5 py-2">
                      <label className="flex items-start gap-2 text-[11px] text-zinc-200 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isRoleAuto(currentNode)}
                          onChange={e => onSetRoleAuto(e.target.checked)}
                          className="mt-0.5 accent-emerald-500"
                        />
                        <span>
                          <span className="font-medium">Auto</span>
                          <span className="text-zinc-500"> — all roles; soft name/id preference, local-first</span>
                        </span>
                      </label>
                      <div
                        className={`grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1 pl-0.5 ${
                          isRoleAuto(currentNode) ? 'opacity-45 pointer-events-none' : ''
                        }`}
                      >
                        {ROLE_OPTIONS.map(opt => {
                          const checked = isRoleAuto(currentNode) || (currentNode.roles?.includes(opt.value) ?? false);
                          return (
                            <label
                              key={opt.value}
                              className={`flex items-start gap-2 text-[11px] ${
                                isRoleAuto(currentNode) ? 'text-zinc-500 cursor-not-allowed' : 'text-zinc-200 cursor-pointer'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={isRoleAuto(currentNode)}
                                onChange={e => onToggleAllowedRole(opt.value, e.target.checked)}
                                className="mt-0.5 accent-emerald-500 disabled:opacity-50"
                              />
                              <span>
                                <span className="font-medium">{opt.label}</span>
                                <span className="text-zinc-500"> — {opt.hint}</span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    <p className="text-[11px] text-zinc-500 mt-1">
                      Auto allows every role. Uncheck Auto to limit this node to selected roles — multiple nodes may
                      share the same role. Tagged nodes are preferred for those jobs (including Frontier); otherwise
                      routing falls back to Auto / local-first.
                    </p>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="flex items-start gap-2 text-[11px] text-zinc-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!currentNode.isDevNode}
                        onChange={e => onUpdateDevNode(e.target.checked)}
                        className="mt-0.5 rounded border-[#31313e] bg-[#1e1e24] text-indigo-500"
                      />
                      <span>
                        <span className="font-medium text-zinc-200">Dev node (workspace &amp; installs)</span>
                        <DevNodeHint nodes={nodes} current={currentNode} />
                      </span>
                    </label>
                  </div>
                </div>

                {(currentNode.type === 'openai' || currentNode.apiKey !== undefined) && (
                  <div>
                    <label className="text-[11px] text-zinc-400 font-medium flex items-center space-x-1" htmlFor="node-api-key">
                      <Key className="w-3 h-3 text-amber-400" aria-hidden="true" />
                      <span>API Key (Google Gemini / xAI Grok / OpenAI / OpenRouter)</span>
                    </label>
                    <input
                      id="node-api-key"
                      type="password"
                      placeholder={
                        currentNode.url?.includes('googleapis.com') ? 'AIzaSy... (Gemini API Key)' : 'xai-... or sk-...'
                      }
                      value={currentNode.apiKey || ''}
                      onChange={e => onUpdateNodeProp('apiKey', e.target.value)}
                      className="w-full mt-1 bg-[#1a1a20] border border-[#2a2a36] text-zinc-200 rounded px-2.5 py-1.5 outline-none font-mono text-[11px]"
                    />
                    <label className="mt-2 flex items-center gap-2 text-[11px] text-zinc-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!currentNode.freeTier}
                        onChange={e => onUpdateFreeTier(e.target.checked)}
                        className="rounded border-[#31313e] bg-[#1e1e24] text-indigo-500"
                      />
                      <span>Free tier</span>
                    </label>
                    {currentNode.freeTier && (
                      <div className="mt-1.5 space-y-1.5">
                        <label className="flex items-center gap-2 text-[11px] text-zinc-400">
                          <span>Assist calls per day</span>
                          <input
                            type="number"
                            min={1}
                            max={500}
                            value={currentNode.freeTierDailyCap ?? 20}
                            onChange={e => onUpdateFreeTier(true, Number(e.target.value), currentNode.freeTierRpm)}
                            className="w-16 bg-[#1a1a20] border border-[#2a2a36] text-zinc-200 rounded px-1.5 py-0.5 outline-none font-mono"
                          />
                          <span>used {freeTierUsedToday(currentNode)} today</span>
                        </label>
                        <label className="flex items-center gap-2 text-[11px] text-zinc-400">
                          <span>Requests per minute (RPM)</span>
                          <input
                            type="number"
                            min={1}
                            max={60}
                            value={currentNode.freeTierRpm ?? 10}
                            onChange={e =>
                              onUpdateFreeTier(true, currentNode.freeTierDailyCap, Number(e.target.value))
                            }
                            className="w-16 bg-[#1a1a20] border border-[#2a2a36] text-zinc-200 rounded px-1.5 py-0.5 outline-none font-mono"
                          />
                          <span className="text-zinc-500">waits when limit hit</span>
                        </label>
                      </div>
                    )}
                    <p className="text-[11px] text-zinc-500 mt-1">
                      Stored only on this PC under %APPDATA%\LocalAgents Studio\settings.json — never inside the EXE.
                      Plaintext, not encrypted.
                      {currentNode.freeTier
                        ? ' Free tier means every model on this node is a short assist. Local GPUs still write the code. Assists pace to your RPM (default 10/min) and wait/retry on provider 429 rate limits. Used when a prompt does not fit a local context window, or several files do not fit the local reviewer.'
                        : ''}
                    </p>
                  </div>
                )}
              </div>

              {currentNode.type !== 'openai' && (
                <div className="bg-[#121215] border border-[#272730] rounded-xl p-4 space-y-4">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center space-x-2 text-xs font-bold text-zinc-200">
                      <Sliders className="w-4 h-4 text-indigo-400" aria-hidden="true" />
                      <span>Compute & Memory Characteristics</span>
                    </div>
                    {currentNode.id === 'main-rig' && (
                      <button
                        type="button"
                        onClick={onDetectHardware}
                        className="text-[11px] text-indigo-300 hover:text-white bg-indigo-600/20 hover:bg-indigo-600/40 border border-indigo-500/30 px-2.5 py-1 rounded transition"
                      >
                        Auto-Detect This PC&apos;s Hardware
                      </button>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-[11px] text-zinc-400">Apply GPU Preset:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {GPU_PRESETS.slice(0, 10).map((p, _i, shown) => {
                        const gpuLower = currentNode.hardware.gpu.toLowerCase();
                        const bestLen = shown.reduce(
                          (len, q) => (gpuLower.includes(q.name.toLowerCase()) ? Math.max(len, q.name.length) : len),
                          0
                        );
                        const active = bestLen > 0 && p.name.length === bestLen && gpuLower.includes(p.name.toLowerCase());
                        return (
                          <button
                            key={p.name}
                            type="button"
                            onClick={() => onApplyGpuPreset(p.name)}
                            className={`px-2 py-0.5 rounded text-[11px] border transition ${
                              active
                                ? 'bg-indigo-600 text-white border-indigo-500'
                                : 'bg-[#1a1a20] border-[#2b2b36] text-zinc-400 hover:text-zinc-200'
                            }`}
                          >
                            {p.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <HwField label="GPU Model" value={currentNode.hardware.gpu} onChange={v => onUpdateHardware('gpu', v)} />
                    <HwNumber label="VRAM (GB)" value={currentNode.hardware.vramGB} onChange={v => onUpdateHardware('vramGB', v)} />
                    <HwNumber
                      label="GPU Bandwidth (GB/s)"
                      value={currentNode.hardware.gpuBandwidthGBs}
                      onChange={v => onUpdateHardware('gpuBandwidthGBs', v)}
                    />
                    <HwNumber label="System RAM (GB)" value={currentNode.hardware.ramGB} onChange={v => onUpdateHardware('ramGB', v)} />
                    <HwNumber
                      label="RAM Bandwidth (GB/s)"
                      value={currentNode.hardware.ramBandwidthGBs}
                      onChange={v => onUpdateHardware('ramBandwidthGBs', v)}
                    />
                    <div>
                      <label className="text-[11px] text-zinc-400">
                        Reserved VRAM (GB)
                        <span className="text-[11px] text-emerald-400 font-mono ml-1.5">
                          (
                          {Math.max(
                            0,
                            +(currentNode.hardware.vramGB - (currentNode.hardware.reserveVramGB ?? 1)).toFixed(1)
                          )}{' '}
                          GB usable)
                        </span>
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        value={currentNode.hardware.reserveVramGB}
                        onChange={e => onUpdateHardware('reserveVramGB', parseFloat(e.target.value) || 0)}
                        className="w-full mt-1 bg-[#1a1a20] border border-[#2a2a36] text-zinc-200 rounded px-2.5 py-1 outline-none font-mono"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-1 border-t border-[#22222c]">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-[11px] text-zinc-400">OS / Display VRAM Overhead Profile:</span>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {OVERHEAD_PRESETS.map(preset => {
                          const active =
                            currentNode.hardware.vramOverheadMode === preset.id ||
                            Math.abs((currentNode.hardware.reserveVramGB ?? 1) - preset.reserve) < 0.05;
                          return (
                            <button
                              key={preset.id}
                              type="button"
                              onClick={() => onSetVramOverheadMode(preset.id)}
                              title={preset.hint}
                              className={`px-2 py-0.5 rounded text-[11px] border transition ${
                                active
                                  ? 'bg-emerald-600/30 text-emerald-200 border-emerald-500/50 font-semibold'
                                  : 'bg-[#1a1a20] border-[#2b2b36] text-zinc-400 hover:text-zinc-200'
                              }`}
                            >
                              {preset.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {currentNode.advisorNote && (
                      <div className="text-[11px] text-indigo-300/90 bg-indigo-950/25 border border-indigo-500/25 rounded px-2.5 py-1.5 leading-relaxed">
                        <strong className="text-indigo-200">Cluster Advisor:</strong> {currentNode.advisorNote}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

function DevNodeHint({ nodes, current }: { nodes: EndpointNode[]; current: EndpointNode }) {
  const holder = findNodeHoldingDev(nodes, current.id);
  if (current.isDevNode) {
    return (
      <span className="block text-[11px] text-emerald-400/90 mt-0.5">
        This PC hosts the open folder, PowerShell, and package installs. Other nodes still analyze images, review, and
        generate — their file/terminal tools run here.
      </span>
    );
  }
  if (holder) {
    return (
      <span className="block text-[11px] text-zinc-500 mt-0.5">
        Currently {holder.name}. Checking this box moves Dev here (only one). Inference can stay on any GPU.
      </span>
    );
  }
  return (
    <span className="block text-[11px] text-zinc-500 mt-0.5">
      Mark where Studio and the project live. Defaults to localhost when detectable. Remote GPUs remain full
      multimodal collaborators.
    </span>
  );
}

function freeTierUsedToday(node: EndpointNode) {
  const usage = node.freeTierUsage;
  const today = new Date();
  const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return usage?.day === day ? usage.count || 0 : 0;
}

function HwField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-[11px] text-zinc-400">{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full mt-1 bg-[#1a1a20] border border-[#2a2a36] text-zinc-200 rounded px-2.5 py-1 outline-none font-mono"
      />
    </div>
  );
}

function HwNumber({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="text-[11px] text-zinc-400">{label}</label>
      <input
        type="number"
        value={value}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        className="w-full mt-1 bg-[#1a1a20] border border-[#2a2a36] text-zinc-200 rounded px-2.5 py-1 outline-none font-mono"
      />
    </div>
  );
}
