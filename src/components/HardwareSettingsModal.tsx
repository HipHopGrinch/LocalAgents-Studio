import React, { useEffect, useRef, useState } from 'react';
import { Cpu, RefreshCw, X } from 'lucide-react';
import { EndpointNode, HardwareProfile, ModelMeta, NodeConfig, NodeRole } from '../types';
import { GPU_PRESETS, guessGpuBandwidth } from '../config/defaults';
import { TaskId } from '../config/modelCatalog';
import { pullModel, streamChat } from '../lib/ollamaClient';
import {
  ALL_NODE_ROLES,
  assignAllowedRoles,
  assignDevNode,
  getEnabledModelsForNode,
  isEmbeddingModelName,
  isFrontierNode,
  normalizeClusterNodes
} from '../lib/tools';
import {
  applyClusterAutoConfigPlan,
  buildCloudClusterAuditPrompt,
  buildClusterAutoConfigPlan,
  mergeCloudAuditIntoPlan,
  type ClusterAutoConfigPlan
} from '../lib/clusterAdvisor';
import { modelSupportsThinking, normalizeThinkingInfo } from '../lib/thinking';
import { pinnedNumCtx } from '../lib/contextSize';
import { useDialog } from './ui/useDialog';
import { ModelHubPanel } from './hardware/ModelHubPanel';
import { InstalledModelsPanel } from './hardware/InstalledModelsPanel';
import { ClusterAutoConfigBar } from './hardware/AutoConfigConfirm';
import { EndpointsPanel } from './hardware/EndpointsPanel';
import { IntegrationsPanel } from './hardware/IntegrationsPanel';
import { AppearancePanel } from './hardware/AppearancePanel';
import { StatsPanel } from './hardware/StatsPanel';
import { SupportPanel } from './hardware/SupportPanel';
import {
  RemotePanel,
  type WebConsoleNoteTone,
  type WebConsolePatch,
  type WebConsoleStatusView
} from './hardware/RemotePanel';
import { AddNodeDialog, NodesTransferDialog } from './hardware/NodeDialogs';
import { ErrorCard } from './agent/ErrorCard';

/**
 * Open on a specific section. `nodes` and `endpoints` both land on Endpoints.
 * Header passes `stats` from the token counter and `endpoints` from the cluster chip
 * via the optional `onOpenHardware` callback (App wires that next).
 */
export type HardwareSettingsTab =
  | 'nodes'
  | 'endpoints'
  | 'models'
  | 'integrations'
  | 'hub'
  | 'appearance'
  | 'stats'
  | 'remote'
  | 'support';

type HardwareMainTab = 'nodes' | 'hub' | 'appearance' | 'stats' | 'remote' | 'support';
type NodesSection = 'endpoints' | 'models' | 'integrations';

interface HardwareSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  nodes: EndpointNode[];
  onUpdateNodes: (nodes: NodeConfig[]) => void;
  onRefreshNodes: (opts?: { force?: boolean }) => void;
  estimateContext: number;
  onUpdateEstimateContext: (ctx: number) => void;
  localTokens: number;
  frontierTokens: number;
  tokenStatsScope?: 'global' | 'project';
  onTokenStatsScopeChange?: (scope: 'global' | 'project') => void;
  onResetTokenStats?: () => void;
  hasProject?: boolean;
  projectLabel?: string;
  uiScale: number;
  onUpdateUiScale: (scale: number) => void;
  searxngUrl: string;
  onUpdateSearxngUrl: (url: string) => void;
  mcpServersJson?: string;
  onUpdateMcpServersJson?: (json: string) => void;
  /** Keep App settings.webConsole in sync after enable/port/password changes (display only). */
  onWebConsoleChange?: (webConsole: { enabled: boolean; port: number }) => void;
  /** Honored each time the modal opens (and when the value changes while open). */
  initialTab?: HardwareSettingsTab;
}

function snapshotNodeConfigs(list: EndpointNode[]): NodeConfig[] {
  return list.map(n => {
    const { online: _o, latency: _l, models: _m, loaded: _ld, error: _e, ...cfg } = n;
    return JSON.parse(JSON.stringify(cfg)) as NodeConfig;
  });
}

function applyInitialTab(
  tab: HardwareSettingsTab,
  setActiveTab: (tab: HardwareMainTab) => void,
  setNodesSection: (section: NodesSection) => void
) {
  if (tab === 'endpoints' || tab === 'models' || tab === 'integrations') {
    setActiveTab('nodes');
    setNodesSection(tab);
    return;
  }
  if (tab === 'nodes') {
    setActiveTab('nodes');
    setNodesSection('endpoints');
    return;
  }
  setActiveTab(tab);
}

export const HardwareSettingsModal: React.FC<HardwareSettingsModalProps> = ({
  isOpen,
  onClose,
  nodes,
  onUpdateNodes,
  onRefreshNodes,
  estimateContext,
  onUpdateEstimateContext,
  localTokens,
  frontierTokens,
  tokenStatsScope = 'global',
  onTokenStatsScopeChange,
  onResetTokenStats,
  hasProject = false,
  projectLabel,
  uiScale,
  onUpdateUiScale,
  searxngUrl,
  onUpdateSearxngUrl,
  mcpServersJson = '',
  onUpdateMcpServersJson,
  onWebConsoleChange,
  initialTab
}) => {
  const [activeTab, setActiveTab] = useState<HardwareMainTab>('nodes');
  const [nodesSection, setNodesSection] = useState<NodesSection>('endpoints');
  const [selectedNodeId, setSelectedNodeId] = useState<string>(nodes[0]?.id || '');
  const [selectedTask, setSelectedTask] = useState<TaskId>('agent');

  const [webEnabled, setWebEnabled] = useState(false);
  const [webPort, setWebPort] = useState(3847);
  const [webPassword, setWebPassword] = useState('');
  const [webShowPassword, setWebShowPassword] = useState(false);
  const [webStatus, setWebStatus] = useState<WebConsoleStatusView | null>(null);
  const [webBusy, setWebBusy] = useState(false);
  const [webNote, setWebNote] = useState('');
  const [webNoteTone, setWebNoteTone] = useState<WebConsoleNoteTone>('info');
  const [webLanEnabled, setWebLanEnabled] = useState(false);
  const [webAllowShell, setWebAllowShell] = useState(false);
  const [webTlsCert, setWebTlsCert] = useState('');
  const [webTlsKey, setWebTlsKey] = useState('');

  const [mobileNodePane, setMobileNodePane] = useState<'list' | 'detail'>('list');
  const [isNarrowHw, setIsNarrowHw] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : false
  );

  const [benchmarkingModel, setBenchmarkingModel] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [benchmarkingNodeId, setBenchmarkingNodeId] = useState<string | null>(null);
  const [pullProgress, setPullProgress] = useState<Record<string, { status: string; completed?: number; total?: number }>>({});

  const [showAddNode, setShowAddNode] = useState(false);
  const [newNodeName, setNewNodeName] = useState('');
  const [newNodeUrl, setNewNodeUrl] = useState('http://');
  const [newNodeType, setNewNodeType] = useState<'ollama' | 'openai'>('ollama');
  const [newNodeApiKey, setNewNodeApiKey] = useState('');

  const [customPullTag, setCustomPullTag] = useState('');
  const [isPullingCustom, setIsPullingCustom] = useState(false);
  const [customPullStatus, setCustomPullStatus] = useState<string | null>(null);
  const [customPullPercent, setCustomPullPercent] = useState<number | null>(null);
  const [inspectingModel, setInspectingModel] = useState<string | null>(null);

  const [nodesIOMode, setNodesIOMode] = useState<'export' | 'import' | null>(null);
  const [nodesIOPassphrase, setNodesIOPassphrase] = useState('');
  const [nodesIOConfirm, setNodesIOConfirm] = useState('');
  const [nodesIOMergeMode, setNodesIOMergeMode] = useState<'replace' | 'merge'>('replace');
  const [nodesIOBusy, setNodesIOBusy] = useState(false);
  const [nodesIOError, setNodesIOError] = useState<string | null>(null);

  const [advisorPlan, setAdvisorPlan] = useState<ClusterAutoConfigPlan | null>(null);
  const [advisorOpen, setAdvisorOpen] = useState(false);
  const [advisorPhase, setAdvisorPhase] = useState<'confirm' | 'applied'>('confirm');
  const [undoNodes, setUndoNodes] = useState<NodeConfig[] | null>(null);
  const [advisorCloudBusy, setAdvisorCloudBusy] = useState(false);
  const [advisorStatusNote, setAdvisorStatusNote] = useState<string | null>(null);

  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const currentNode = nodes.find(n => n.id === selectedNodeId) || nodes[0];
  const hubNode =
    currentNode && currentNode.type === 'openai'
      ? nodes.find(n => n.type !== 'openai')
      : currentNode;

  const applyShowMeta = (nodeId: string, modelName: string, show: {
    capabilities?: string[];
    description?: string;
    thinking?: ModelMeta['thinking'];
  }) => {
    const thinking = normalizeThinkingInfo(show.thinking, show.capabilities) || show.thinking;
    const meta: ModelMeta = {
      thinking,
      capabilities: show.capabilities,
      description: show.description,
      fetchedAt: Date.now()
    };
    const supports = modelSupportsThinking({ name: modelName, capabilities: show.capabilities, thinking });

    const updated = nodesRef.current.map(n => {
      if (n.id !== nodeId) return n;
      const modelMeta = { ...(n.modelMeta || {}), [modelName]: meta };
      const modelPrefs = { ...(n.modelPrefs || {}) };
      if (supports && modelPrefs[modelName]?.think === undefined) {
        modelPrefs[modelName] = { ...modelPrefs[modelName], think: false };
      }
      const models = (n.models || []).map(m =>
        m.name === modelName
          ? {
              ...m,
              capabilities: show.capabilities || m.capabilities,
              description: show.description || m.description,
              thinking
            }
          : m
      );
      return { ...n, modelMeta, modelPrefs, models };
    });
    nodesRef.current = updated as EndpointNode[];
    onUpdateNodes(updated);
  };

  const inspectModel = async (node: EndpointNode, modelName: string) => {
    if (!window.electronAPI || node.type === 'openai') return;
    setInspectingModel(modelName);
    try {
      const show = await window.electronAPI.showModel(node.url, modelName);
      if (show.error) {
        console.warn('showModel failed:', show.error);
        return;
      }
      applyShowMeta(node.id, modelName, show);
    } finally {
      setInspectingModel(null);
    }
  };

  const refreshWebConsoleStatus = async () => {
    if (!window.electronAPI?.webConsoleGetStatus) return;
    try {
      const st = await window.electronAPI.webConsoleGetStatus();
      setWebStatus({
        enabled: !!st.enabled,
        port: st.port || 3847,
        listening: !!st.listening,
        hasPassword: !!st.hasPassword,
        urls: st.urls || [],
        candidateUrls: st.candidateUrls || st.urls || [],
        clientCount: st.clientCount || 0,
        lanEnabled: st.lanEnabled,
        allowShell: st.allowShell,
        tls: st.tls
      });
      setWebEnabled(!!st.enabled);
      setWebPort(st.port || 3847);
      if (typeof st.lanEnabled === 'boolean') setWebLanEnabled(st.lanEnabled);
      if (typeof st.allowShell === 'boolean') setWebAllowShell(st.allowShell);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const apply = () => setIsNarrowHw(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void refreshWebConsoleStatus();
  }, [isOpen, activeTab]);

  useEffect(() => {
    if (!isOpen || activeTab !== 'remote') return;
    const id = window.setInterval(() => {
      void refreshWebConsoleStatus();
    }, 2000);
    return () => window.clearInterval(id);
  }, [isOpen, activeTab]);

  useEffect(() => {
    if (!isOpen || !currentNode || currentNode.type === 'openai' || !currentNode.online) return;
    const missing = (currentNode.models || []).filter(m => {
      if (isEmbeddingModelName(m.name, m.capabilities)) return false;
      return !currentNode.modelMeta?.[m.name]?.fetchedAt;
    });
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const m of missing.slice(0, 8)) {
        if (cancelled) break;
        await inspectModel(currentNode, m.name);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, currentNode?.id, currentNode?.online, currentNode?.models?.map(m => m.name).join(',')]);

  useEffect(() => {
    if (!isOpen || !initialTab) return;
    applyInitialTab(initialTab, setActiveTab, setNodesSection);
  }, [isOpen, initialTab]);

  const closeNodesIODialog = () => {
    setNodesIOMode(null);
    setNodesIOPassphrase('');
    setNodesIOConfirm('');
    setNodesIOMergeMode('replace');
    setNodesIOBusy(false);
    setNodesIOError(null);
  };

  const requestClose = () => {
    if (showAddNode) {
      setShowAddNode(false);
      return;
    }
    if (nodesIOMode) {
      closeNodesIODialog();
      return;
    }
    onClose();
  };

  const { dialogProps, overlayProps } = useDialog({
    open: isOpen,
    onClose: requestClose,
    labelledBy: 'hardware-settings-title'
  });

  const note = (text: string, tone: WebConsoleNoteTone) => {
    setWebNote(text);
    setWebNoteTone(tone);
  };

  const applyWebConsole = async (patch: WebConsolePatch) => {
    if (patch.password != null && patch.password.length < 8) {
      note('Password must be at least 8 characters.', 'error');
      return;
    }
    if (!window.electronAPI?.webConsoleUpdate) {
      note('Web console API unavailable', 'error');
      return;
    }
    if (typeof patch.enabled === 'boolean') setWebEnabled(patch.enabled);
    setWebBusy(true);
    setWebNote('');
    try {
      const res = await window.electronAPI.webConsoleUpdate(patch);
      if (res.error) {
        note(res.error, 'error');
        await refreshWebConsoleStatus();
        return;
      }
      if (res.status) {
        const status = res.status as WebConsoleStatusView & { clientCount?: number };
        setWebStatus({
          enabled: !!res.status.enabled,
          port: res.status.port || 3847,
          listening: !!res.status.listening,
          hasPassword: !!res.status.hasPassword,
          urls: res.status.urls || [],
          candidateUrls: status.candidateUrls || res.status.urls || [],
          clientCount: status.clientCount || 0,
          lanEnabled: status.lanEnabled,
          allowShell: status.allowShell,
          tls: status.tls
        });
      }
      setWebEnabled(!!res.status?.enabled);
      setWebPort(res.status?.port || patch.port || webPort);
      if (patch.password) setWebPassword('');
      if (typeof res.webConsole?.lanEnabled === 'boolean') setWebLanEnabled(res.webConsole.lanEnabled);
      if (typeof res.webConsole?.allowShell === 'boolean') setWebAllowShell(res.webConsole.allowShell);
      if (typeof res.webConsole?.tlsCertPath === 'string') setWebTlsCert(res.webConsole.tlsCertPath);
      if (typeof res.webConsole?.tlsKeyPath === 'string') setWebTlsKey(res.webConsole.tlsKeyPath);
      const enabled = !!(res.webConsole?.enabled ?? res.status?.enabled);
      const port = res.webConsole?.port || res.status?.port || webPort;
      onWebConsoleChange?.({ enabled, port });
      const keys = Object.keys(patch);
      const onlyLan = keys.length === 1 && patch.lanEnabled != null;
      const onlyShell = keys.length === 1 && patch.allowShell != null;
      if (onlyLan) {
        note(
          patch.lanEnabled
            ? 'LAN access on. Other devices on your network can connect.'
            : 'LAN access off. This PC only.',
          'success'
        );
      } else if (onlyShell) {
        note(
          patch.allowShell
            ? 'Remote clients can run commands on this PC.'
            : 'Remote command access is off.',
          patch.allowShell ? 'warning' : 'success'
        );
      } else if (patch.password) {
        note('Password saved.', 'success');
      } else if (patch.tlsCertPath != null || patch.tlsKeyPath != null) {
        note('TLS paths saved.', patch.tlsCertPath && patch.tlsKeyPath ? 'success' : 'info');
      } else if (res.status?.listening) {
        note('Web console is listening. Leave Enable on while you use phone/PC browsers.', 'success');
      } else if (res.status?.enabled) {
        note('Enabled but not listening — set a password, or the port may be in use.', 'warning');
      } else {
        note('Web console stopped.', 'info');
      }
      await refreshWebConsoleStatus();
    } finally {
      setWebBusy(false);
    }
  };

  const handleUpdateHardware = (field: keyof HardwareProfile, value: string | number) => {
    if (!currentNode) return;
    const updated = nodes.map(n => {
      if (n.id === currentNode.id) {
        return {
          ...n,
          hardware: {
            ...n.hardware,
            [field]: value
          }
        };
      }
      return n;
    });
    onUpdateNodes(updated);
  };

  const handleUpdateNodeProp = (field: 'name' | 'url' | 'apiKey' | 'type', value: string) => {
    if (!currentNode) return;
    const updated = nodes.map(n => {
      if (n.id === currentNode.id) {
        return { ...n, [field]: value };
      }
      return n;
    });
    onUpdateNodes(updated);
  };

  const handleSetRoleAuto = (auto: boolean) => {
    if (!currentNode) return;
    if (auto) {
      onUpdateNodes(assignAllowedRoles(nodes, currentNode.id, null));
      return;
    }
    onUpdateNodes(assignAllowedRoles(nodes, currentNode.id, [...ALL_NODE_ROLES]));
  };

  const handleToggleAllowedRole = (role: NodeRole, checked: boolean) => {
    if (!currentNode || !currentNode.roles?.length) return;
    const current = currentNode.roles || [];
    const next = checked ? [...current.filter(r => r !== role), role] : current.filter(r => r !== role);
    onUpdateNodes(assignAllowedRoles(nodes, currentNode.id, next.length ? next : null));
  };

  const handleUpdateDevNode = (enabled: boolean) => {
    if (!currentNode) return;
    onUpdateNodes(assignDevNode(nodes, currentNode.id, enabled));
  };

  const handleUpdateFreeTier = (enabled: boolean, dailyCap?: number, rpm?: number) => {
    if (!currentNode) return;
    const updated = nodes.map(n => {
      if (n.id !== currentNode.id) return n;
      const cap = dailyCap ?? n.freeTierDailyCap ?? 20;
      const rpmVal = rpm ?? n.freeTierRpm ?? 10;
      return {
        ...n,
        freeTier: enabled,
        freeTierDailyCap: Math.min(500, Math.max(1, Math.floor(cap) || 20)),
        freeTierRpm: Math.min(60, Math.max(1, Math.floor(rpmVal) || 10))
      };
    });
    onUpdateNodes(updated);
  };

  const handleApplyGpuPreset = (presetName: string) => {
    const preset = GPU_PRESETS.find(p => p.name === presetName);
    if (!preset) return;
    if (!currentNode) return;
    onUpdateNodes(
      nodes.map(n =>
        n.id === currentNode.id
          ? {
              ...n,
              hardware: {
                ...n.hardware,
                gpu: preset.name,
                vramGB: preset.vramGB,
                gpuBandwidthGBs: preset.bandwidth
              }
            }
          : n
      )
    );
  };

  const handleSetVramOverheadMode = (mode: 'windows_desktop' | 'headless_linux' | 'igpu_display') => {
    if (!currentNode) return;
    const reserve = mode === 'headless_linux' ? 0.2 : mode === 'igpu_display' ? 0.1 : 1.0;
    const updated = nodes.map(n => {
      if (n.id !== currentNode.id) return n;
      return {
        ...n,
        hardware: {
          ...n.hardware,
          vramOverheadMode: mode,
          reserveVramGB: reserve
        }
      };
    });
    onUpdateNodes(updated);
  };

  const handleRunSmartAutoConfig = () => {
    const plan = buildClusterAutoConfigPlan(nodesRef.current);
    setAdvisorPlan(plan);
    setAdvisorOpen(true);
    setAdvisorPhase('confirm');
    setAdvisorStatusNote('Review pinned model, num_ctx, and specialty for each node, then apply.');
  };

  const handleApplyAdvisorPlan = (planToApply?: ClusterAutoConfigPlan) => {
    const plan = planToApply || advisorPlan;
    if (!plan) return;
    setUndoNodes(snapshotNodeConfigs(nodesRef.current));
    const updated = applyClusterAutoConfigPlan(nodesRef.current, plan);
    onUpdateNodes(normalizeClusterNodes(updated));
    setAdvisorPhase('applied');
    setAdvisorOpen(true);
    setAdvisorStatusNote(
      plan.source === 'cloud_strategist'
        ? 'Applied Cloud Strategist + Physics cluster configuration. Undo restores the previous nodes.'
        : 'Applied Smart Hardware-Physics cluster configuration. Undo restores the previous nodes.'
    );
  };

  const handleUndoAutoConfig = () => {
    if (!undoNodes) return;
    onUpdateNodes(undoNodes);
    setUndoNodes(null);
    setAdvisorPhase('confirm');
    setAdvisorStatusNote('Restored the cluster configuration from before the last apply.');
  };

  const handleRunCloudStrategistAudit = async () => {
    const frontierNodes = nodesRef.current.filter(
      n => isFrontierNode(n) && n.online && getEnabledModelsForNode(n).length > 0
    );
    const fallbackPlanner = nodesRef.current
      .filter(n => n.online && !isFrontierNode(n) && getEnabledModelsForNode(n).length > 0)
      .sort((a, b) => (b.hardware.vramGB || 0) - (a.hardware.vramGB || 0))[0];

    const auditorNode = frontierNodes[0] || fallbackPlanner;
    if (!auditorNode) {
      setAdvisorStatusNote('No online Frontier API or local GPU node available to run the audit.');
      return;
    }
    const enabled = getEnabledModelsForNode(auditorNode);
    const auditorModel =
      auditorNode.activeModel && enabled.includes(auditorNode.activeModel)
        ? auditorNode.activeModel
        : enabled[0];

    const basePlan = advisorPlan || buildClusterAutoConfigPlan(nodesRef.current);
    setAdvisorPlan(basePlan);
    setAdvisorOpen(true);
    setAdvisorPhase('confirm');
    setAdvisorCloudBusy(true);
    setAdvisorStatusNote(`Auditing cluster inventory with ${auditorNode.name} (${auditorModel})...`);

    try {
      const prompt = buildCloudClusterAuditPrompt(nodesRef.current, basePlan);
      const advice = basePlan.nodes.find(n => n.nodeId === auditorNode.id);
      const pinnedCtx =
        auditorNode.modelPrefs?.[auditorModel]?.numCtx ??
        (auditorModel ? advice?.modelNumCtx?.[auditorModel] : undefined);
      const options: { temperature: number; num_ctx?: number } = { temperature: 0.1 };
      if (typeof pinnedCtx === 'number' && pinnedCtx > 0) options.num_ctx = pinnedCtx;

      const { done } = streamChat(
        auditorNode.url,
        {
          model: auditorModel,
          messages: [
            {
              role: 'system',
              content: 'You are an expert distributed GPU systems architect. Respond ONLY with valid JSON.'
            },
            { role: 'user', content: prompt }
          ],
          think: false,
          format: 'json',
          options
        },
        () => {},
        auditorNode.type,
        auditorNode.apiKey
      );
      const res = await done;
      const merged = mergeCloudAuditIntoPlan(res.content, basePlan, `${auditorNode.name} (${auditorModel})`);
      setAdvisorPlan(merged);
      setAdvisorPhase('confirm');
      setAdvisorStatusNote(
        `Cloud Strategist audit ready via ${auditorNode.name} (${auditorModel}). Review the summary, then apply.`
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'error';
      setAdvisorStatusNote(`Cloud audit failed (${message}) — kept deterministic Physics plan.`);
    } finally {
      setAdvisorCloudBusy(false);
    }
  };

  const handleDetectHardware = async () => {
    if (!window.electronAPI || !currentNode) return;
    try {
      const detected = await window.electronAPI.detectHardware();
      const gpuName = detected.gpu || currentNode.hardware.gpu;
      const guessedBw = guessGpuBandwidth(gpuName);
      const updated = nodesRef.current.map(n => {
        if (n.id === currentNode.id) {
          return {
            ...n,
            hardware: {
              ...n.hardware,
              cpu: detected.cpu || n.hardware.cpu,
              gpu: detected.gpu || n.hardware.gpu,
              vramGB: detected.vramGB || n.hardware.vramGB,
              ramGB: detected.ramGB || n.hardware.ramGB,
              ramBandwidthGBs: detected.ramBandwidthGBs || n.hardware.ramBandwidthGBs,
              gpuBandwidthGBs: guessedBw || n.hardware.gpuBandwidthGBs
            }
          };
        }
        return n;
      });
      onUpdateNodes(updated);
    } catch (err) {
      console.error('Failed to detect hardware:', err);
    }
  };

  const handleRunBenchmark = async (node: EndpointNode, modelName: string) => {
    if (!window.electronAPI) return;
    setActionError(null);
    setBenchmarkingModel(modelName);
    setBenchmarkingNodeId(node.id);

    try {
      const ctx = pinnedNumCtx(node, modelName);
      const res = await window.electronAPI.benchmarkModel(node, modelName, ctx);
      if (!res.error) {
        const measured = {
          ...res,
          provisional: false,
          measuredAt: Date.now()
        };
        const updated = nodes.map(n => {
          if (n.id === node.id) {
            const benchmarks = { ...(n.benchmarks || {}), [modelName]: measured };
            return { ...n, benchmarks };
          }
          return n;
        });
        onUpdateNodes(updated);
      } else {
        setActionError(`Benchmark failed: ${res.error}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Benchmark failed';
      setActionError(`Benchmark error: ${message}`);
    } finally {
      setBenchmarkingModel(null);
      setBenchmarkingNodeId(null);
    }
  };

  const handlePullModel = (node: EndpointNode, tag: string) => {
    const key = `${node.id}:${tag}`;
    setPullProgress(prev => ({ ...prev, [key]: { status: 'Starting download...' } }));

    pullModel(node.url, tag, (status, completed, total) => {
      setPullProgress(prev => ({
        ...prev,
        [key]: { status, completed, total }
      }));
    }).done.then(async () => {
      await onRefreshNodes({ force: true });
      await inspectModel(node, tag);
      setTimeout(() => {
        setPullProgress(prev => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }, 3000);
    }).catch(err => {
      setPullProgress(prev => ({
        ...prev,
        [key]: { status: `Failed: ${err.message}` }
      }));
    });
  };

  const handleDirectPull = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customPullTag.trim() || !currentNode || isPullingCustom) return;

    const tag = customPullTag.trim();
    setIsPullingCustom(true);
    setCustomPullStatus(`Connecting to ${currentNode.name}...`);
    setCustomPullPercent(0);

    pullModel(currentNode.url, tag, (status, completed, total) => {
      let pct: number | null = null;
      let label = status;
      if (completed && total && total > 0) {
        pct = Math.round((completed / total) * 100);
        label = `${status} (${pct}% · ${(completed / 1e9).toFixed(1)} / ${(total / 1e9).toFixed(1)} GB)`;
      }
      setCustomPullStatus(label);
      setCustomPullPercent(pct);
    }).done.then(async () => {
      setCustomPullStatus('Pull complete! Inspecting model capabilities…');
      setCustomPullTag('');
      await onRefreshNodes({ force: true });
      await inspectModel(currentNode, tag);
      setCustomPullStatus('Pull complete! Thinking controls available if the model supports them.');
      setTimeout(() => {
        setIsPullingCustom(false);
        setCustomPullStatus(null);
        setCustomPullPercent(null);
      }, 3500);
    }).catch(err => {
      setCustomPullStatus(`Failed: ${err.message}`);
      setTimeout(() => {
        setIsPullingCustom(false);
        setCustomPullStatus(null);
        setCustomPullPercent(null);
      }, 5000);
    });
  };

  const handleDeleteModelFromNode = async (node: EndpointNode, modelName: string) => {
    if (!confirm(`Are you sure you want to delete "${modelName}" from ${node.name}? This will permanently remove it from that computer's storage.`)) return;
    if (!window.electronAPI) return;
    try {
      const res = await window.electronAPI.deleteModel(node.url, modelName);
      if (res.success) {
        const updated = nodes.map(n => {
          if (n.id !== node.id) return n;
          const { [modelName]: _removed, ...restBench } = n.benchmarks || {};
          const nextModels = (n.models || []).filter(m => m.name !== modelName);
          const remainingNames = nextModels
            .map(m => m.name)
            .filter(name => !isEmbeddingModelName(name) && !(n.disabledModels || []).includes(name));
          const nextActive = n.activeModel === modelName ? remainingNames[0] || undefined : n.activeModel;
          const { [modelName]: _m, ...restMeta } = n.modelMeta || {};
          const { [modelName]: _p, ...restPrefs } = n.modelPrefs || {};
          return {
            ...n,
            models: nextModels,
            benchmarks: restBench,
            modelMeta: restMeta,
            modelPrefs: restPrefs,
            activeModel: nextActive,
            disabledModels: (n.disabledModels || []).filter(d => d !== modelName)
          };
        });
        onUpdateNodes(updated);
        onRefreshNodes({ force: true });
      } else {
        setActionError(`Delete failed: ${res.error}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Delete failed';
      setActionError(`Delete error: ${message}`);
    }
  };

  const handleToggleModelEnabled = (node: EndpointNode, modelName: string) => {
    const disabledSet = new Set(node.disabledModels || []);
    if (disabledSet.has(modelName)) disabledSet.delete(modelName);
    else disabledSet.add(modelName);
    const nextDisabled = Array.from(disabledSet);

    const updated = nodes.map(n => {
      if (n.id === node.id) {
        let nextActive = n.activeModel;
        if (nextActive === modelName && disabledSet.has(modelName)) {
          const remaining = (n.models || [])
            .map(m => m.name)
            .filter(name => !disabledSet.has(name) && !name.toLowerCase().includes('embed') && !name.toLowerCase().includes('bge'));
          nextActive = remaining[0] || undefined;
        }
        return { ...n, disabledModels: nextDisabled, activeModel: nextActive };
      }
      return n;
    });
    onUpdateNodes(updated);
  };

  const handleSetAllModelsEnabled = (node: EndpointNode, enabled: boolean) => {
    const generative = (node.models || []).filter(m => {
      const isEmbed =
        m.capabilities?.includes('embedding') ||
        m.name.toLowerCase().includes('embed') ||
        m.name.toLowerCase().includes('bge');
      return !isEmbed;
    });
    if (generative.length === 0) return;

    const updated = nodes.map(n => {
      if (n.id !== node.id) return n;
      if (enabled) {
        const first = generative[0]?.name;
        const nextActive =
          n.activeModel && generative.some(m => m.name === n.activeModel) ? n.activeModel : first;
        return { ...n, disabledModels: [], activeModel: nextActive };
      }
      return { ...n, disabledModels: generative.map(m => m.name), activeModel: undefined };
    });
    onUpdateNodes(updated);
  };

  const openNodesIODialog = (mode: 'export' | 'import') => {
    setNodesIOMode(mode);
    setNodesIOPassphrase('');
    setNodesIOConfirm('');
    setNodesIOMergeMode('replace');
    setNodesIOBusy(false);
    setNodesIOError(null);
  };

  const nodesToExportConfigs = (): NodeConfig[] =>
    nodes.map(n => {
      const { online: _o, latency: _l, models: _m, loaded: _ld, error: _e, ...cfg } = n;
      return cfg;
    });

  const handleNodesIOSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!window.electronAPI || !nodesIOMode) return;
    setNodesIOError(null);

    if (nodesIOPassphrase.length < 4) {
      setNodesIOError('Passphrase must be at least 4 characters');
      return;
    }
    if (nodesIOMode === 'export' && nodesIOPassphrase !== nodesIOConfirm) {
      setNodesIOError('Passphrases do not match');
      return;
    }

    setNodesIOBusy(true);
    try {
      if (nodesIOMode === 'export') {
        const res = await window.electronAPI.exportNodes(nodesToExportConfigs(), nodesIOPassphrase);
        if (res.canceled) {
          setNodesIOBusy(false);
          return;
        }
        if (res.error) {
          setNodesIOError(res.error);
          setNodesIOBusy(false);
          return;
        }
        closeNodesIODialog();
        return;
      }

      const res = await window.electronAPI.importNodes(nodesIOPassphrase);
      if (res.canceled) {
        setNodesIOBusy(false);
        return;
      }
      if (res.error || !res.nodes?.length) {
        setNodesIOError(res.error || 'No nodes in file');
        setNodesIOBusy(false);
        return;
      }

      const imported = res.nodes;
      let next: NodeConfig[];
      if (nodesIOMergeMode === 'replace') {
        next = imported;
      } else {
        const byId = new Map(nodesToExportConfigs().map(n => [n.id, n]));
        const byUrl = new Map(nodesToExportConfigs().map(n => [n.url, n.id]));
        for (const inc of imported) {
          const urlMatchId = byUrl.get(inc.url);
          if (byId.has(inc.id)) {
            byId.set(inc.id, { ...byId.get(inc.id)!, ...inc });
          } else if (urlMatchId && byId.has(urlMatchId)) {
            byId.set(urlMatchId, { ...byId.get(urlMatchId)!, ...inc, id: urlMatchId });
          } else {
            byId.set(inc.id, inc);
          }
        }
        next = Array.from(byId.values());
      }

      const normalized = normalizeClusterNodes(next);
      onUpdateNodes(normalized);
      if (normalized[0]?.id) setSelectedNodeId(normalized[0].id);
      closeNodesIODialog();
      onRefreshNodes();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Operation failed';
      setNodesIOError(message);
      setNodesIOBusy(false);
    }
  };

  const handleSetPrimaryModel = (node: EndpointNode, modelName: string) => {
    const disabledSet = new Set(node.disabledModels || []);
    disabledSet.delete(modelName);
    const updated = nodes.map(n => {
      if (n.id === node.id) {
        return { ...n, activeModel: modelName, disabledModels: Array.from(disabledSet) };
      }
      return n;
    });
    onUpdateNodes(updated);
  };

  const handleToggleThinking = (node: EndpointNode, modelName: string, enabled: boolean) => {
    const updated = nodes.map(n => {
      if (n.id !== node.id) return n;
      return {
        ...n,
        modelPrefs: {
          ...(n.modelPrefs || {}),
          [modelName]: { ...(n.modelPrefs?.[modelName] || {}), think: enabled }
        }
      };
    });
    onUpdateNodes(updated);
  };

  const handleSetModelNumCtx = (node: EndpointNode, modelName: string, numCtx: number) => {
    const updated = nodes.map(n => {
      if (n.id !== node.id) return n;
      return {
        ...n,
        modelPrefs: {
          ...(n.modelPrefs || {}),
          [modelName]: { ...(n.modelPrefs?.[modelName] || {}), numCtx }
        }
      };
    });
    onUpdateNodes(updated);
  };

  const handleAddNodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNodeName.trim() || !newNodeUrl.trim()) return;

    const isFrontier = newNodeType === 'openai' || newNodeUrl.includes('x.ai') || newNodeUrl.includes('openai');
    const newNode: NodeConfig = {
      id: `node-${Date.now()}`,
      name: newNodeName.trim(),
      url: newNodeUrl.trim(),
      type: newNodeType,
      apiKey: newNodeApiKey.trim(),
      hardware: {
        cpu: isFrontier ? 'Cloud Cluster' : 'Generic CPU',
        gpu: isFrontier ? 'Frontier GPU Cluster' : 'Generic GPU',
        vramGB: isFrontier ? 80 : 8,
        gpuBandwidthGBs: isFrontier ? 3000 : 300,
        ramGB: isFrontier ? 128 : 16,
        ramBandwidthGBs: isFrontier ? 500 : 50,
        reserveVramGB: isFrontier ? 0 : 1,
        kvCacheType: 'f16'
      }
    };

    onUpdateNodes(normalizeClusterNodes([...nodes, newNode]));
    setSelectedNodeId(newNode.id);
    setShowAddNode(false);
    setNewNodeName('');
    setNewNodeUrl('http://');
    setNewNodeApiKey('');
    setTimeout(onRefreshNodes, 200);
  };

  const handleDeleteNode = (id: string) => {
    if (confirm('Delete this endpoint node from cluster?')) {
      const filtered = normalizeClusterNodes(nodes.filter(n => n.id !== id));
      onUpdateNodes(filtered);
      if (selectedNodeId === id) setSelectedNodeId(filtered[0]?.id || '');
    }
  };

  if (!isOpen) return null;

  const hwTabs: { id: HardwareMainTab; label: string; short: string }[] = [
    { id: 'nodes', label: `Nodes (${nodes.length})`, short: `Nodes (${nodes.length})` },
    { id: 'hub', label: 'Model Hub', short: 'Hub' },
    { id: 'appearance', label: 'Appearance', short: 'Display' },
    { id: 'stats', label: 'Token Stats', short: 'Stats' },
    { id: 'remote', label: 'Web Console', short: 'Remote' },
    { id: 'support', label: 'Support', short: 'Support' }
  ];

  const nodeSections: { id: NodesSection; label: string }[] = [
    { id: 'endpoints', label: 'Endpoints' },
    { id: 'models', label: 'Models' },
    { id: 'integrations', label: 'Integrations' }
  ];

  const nodeTypeById = Object.fromEntries(nodes.map(n => [n.id, n.type]));

  return (
    <div
      className={`fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center ${
        isNarrowHw ? 'p-0' : 'p-4'
      }`}
      {...overlayProps}
    >
      <div
        className="relative bg-[#161619] border border-[#2e2e38] w-full max-w-4xl sm:rounded-xl shadow-2xl overflow-hidden flex flex-col h-[100dvh] sm:h-[85vh] max-h-[100dvh] sm:max-h-[85vh] rounded-none outline-none"
        {...dialogProps}
      >
        <div className="shrink-0 bg-[#121215] border-b border-[#27272a]">
          <div className="h-11 px-3 sm:px-4 flex items-center justify-between gap-2">
            <div className="flex items-center space-x-2 text-indigo-400 font-bold text-sm min-w-0">
              <Cpu className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span id="hardware-settings-title" className="truncate">
                Hardware & Models
              </span>
            </div>
            <div className="flex items-center space-x-1.5 shrink-0">
              <button
                type="button"
                onClick={() => onRefreshNodes({ force: true })}
                className="flex items-center space-x-1 px-2 py-1 text-xs text-zinc-300 hover:text-white bg-[#1e1e24] hover:bg-[#282830] rounded border border-[#2c2c36] transition"
                title="Ping all endpoints"
                aria-label="Ping all endpoints"
              >
                <RefreshCw className="w-3 h-3" aria-hidden="true" />
                {!isNarrowHw && <span>Ping All</span>}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 text-zinc-400 hover:text-white rounded"
                aria-label="Close hardware settings"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="px-2 pb-2 flex items-center gap-1 overflow-x-auto" role="tablist" aria-label="Hardware settings">
            {hwTabs.map(t => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={activeTab === t.id}
                onClick={() => {
                  setActiveTab(t.id);
                  if (t.id === 'nodes' && isNarrowHw) setMobileNodePane('list');
                }}
                className={`px-2.5 py-1 rounded text-[11px] whitespace-nowrap shrink-0 transition ${
                  activeTab === t.id
                    ? 'bg-indigo-600 text-white font-medium'
                    : 'text-zinc-400 hover:text-white bg-[#18181d]'
                }`}
              >
                {isNarrowHw ? t.short : t.label}
              </button>
            ))}
          </div>
        </div>

        {actionError ? (
          <div className="px-3 pt-2">
            <ErrorCard cause={actionError} />
          </div>
        ) : null}

        {activeTab === 'nodes' && (
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            <div className="px-2 pt-2 pb-1 flex items-center gap-1 border-b border-[#27272a]" role="tablist" aria-label="Node settings">
              {nodeSections.map(section => (
                <button
                  key={section.id}
                  type="button"
                  role="tab"
                  aria-selected={nodesSection === section.id}
                  onClick={() => setNodesSection(section.id)}
                  className={`px-2.5 py-1 rounded text-[11px] transition ${
                    nodesSection === section.id
                      ? 'bg-[#1e1e28] text-indigo-200 border border-indigo-500/40 font-medium'
                      : 'text-zinc-400 hover:text-white border border-transparent'
                  }`}
                >
                  {section.label}
                </button>
              ))}
            </div>

            {nodesSection === 'endpoints' && (
              <EndpointsPanel
                nodes={nodes}
                currentNode={currentNode}
                selectedNodeId={selectedNodeId}
                isNarrow={isNarrowHw}
                mobilePane={mobileNodePane}
                onMobilePane={setMobileNodePane}
                onSelectNode={setSelectedNodeId}
                onUpdateNodeProp={handleUpdateNodeProp}
                onSetRoleAuto={handleSetRoleAuto}
                onToggleAllowedRole={handleToggleAllowedRole}
                onUpdateDevNode={handleUpdateDevNode}
                onUpdateFreeTier={handleUpdateFreeTier}
                onDeleteNode={handleDeleteNode}
                onApplyGpuPreset={handleApplyGpuPreset}
                onUpdateHardware={handleUpdateHardware}
                onSetVramOverheadMode={handleSetVramOverheadMode}
                onDetectHardware={() => void handleDetectHardware()}
                onOpenExport={() => openNodesIODialog('export')}
                onOpenImport={() => openNodesIODialog('import')}
                onAddNode={() => setShowAddNode(true)}
                banner={
                  <ClusterAutoConfigBar
                    nodeCount={nodes.length}
                    cloudBusy={advisorCloudBusy}
                    plan={advisorPlan}
                    open={advisorOpen}
                    mode={advisorPhase}
                    canUndo={!!undoNodes}
                    statusNote={advisorStatusNote}
                    onPreview={handleRunSmartAutoConfig}
                    onAudit={() => void handleRunCloudStrategistAudit()}
                    onToggleOpen={() => setAdvisorOpen(v => !v)}
                    onApply={() => handleApplyAdvisorPlan()}
                    onUndo={handleUndoAutoConfig}
                    onDismissNote={() => setAdvisorStatusNote(null)}
                    onSelectNode={id => {
                      setSelectedNodeId(id);
                      if (isNarrowHw) setMobileNodePane('detail');
                    }}
                    pullProgress={pullProgress}
                    onPull={(nodeId, tag) => {
                      const node = nodes.find(n => n.id === nodeId);
                      if (node) handlePullModel(node, tag);
                    }}
                    nodeTypeById={nodeTypeById}
                  />
                }
              />
            )}

            {nodesSection === 'models' && (
              <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
                {currentNode ? (
                  <>
                    {nodes.length > 1 && (
                      <label className="flex items-center gap-2 text-[11px] text-zinc-400">
                        <span className="shrink-0">Models on</span>
                        <select
                          value={currentNode.id}
                          aria-label="Endpoint for installed models"
                          onChange={e => setSelectedNodeId(e.target.value)}
                          className="min-w-0 flex-1 bg-[#1c1c24] border border-[#2c2c38] text-zinc-100 rounded px-2.5 py-1 outline-none text-xs"
                        >
                          {nodes.map(n => (
                            <option key={n.id} value={n.id}>
                              {n.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <InstalledModelsPanel
                      currentNode={currentNode}
                      benchmarkingModel={benchmarkingModel}
                      benchmarkingNodeId={benchmarkingNodeId}
                      customPullTag={customPullTag}
                      onCustomPullTagChange={setCustomPullTag}
                      isPullingCustom={isPullingCustom}
                      customPullStatus={customPullStatus}
                      customPullPercent={customPullPercent}
                      onDirectPull={handleDirectPull}
                      onToggleModelEnabled={handleToggleModelEnabled}
                      onSetAllModelsEnabled={handleSetAllModelsEnabled}
                      onSetPrimaryModel={handleSetPrimaryModel}
                      onRunBenchmark={handleRunBenchmark}
                      onDeleteModel={handleDeleteModelFromNode}
                      onToggleThinking={handleToggleThinking}
                      onSetModelNumCtx={handleSetModelNumCtx}
                      onInspectModel={inspectModel}
                      inspectingModel={inspectingModel}
                    />
                  </>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center px-6 text-zinc-500">
                    <p className="text-sm font-semibold text-zinc-200">Add an endpoint first</p>
                    <p className="text-xs mt-2 max-w-sm">Installed models and benchmarks show up once a node is connected.</p>
                    <button
                      type="button"
                      onClick={() => {
                        setNodesSection('endpoints');
                        setShowAddNode(true);
                      }}
                      className="mt-4 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded-lg"
                    >
                      Add endpoint
                    </button>
                  </div>
                )}
              </div>
            )}

            {nodesSection === 'integrations' && (
              <IntegrationsPanel
                searxngUrl={searxngUrl}
                onUpdateSearxngUrl={onUpdateSearxngUrl}
                mcpServersJson={mcpServersJson}
                onUpdateMcpServersJson={onUpdateMcpServersJson}
              />
            )}
          </div>
        )}

        {activeTab === 'hub' &&
          (hubNode ? (
            <ModelHubPanel
              nodes={nodes}
              currentNode={hubNode}
              selectedNodeId={hubNode.id}
              onSelectNodeId={setSelectedNodeId}
              selectedTask={selectedTask}
              onSelectTask={setSelectedTask}
              estimateContext={estimateContext}
              onUpdateEstimateContext={onUpdateEstimateContext}
              pullProgress={pullProgress}
              onPullModel={handlePullModel}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-8 text-zinc-500">
              <p className="text-sm font-semibold text-zinc-200">Add a node first</p>
              <p className="text-xs mt-2">Model Hub needs at least one local Ollama endpoint to recommend pulls.</p>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('nodes');
                  setNodesSection('endpoints');
                  setShowAddNode(true);
                }}
                className="mt-4 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded-lg transition"
              >
                Add Node
              </button>
            </div>
          ))}

        {activeTab === 'appearance' && <AppearancePanel uiScale={uiScale} onUpdateUiScale={onUpdateUiScale} />}

        {activeTab === 'stats' && (
          <StatsPanel
            localTokens={localTokens}
            frontierTokens={frontierTokens}
            tokenStatsScope={tokenStatsScope}
            onTokenStatsScopeChange={onTokenStatsScopeChange}
            onResetTokenStats={onResetTokenStats}
            hasProject={hasProject}
            projectLabel={projectLabel}
          />
        )}

        {activeTab === 'remote' && (
          <RemotePanel
            webEnabled={webEnabled}
            webPort={webPort}
            webPassword={webPassword}
            webShowPassword={webShowPassword}
            webStatus={webStatus}
            webBusy={webBusy}
            webNote={webNote}
            webNoteTone={webNoteTone}
            lanEnabled={webLanEnabled}
            allowShell={webAllowShell}
            tlsCertPath={webTlsCert}
            tlsKeyPath={webTlsKey}
            onPortChange={setWebPort}
            onPasswordChange={setWebPassword}
            onToggleShowPassword={() => setWebShowPassword(v => !v)}
            onLanEnabledChange={enabled => {
              setWebLanEnabled(enabled);
              void applyWebConsole({ lanEnabled: enabled });
            }}
            onAllowShellChange={enabled => {
              setWebAllowShell(enabled);
              void applyWebConsole({ allowShell: enabled });
            }}
            onTlsCertChange={setWebTlsCert}
            onTlsKeyChange={setWebTlsKey}
            onApply={patch => void applyWebConsole(patch)}
            onRefresh={() => void refreshWebConsoleStatus()}
            onCopied={url => note(`Copied ${url}`, 'success')}
          />
        )}

        {activeTab === 'support' && <SupportPanel />}

        <AddNodeDialog
          open={showAddNode}
          name={newNodeName}
          url={newNodeUrl}
          nodeType={newNodeType}
          apiKey={newNodeApiKey}
          onName={setNewNodeName}
          onUrl={setNewNodeUrl}
          onType={setNewNodeType}
          onApiKey={setNewNodeApiKey}
          onClose={() => setShowAddNode(false)}
          onSubmit={handleAddNodeSubmit}
        />
        <NodesTransferDialog
          mode={nodesIOMode}
          passphrase={nodesIOPassphrase}
          confirm={nodesIOConfirm}
          mergeMode={nodesIOMergeMode}
          busy={nodesIOBusy}
          error={nodesIOError}
          onPassphrase={setNodesIOPassphrase}
          onConfirm={setNodesIOConfirm}
          onMergeMode={setNodesIOMergeMode}
          onClose={closeNodesIODialog}
          onSubmit={e => void handleNodesIOSubmit(e)}
        />
      </div>
    </div>
  );
};
