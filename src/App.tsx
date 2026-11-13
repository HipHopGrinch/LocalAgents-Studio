import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Header } from './components/Header';
import { FileTree } from './components/FileTree';
import { EditorView } from './components/EditorView';
import { GitPanel } from './components/GitPanel';
import { TerminalPanel } from './components/TerminalPanel';
import { AgentChat } from './components/AgentChat';
import { HardwareSettingsModal, type HardwareSettingsTab } from './components/HardwareSettingsModal';
import { CommandPalette } from './components/CommandPalette';
import { SplitHandle } from './components/ui/SplitHandle';
import { UpdateBanner } from './components/UpdateBanner';
import { ProjectPickerModal } from './components/ProjectPickerModal';
import { MessageSquare, FolderTree, Code2, Terminal as TerminalIcon, MoreHorizontal } from 'lucide-react';

import {
  EndpointNode,
  NodeConfig,
  WorkspaceFile,
  OpenTab,
  AppSettings,
  ChatConversation,
  ChatMessage,
  LiveStudioSession,
  LiveSessionNode,
  LiveConductorState
} from './types';
import { DEFAULT_SETTINGS, mergeSettings } from './config/defaults';
import { usePaneDrag } from './hooks/usePaneDrag';
import {
  EDITOR_DEFAULT,
  EDITOR_MIN,
  EXPLORER_DEFAULT,
  EXPLORER_MIN,
  PANE_RESET,
  resolveDesktopPaneLayout
} from './lib/paneLayout';
import { bumpFreeTierUsage } from './lib/freeTierAssist';
import { normalizeRoleRoutes, sameRoleRoutes } from './lib/roleRoutes';
import { settingsNodesFromLiveSnapshot } from './lib/settingsNodes';
import { normalizeClusterNodes } from './lib/tools';
import { clampWritePath } from './lib/writePath';
import { getLanguageFromPath } from './utils/language';
import {
  conversationsForWorkspace,
  createConversation,
  normalizeWorkspacePath,
  rememberWorkspace,
  replaceWorkspaceConversations,
  titleFromMessages,
  upsertConversation
} from './lib/conversations';
import { isWebConsoleClient } from './lib/hostApi';
import { stopUnfinishedConversation } from './lib/nodeWork';

/** Token totals mirrored from the desktop live session onto the web console. */
type SessionTokenMirror = {
  localTokensGenerated: number;
  frontierTokensUsed: number;
  tokenStatsScope?: 'global' | 'project';
  workspaceTokenUsage?: AppSettings['workspaceTokenUsage'];
};

function finiteToken(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Keep the previous mirror when a snapshot omits totals. Ignore web-originated snapshots. */
function mergeTokenMirror(
  prev: SessionTokenMirror | null,
  session: LiveStudioSession | null | undefined
): SessionTokenMirror | null {
  if (!session || session.source === 'web') return prev;
  const local = finiteToken(session.localTokensGenerated);
  const frontier = finiteToken(session.frontierTokensUsed);
  const scope =
    session.tokenStatsScope === 'project' || session.tokenStatsScope === 'global'
      ? session.tokenStatsScope
      : undefined;
  const hasUsage =
    !!session.workspaceTokenUsage &&
    typeof session.workspaceTokenUsage === 'object' &&
    !Array.isArray(session.workspaceTokenUsage);
  if (local == null && frontier == null && !scope && !hasUsage) return prev;
  return {
    localTokensGenerated: local != null ? local : prev?.localTokensGenerated ?? 0,
    frontierTokensUsed: frontier != null ? frontier : prev?.frontierTokensUsed ?? 0,
    tokenStatsScope: scope || prev?.tokenStatsScope,
    workspaceTokenUsage: hasUsage ? session.workspaceTokenUsage : prev?.workspaceTokenUsage
  };
}

/**
 * Web and seed snapshots must not put a disabled model back into service.
 * Desktop keeps its own disabledModels / activeModel and only borrows live status.
 */
function applySnapshotNodes(
  prev: EndpointNode[],
  incoming: LiveSessionNode[],
  keepLocalEnablement: boolean
): EndpointNode[] {
  const incomingById = new Map(incoming.map(n => [n.id, n]));
  if (keepLocalEnablement && prev.length > 0) {
    return prev.map(existing => {
      const n = incomingById.get(existing.id);
      if (!n) return existing;
      const hasLiveModels = Array.isArray(n.models) && n.models.length > 0;
      return {
        ...existing,
        online: typeof n.online === 'boolean' ? n.online : existing.online,
        latency: n.latency != null ? n.latency : existing.latency,
        models: hasLiveModels ? n.models! : existing.models,
        loaded: n.loaded?.length ? n.loaded : existing.loaded,
        error: n.error ?? existing.error,
        disabledModels: existing.disabledModels,
        activeModel: existing.activeModel
      };
    });
  }
  const prevById = new Map(prev.map(n => [n.id, n]));
  return incoming.map(n => {
    const existing = prevById.get(n.id);
    const { online: _o, latency: _l, models: _m, loaded: _ld, error: _e, ...cfg } = n;
    const hasLiveModels = Array.isArray(n.models) && n.models.length > 0;
    return {
      ...cfg,
      online: typeof n.online === 'boolean' ? n.online : existing?.online ?? false,
      latency: n.latency != null ? n.latency : existing?.latency ?? null,
      models: hasLiveModels ? n.models! : existing?.models ?? [],
      loaded: n.loaded?.length ? n.loaded : existing?.loaded ?? [],
      error: n.error ?? existing?.error,
      disabledModels: cfg.disabledModels,
      activeModel: cfg.activeModel
    } as EndpointNode;
  });
}

function RemoteHostBanner({ remoteLive }: { remoteLive: boolean }) {
  const [wsState, setWsState] = useState(window.__LA_WS_STATE__ || 'connecting');
  useEffect(() => {
    const onState = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail === 'string') setWsState(detail as typeof wsState);
    };
    window.addEventListener('la-ws-state', onState);
    return () => window.removeEventListener('la-ws-state', onState);
  }, []);
  const reconnecting = wsState === 'reconnecting' || wsState === 'disconnected';
  const label = reconnecting
    ? 'Reconnecting to Studio host…'
    : remoteLive
      ? 'Connected to Studio host — cluster status is live'
      : 'Connecting to Studio host…';
  return (
    <div
      className={`shrink-0 px-3 py-1 border-b text-[10px] flex items-center gap-2 ${
        reconnecting
          ? 'bg-amber-950/80 border-amber-500/30 text-amber-100'
          : 'bg-indigo-950/70 border-indigo-500/25 text-indigo-100/90'
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
          reconnecting
            ? 'bg-amber-400 animate-pulse'
            : remoteLive
              ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]'
              : 'bg-amber-400 animate-pulse'
        }`}
      />
      <span className="truncate">{label}</span>
    </div>
  );
}

const HARDWARE_TABS: readonly HardwareSettingsTab[] = [
  'nodes',
  'endpoints',
  'models',
  'integrations',
  'hub',
  'appearance',
  'stats',
  'remote',
  'support'
];

function isHardwareTab(tab: string | undefined): tab is HardwareSettingsTab {
  return !!tab && (HARDWARE_TABS as readonly string[]).includes(tab);
}

function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return !!target.closest('[contenteditable="true"], .monaco-editor, .xterm');
}

/** Resolve dot segments and unify separators so one file always has one tab path. */
function canonicalTabPath(p: string, sep: string): string {
  const raw = p.replace(/\\/g, '/');
  const parts: string[] = [];
  for (const seg of raw.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (parts.length && !/^[a-zA-Z]:$/.test(parts[parts.length - 1])) parts.pop();
      continue;
    }
    parts.push(seg);
  }
  const lead = raw.startsWith('//') ? '//' : raw.startsWith('/') ? '/' : '';
  return (lead + parts.join('/')).replace(/\//g, sep);
}

function tabPathKey(p: string): string {
  return canonicalTabPath(p, '/').toLowerCase();
}

function sameTabPath(a: string, b: string): boolean {
  return tabPathKey(a) === tabPathKey(b);
}

function isSameOrUnderPath(p: string, root: string): boolean {
  const key = tabPathKey(p);
  const rootKey = tabPathKey(root);
  return key === rootKey || key.startsWith(rootKey.replace(/\/+$/, '') + '/');
}

function pathSepFor(workspace: string): string {
  return workspace.includes('/') && !workspace.includes('\\') ? '/' : '\\';
}

export const App: React.FC = () => {
  const [workspacePath, setWorkspacePath] = useState<string>('');
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | undefined>(undefined);

  // Settings & Cluster
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [nodes, setNodes] = useState<EndpointNode[]>(() =>
    DEFAULT_SETTINGS.nodes.map(n => ({
      ...n,
      online: false,
      latency: null,
      models: [],
      loaded: []
    }))
  );
  const [selectedAgentId, setSelectedAgentId] = useState<string>(
    DEFAULT_SETTINGS.agents.find(a => a.handle === 'planner' || a.id === 'planner')?.id ||
      DEFAULT_SETTINGS.agents[0].id
  );
  const [activeConversationId, setActiveConversationId] = useState<string | undefined>(undefined);
  const loadedWorkspaceRef = useRef('');
  const forceNewChatRef = useRef(false);
  const [workspaceEpoch, setWorkspaceEpoch] = useState(0);
  const [canInstallDeps, setCanInstallDeps] = useState(false);
  const [installingDeps, setInstallingDeps] = useState(false);

  // Modals & Drawers
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [isHardwareModalOpen, setIsHardwareModalOpen] = useState(false);
  const [hardwareTab, setHardwareTab] = useState<HardwareSettingsTab | undefined>(undefined);
  const [paletteOpen, setPaletteOpen] = useState(false);
  /** True while AgentChat reports a running turn (existing onBusyChange). */
  const [agentBusy, setAgentBusy] = useState(false);
  /** Mobile / narrow web-console pane (desktop keeps the 3-column layout). */
  type MobilePane = 'chat' | 'files' | 'code' | 'term' | 'more';
  const [mobilePane, setMobilePane] = useState<MobilePane>('chat');
  const [isNarrow, setIsNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : false
  );

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const apply = () => setIsNarrow(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  // Preferred pane sizes. Window resizes clamp the render only — they do not write settings.
  const [explorerWidth, setExplorerWidth] = useState<number>(DEFAULT_SETTINGS.explorerWidth ?? EXPLORER_DEFAULT);
  const [editorWidth, setEditorWidth] = useState<number>(DEFAULT_SETTINGS.editorWidth ?? EDITOR_DEFAULT);
  const [editorHidden, setEditorHidden] = useState(DEFAULT_SETTINGS.editorHidden === true);
  const editorHiddenRef = useRef(editorHidden);
  editorHiddenRef.current = editorHidden;
  /** Shown conductor / node-work widths. The rail is never written back to settings. */
  const [shownControlWidth, setShownControlWidth] = useState<number | null>(null);
  const [shownNodeWidth, setShownNodeWidth] = useState<number | null>(null);
  const updateSettingsRef = useRef<(partial: Partial<AppSettings>) => void>(() => {});
  const [agentControlWidth, setAgentControlWidth] = useState<number>(
    DEFAULT_SETTINGS.agentControlWidth ?? 270
  );
  const [agentNodeWorkWidth, setAgentNodeWorkWidth] = useState<number>(
    DEFAULT_SETTINGS.agentNodeWorkWidth ?? 280
  );
  const [rowWidth, setRowWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1500));
  const [terminalResetNonce, setTerminalResetNonce] = useState(0);
  const layoutRowRef = useRef<HTMLDivElement>(null);
  const explorerPaneRef = useRef<HTMLDivElement>(null);
  const editorPaneRef = useRef<HTMLDivElement>(null);

  // UI & Text Scaling (Discord-style zoom factor: 0.75 to 2.0)
  const [uiScale, setUiScale] = useState<number>(DEFAULT_SETTINGS.uiScale || 1.0);
  const [appVersion, setAppVersion] = useState<string>('');
  const isRemoteClient = isWebConsoleClient();
  const sessionClientIdRef = useRef(
    `la-${isRemoteClient ? 'web' : 'desk'}-${Math.random().toString(36).slice(2, 10)}`
  );
  const sessionAppliedAtRef = useRef(0);
  const chatsRevisionRef = useRef(0);
  const workspacePathRef = useRef(workspacePath);
  workspacePathRef.current = workspacePath;
  /** Bumped whenever openWorkspace clears the tabs, so in-flight file reads can be dropped. */
  const tabsEpochRef = useRef(0);
  const activeTabPathRef = useRef<string | undefined>(undefined);
  const applyingRemoteRef = useRef(false);
  const publishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatsBumpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [projectPicker, setProjectPicker] = useState<{
    open: boolean;
    mode: 'open' | 'new';
  }>({ open: false, mode: 'open' });
  const [remoteLive, setRemoteLive] = useState(false);
  /** False until loadSettings finishes so the first publish cannot wipe seeded totals with zeros. */
  const [settingsReady, setSettingsReady] = useState(false);
  const settingsReadyRef = useRef(false);
  settingsReadyRef.current = settingsReady;
  /** Desktop token totals applied on the web console. Not written back into settings. */
  const [sessionTokens, setSessionTokens] = useState<SessionTokenMirror | null>(null);
  const [chatsTick, setChatsTick] = useState(0);
  const [peerConductor, setPeerConductor] = useState<LiveConductorState | null>(null);
  const [peerChatMirror, setPeerChatMirror] = useState<{
    conversationId: string;
    messages: ChatMessage[];
  } | null>(null);
  const localConductorRef = useRef<LiveConductorState | null>(null);
  const localChatMirrorRef = useRef<{
    conversationId: string;
    messages: ChatMessage[];
  } | null>(null);
  const [conductorTick, setConductorTick] = useState(0);

  /** Bump after local chat writes so every peer reloads from disk. */
  const markChatsSaved = useCallback(() => {
    if (chatsBumpTimerRef.current) clearTimeout(chatsBumpTimerRef.current);
    chatsBumpTimerRef.current = setTimeout(() => {
      chatsRevisionRef.current += 1;
      setChatsTick(t => t + 1);
    }, 120);
  }, []);

  const toLiveSessionNodes = useCallback((list: EndpointNode[]): LiveSessionNode[] => {
    return list.map(n => ({
      ...(n as NodeConfig & EndpointNode),
      online: !!n.online,
      latency: n.latency ?? null,
      models: n.models || [],
      loaded: n.loaded || [],
      error: n.error
    }));
  }, []);

  // Forward renderer crashes into studio.log so "Submit logs to GitHub" includes them.
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      void window.electronAPI?.writeLog?.(
        'error',
        `renderer: ${event.message}${event.filename ? ` @ ${event.filename}:${event.lineno}` : ''}`
      );
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const text =
        reason instanceof Error
          ? reason.stack || reason.message
          : typeof reason === 'string'
            ? reason
            : JSON.stringify(reason);
      void window.electronAPI?.writeLog?.('error', `renderer unhandledRejection: ${text}`);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  const applyLiveSession = useCallback((session: LiveStudioSession) => {
    if (!session || !session.updatedAt) return;
    // Ignore our own echo and stale snapshots.
    if (session.clientId && session.clientId === sessionClientIdRef.current) return;
    if (session.updatedAt <= sessionAppliedAtRef.current) return;
    sessionAppliedAtRef.current = session.updatedAt;
    applyingRemoteRef.current = true;
    window.setTimeout(() => {
      applyingRemoteRef.current = false;
    }, 1200);

    // Desktop enablement wins over a web console mirror. Seed may refresh status only.
    if (Array.isArray(session.nodes) && session.nodes.length > 0) {
      const trustIncomingConfig = isRemoteClient || session.source === 'desktop';
      if (!isRemoteClient && session.source === 'web') {
        // Ignore. A web publish can carry the previous desktop node list and would
        // turn a model back on or mark an offline node online.
      } else if (trustIncomingConfig) {
        // Live session strips apiKeys. Keep the saved key and drop runtime fields.
        setSettings(prev => ({
          ...prev,
          nodes: settingsNodesFromLiveSnapshot(prev.nodes, session.nodes)
        }));
        setNodes(prev => applySnapshotNodes(prev, session.nodes, false));
      } else if (session.source === 'seed') {
        setNodes(prev => applySnapshotNodes(prev, session.nodes, !isRemoteClient));
      }
    }

    if (session.selectedAgentId) setSelectedAgentId(session.selectedAgentId);
    if (session.activeConversationId !== undefined) {
      setActiveConversationId(session.activeConversationId || undefined);
    }

    const nextWs = session.workspacePath || '';
    const wsChanged =
      !!nextWs &&
      normalizeWorkspacePath(nextWs) !== normalizeWorkspacePath(workspacePathRef.current || '');
    const chatsBumped =
      typeof session.chatsRevision === 'number' && session.chatsRevision > chatsRevisionRef.current;

    if (typeof session.chatsRevision === 'number') {
      chatsRevisionRef.current = Math.max(chatsRevisionRef.current, session.chatsRevision);
    }

    if (wsChanged) {
      forceNewChatRef.current = false;
      loadedWorkspaceRef.current = '';
      setWorkspaceEpoch(n => n + 1);
      // Same as the normal folder switch: the old folder's tabs go, and a file read still in
      // flight for the old folder must not add a tab afterwards.
      tabsEpochRef.current += 1;
      openTabsSnapshotRef.current = [];
      activeTabPathRef.current = undefined;
      setOpenTabs([]);
      setActiveTabPath(undefined);
      workspacePathRef.current = nextWs;
      setWorkspacePath(nextWs);
      void window.electronAPI?.readDir(nextWs).then(result => {
        if (normalizeWorkspacePath(nextWs) !== normalizeWorkspacePath(workspacePathRef.current || '')) return;
        setFiles(Array.isArray(result) ? result : []);
      });
    } else if (chatsBumped && nextWs) {
      // Same folder — reload chats from disk after a peer saved.
      forceNewChatRef.current = false;
      loadedWorkspaceRef.current = '';
      setWorkspaceEpoch(n => n + 1);
    }

    const nextTab =
      typeof session.activeTabPath === 'string' && session.activeTabPath
        ? session.activeTabPath
        : '';
    const nextTabTarget = nextTab
      ? canonicalTabPath(nextTab, pathSepFor(nextWs || workspacePathRef.current || ''))
      : '';
    if (
      nextTab &&
      (!activeTabPathRef.current || !sameTabPath(nextTabTarget, activeTabPathRef.current))
    ) {
      if (editorHiddenRef.current) {
        editorHiddenRef.current = false;
        setEditorHidden(false);
        // A web client's settings copy can be stale; saving it would overwrite the desktop's file.
        if (!isRemoteClient) updateSettingsRef.current({ editorHidden: false });
      }
      void (async () => {
        if (!window.electronAPI) return;
        const existingTab = openTabsSnapshotRef.current.find(t => sameTabPath(t.path, nextTabTarget));
        if (existingTab) {
          setActiveTabPath(existingTab.path);
          return;
        }
        const epochAtStart = tabsEpochRef.current;
        const wsAtStart = normalizeWorkspacePath(workspacePathRef.current || '');
        const res = await window.electronAPI.readFile(nextTabTarget);
        // A folder switch while the read was in flight: this file belongs to the old folder.
        if (
          tabsEpochRef.current !== epochAtStart ||
          normalizeWorkspacePath(workspacePathRef.current || '') !== wsAtStart
        ) {
          return;
        }
        if (res.content !== undefined) {
          const fileName = nextTabTarget.split(/[\\/]/).pop() || 'Untitled';
          setOpenTabs(prev => {
            if (prev.some(t => sameTabPath(t.path, nextTabTarget))) return prev;
            return [
              ...prev,
              {
                path: nextTabTarget,
                name: fileName,
                content: res.content!,
                originalContent: res.content!,
                isDirty: false,
                language: getLanguageFromPath(nextTabTarget)
              }
            ];
          });
        }
        setActiveTabPath(nextTabTarget);
      })();
    }

    if (session.conductor) {
      let conductor = session.conductor;
      const webSnapshot = !isRemoteClient && session.source === 'web';
      if (webSnapshot) {
        // Desktop owns roleRoutes. A web picker edit is the only snapshot that may change them.
        const roleRoutesEditOk =
          !!conductor.roleRoutes &&
          typeof conductor.roleRoutes === 'object' &&
          !Array.isArray(conductor.roleRoutes);
        if (conductor.roleRoutesEdit && roleRoutesEditOk && settingsReadyRef.current) {
          updateSettingsRef.current({ roleRoutes: normalizeRoleRoutes(conductor.roleRoutes) });
        }
        const { roleRoutes: _routes, roleRoutesEdit: _edit, ...rest } = conductor;
        conductor = rest;
      } else if (isRemoteClient && conductor.roleRoutes) {
        const incoming = normalizeRoleRoutes(conductor.roleRoutes);
        setSettings(prev =>
          sameRoleRoutes(prev.roleRoutes, incoming) ? prev : { ...prev, roleRoutes: incoming }
        );
        if (conductor.roleRoutesEdit) {
          const { roleRoutesEdit: _edit, ...rest } = conductor;
          conductor = rest;
        }
      }
      setPeerConductor(conductor);
    }
    if (session.chatMirror !== undefined) {
      setPeerChatMirror(session.chatMirror || null);
    }
    if (isRemoteClient) {
      setSessionTokens(prev => mergeTokenMirror(prev, session));
    }
  }, [isRemoteClient]);

  const openTabsSnapshotRef = useRef<OpenTab[]>([]);
  openTabsSnapshotRef.current = openTabs;
  activeTabPathRef.current = activeTabPath;

  // 1. Initial Load: Settings & Workspace (+ attach to live desktop session for web console)
  useEffect(() => {
    async function init() {
      if (!window.electronAPI) return;

      try {
        const ver = await window.electronAPI.getAppVersion?.();
        if (ver) {
          setAppVersion(ver);
          document.title = isRemoteClient
            ? `LocalAgents Remote ${ver}`
            : `LocalAgents Studio ${ver}`;
        }
      } catch {
        /* ignore */
      }

      const saved = await window.electronAPI.loadSettings();
      const merged = mergeSettings(saved);
      let live: LiveStudioSession | null = null;
      try {
        live = (await window.electronAPI.getLiveSession?.()) || null;
      } catch {
        live = null;
      }

      // Remote clients follow the desktop cluster. The desktop keeps saved enablement
      // unless another desktop window published a newer node list.
      if (live && Array.isArray(live.nodes) && live.nodes.length > 0) {
        const trustLiveConfig = isRemoteClient || live.source === 'desktop';
        if (trustLiveConfig && (!merged.nodes.length || (live.updatedAt && live.nodes.length >= merged.nodes.length))) {
          merged.nodes = settingsNodesFromLiveSnapshot(merged.nodes, live.nodes);
        }
      }

      const sortedChats = [...(merged.conversations || [])].sort((a, b) => a.updatedAt - b.updatedAt);
      let recent = merged.recentWorkspaces || [];
      for (const chat of sortedChats) {
        if (chat.workspacePath) recent = rememberWorkspace(recent, chat.workspacePath);
      }
      merged.recentWorkspaces = recent;
      // The project-chat loader can finish before loadSettings does. Its chats live only in
      // state (prev is still DEFAULT_SETTINGS), so keep them instead of replacing them with
      // the copy read from disk. settingsReadyRef semantics stay as they are.
      const earlyWs = workspacePathRef.current || '';
      const chatsLoadedEarly =
        !!earlyWs && loadedWorkspaceRef.current === normalizeWorkspacePath(earlyWs);
      setSettings(prev => {
        if (!chatsLoadedEarly) return merged;
        const early = conversationsForWorkspace(prev.conversations, earlyWs);
        if (!early.length) return merged;
        return {
          ...merged,
          conversations: replaceWorkspaceConversations(merged.conversations, earlyWs, early),
          activeConversationId: prev.activeConversationId ?? merged.activeConversationId,
          lastWorkspace: prev.lastWorkspace || merged.lastWorkspace,
          recentWorkspaces: rememberWorkspace(merged.recentWorkspaces, earlyWs)
        };
      });
      setSettingsReady(true);
      if (isRemoteClient && live) {
        setSessionTokens(prev => mergeTokenMirror(prev, live));
      }
      // chatWidth stays on the merged settings object (legacy). Sizing uses editorWidth.
      setExplorerWidth(merged.explorerWidth ?? EXPLORER_DEFAULT);
      setEditorWidth(merged.editorWidth ?? EDITOR_DEFAULT);
      setEditorHidden(merged.editorHidden === true);
      setAgentControlWidth(merged.agentControlWidth ?? 270);
      setAgentNodeWorkWidth(merged.agentNodeWorkWidth ?? 280);

      const initialActive =
        (live && live.activeConversationId) || merged.activeConversationId || undefined;
      if (initialActive) setActiveConversationId(cur => cur ?? initialActive);
      if (live?.selectedAgentId) setSelectedAgentId(live.selectedAgentId);

      const initialScale = merged.uiScale || 1.0;
      setUiScale(initialScale);
      if (window.electronAPI.setZoomFactor) {
        window.electronAPI.setZoomFactor(initialScale);
      }
      document.documentElement.style.setProperty('--app-scale', String(initialScale));

      if (live && Array.isArray(live.nodes) && live.nodes.length > 0 && live.nodes.some(n => n.online != null)) {
        const keepSavedEnablement = !isRemoteClient && live.source !== 'desktop';
        const base = merged.nodes.map(n => ({
          ...n,
          online: false,
          latency: null,
          models: [] as EndpointNode['models'],
          loaded: [] as EndpointNode['loaded']
        }));
        setNodes(applySnapshotNodes(base, live.nodes, keepSavedEnablement));
      } else {
        setNodes(
          merged.nodes.map(n => ({
            ...n,
            online: false,
            latency: null,
            models: [],
            loaded: []
          }))
        );
      }

      const defaultPath =
        (live && live.workspacePath) ||
        merged.lastWorkspace ||
        (await window.electronAPI.getDefaultWorkspace());
      if (live?.updatedAt) sessionAppliedAtRef.current = live.updatedAt;
      if (typeof live?.chatsRevision === 'number') chatsRevisionRef.current = live.chatsRevision;
      workspacePathRef.current = defaultPath;
      setWorkspacePath(defaultPath);
      loadDirectory(defaultPath);
      if (isRemoteClient) setRemoteLive(true);
    }
    init().catch(err => {
      console.error('init failed', err);
      void window.electronAPI?.writeLog?.(
        'error',
        `init failed: ${err instanceof Error ? err.message : String(err)}`
      );
    });
  }, [isRemoteClient]);

  // Both desktop and web consoles follow the shared live session (skip own echoes in apply).
  useEffect(() => {
    if (!window.electronAPI) return;

    let cancelled = false;
    const markHostUp = () => {
      if (!cancelled && isRemoteClient) setRemoteLive(true);
    };

    if (isRemoteClient) {
      void window.electronAPI
        .loadSettings()
        .then(() => markHostUp())
        .catch(() => {});
    }

    const unsub = window.electronAPI.onLiveSession?.(session => {
      markHostUp();
      applyLiveSession(session);
    });

    // Desktop already receives push events; only remote web clients need a poll fallback.
    let poll: number | undefined;
    if (isRemoteClient) {
      poll = window.setInterval(() => {
        void window.electronAPI.getLiveSession?.().then(s => {
          markHostUp();
          if (s && s.updatedAt > 0) applyLiveSession(s);
        });
      }, 750);
    } else {
      // One seed read in case the push subscription races startup.
      void window.electronAPI.getLiveSession?.().then(s => {
        if (!cancelled && s && s.updatedAt > 0) applyLiveSession(s);
      });
    }

    return () => {
      cancelled = true;
      unsub?.();
      if (poll) window.clearInterval(poll);
    };
  }, [isRemoteClient, applyLiveSession]);

  // Every surface publishes so peers mirror workspace / chat / tab focus.
  useEffect(() => {
    if (!window.electronAPI?.publishLiveSession) return;
    if (applyingRemoteRef.current) return;
    if (publishTimerRef.current) clearTimeout(publishTimerRef.current);
    publishTimerRef.current = setTimeout(() => {
      if (applyingRemoteRef.current) return;
      const tokenMirror =
        !isRemoteClient && settingsReady
          ? {
              localTokensGenerated: settings.localTokensGenerated || 0,
              frontierTokensUsed: settings.frontierTokensUsed || 0,
              tokenStatsScope: settings.tokenStatsScope === 'project' ? 'project' : 'global',
              workspaceTokenUsage: settings.workspaceTokenUsage || {}
            }
          : {};
      void window.electronAPI.publishLiveSession?.({
        workspacePath,
        activeConversationId: activeConversationId || null,
        selectedAgentId,
        // Desktop owns cluster status; remotes omit nodes so they do not clobber it.
        nodes: isRemoteClient ? undefined : toLiveSessionNodes(nodes),
        chatsRevision: chatsRevisionRef.current,
        activeTabPath: activeTabPath || null,
        openTabPaths: openTabs.map(t => t.path),
        conductor: localConductorRef.current,
        chatMirror: localChatMirrorRef.current,
        // Desktop owns token totals. Web clients omit them so a zero snapshot cannot wipe the mirror.
        ...tokenMirror,
        source: isRemoteClient ? 'web' : 'desktop',
        clientId: sessionClientIdRef.current
      } as Partial<LiveStudioSession>);
    }, 100);
    return () => {
      if (publishTimerRef.current) clearTimeout(publishTimerRef.current);
    };
  }, [
    isRemoteClient,
    settingsReady,
    settings.localTokensGenerated,
    settings.frontierTokensUsed,
    settings.tokenStatsScope,
    settings.workspaceTokenUsage,
    workspacePath,
    activeConversationId,
    selectedAgentId,
    nodes,
    toLiveSessionNodes,
    chatsTick,
    activeTabPath,
    openTabs,
    conductorTick
  ]);

  const handleLiveConductorPublish = useCallback(
    (payload: {
      conductor: LiveConductorState;
      chatMirror: { conversationId: string; messages: ChatMessage[] } | null;
    }) => {
      let conductor = payload.conductor;
      if (!settingsReadyRef.current) {
        const { roleRoutes: _routes, roleRoutesEdit: _edit, ...rest } = conductor;
        conductor = rest;
      }
      localConductorRef.current = conductor;
      localChatMirrorRef.current = payload.chatMirror;
      setConductorTick(t => t + 1);
    },
    []
  );

  // Persist Settings whenever modified
  const updateSettings = useCallback((partial: Partial<AppSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...partial };
      if (window.electronAPI) {
        if (!settingsReadyRef.current) {
          const { roleRoutes: _omit, ...rest } = next;
          window.electronAPI.saveSettings(rest);
        } else {
          window.electronAPI.saveSettings(next);
        }
      }
      return next;
    });
  }, []);
  updateSettingsRef.current = updateSettings;

  const handleUpdateUiScale = useCallback((scale: number) => {
    const clamped = Math.max(0.75, Math.min(2.0, Math.round(scale * 100) / 100));
    setUiScale(clamped);
    if (window.electronAPI?.setZoomFactor) {
      window.electronAPI.setZoomFactor(clamped);
    }
    document.documentElement.style.setProperty('--app-scale', String(clamped));
    updateSettings({ uiScale: clamped });
  }, [updateSettings]);

  // Ctrl+K command palette. Ctrl +/-/0 zoom is ignored while typing or in Monaco / the terminal.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (e.key.toLowerCase() === 'k' && !e.shiftKey) {
        if (e.repeat) return;
        e.preventDefault();
        setPaletteOpen(open => !open);
        return;
      }
      const zoomIn = e.key === '=' || e.key === '+' || e.code === 'NumpadAdd';
      const zoomOut = e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract';
      const zoomReset = (e.key === '0' || e.code === 'Numpad0') && !e.shiftKey;
      if (!zoomIn && !zoomOut && !zoomReset) return;
      e.preventDefault();
      if (isTextEditingTarget(e.target)) return;
      if (zoomIn) handleUpdateUiScale(uiScale + 0.05);
      else if (zoomOut) handleUpdateUiScale(uiScale - 0.05);
      else handleUpdateUiScale(1.0);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [uiScale, handleUpdateUiScale]);

  const workspaceConversations = useMemo(
    () => conversationsForWorkspace(settings.conversations, workspacePath),
    [settings.conversations, workspacePath]
  );

  const activeConversation: ChatConversation | null = useMemo(() => {
    if (!activeConversationId) return null;
    return (settings.conversations || []).find(c => c.id === activeConversationId) || null;
  }, [settings.conversations, activeConversationId]);

  // Load this project's chats from the folder (migrate older global history once).
  useEffect(() => {
    if (!workspacePath || !window.electronAPI?.loadProjectChats) return;
    const key = normalizeWorkspacePath(workspacePath);
    if (loadedWorkspaceRef.current === key) return;
    loadedWorkspaceRef.current = key;
    const wantNewChat = forceNewChatRef.current;
    forceNewChatRef.current = false;

    let cancelled = false;
    (async () => {
      const loaded = await window.electronAPI.loadProjectChats(workspacePath);
      if (cancelled) return;
      setSettings(prev => {
        const fromDisk = (loaded.conversations || []).map(c => ({
          ...c,
          workspacePath
        }));
        const fromSettings = conversationsForWorkspace(prev.conversations, workspacePath);
        // A freshly opened project has no live run; work saved mid-run reads as stopped (web clients mirror as-is).
        let forWs = (fromDisk.length ? fromDisk : fromSettings).map(c =>
          isWebConsoleClient() ? c : stopUnfinishedConversation(c)
        );
        let active = loaded.activeConversationId || undefined;
        if (wantNewChat) {
          const fresh = createConversation(workspacePath, selectedAgentId);
          forWs = [fresh, ...forWs];
          active = fresh.id;
        } else if (!forWs.some(c => c.id === active)) {
          if (!forWs.length) {
            const fresh = createConversation(workspacePath, selectedAgentId);
            forWs = [fresh];
            active = fresh.id;
          } else {
            active = forWs[0].id;
          }
        }
        setActiveConversationId(active);
        const conversations = replaceWorkspaceConversations(prev.conversations, workspacePath, forWs);
        const next = {
          ...prev,
          lastWorkspace: workspacePath,
          recentWorkspaces: rememberWorkspace(prev.recentWorkspaces, workspacePath),
          conversations,
          activeConversationId: active
        };
        if (settingsReadyRef.current) window.electronAPI.saveSettings(next);
        window.electronAPI.saveProjectChats(workspacePath, {
          conversations: conversationsForWorkspace(conversations, workspacePath),
          activeConversationId: active
        });
        // Do not markChatsSaved here — reloading from a peer would bump revision forever.
        return next;
      });
    })();
    return () => {
      cancelled = true;
      if (loadedWorkspaceRef.current === key) loadedWorkspaceRef.current = '';
    };
  }, [workspacePath, workspaceEpoch, selectedAgentId]);

  // Track the desktop row so maximize / restore reclamps without saving the clamped size.
  useEffect(() => {
    if (isNarrow) return;
    const el = layoutRowRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const publish = () => setRowWidth(el.clientWidth);
    const obs = new ResizeObserver(publish);
    obs.observe(el);
    publish();
    return () => obs.disconnect();
  }, [isNarrow]);

  const paneLayout = useMemo(
    () =>
      resolveDesktopPaneLayout(rowWidth, {
        explorerWidth,
        editorWidth,
        controlWidth: shownControlWidth ?? agentControlWidth,
        nodeWorkWidth: shownNodeWidth ?? agentNodeWorkWidth,
        editorHidden
      }),
    [
      rowWidth,
      explorerWidth,
      editorWidth,
      shownControlWidth,
      shownNodeWidth,
      agentControlWidth,
      agentNodeWorkWidth,
      editorHidden
    ]
  );
  const paneLayoutRef = useRef(paneLayout);
  paneLayoutRef.current = paneLayout;
  const explorerWidthRef = useRef(explorerWidth);
  explorerWidthRef.current = explorerWidth;
  const editorWidthRef = useRef(editorWidth);
  editorWidthRef.current = editorWidth;

  const commitExplorerWidth = useCallback(
    (next: number) => {
      setExplorerWidth(next);
      updateSettings({ explorerWidth: next });
    },
    [updateSettings]
  );
  const commitEditorWidth = useCallback(
    (next: number) => {
      setEditorWidth(next);
      updateSettings({ editorWidth: next });
    },
    [updateSettings]
  );

  const explorerDrag = usePaneDrag({
    axis: 'x',
    valueSide: 'before',
    getMin: () => Math.min(EXPLORER_MIN, paneLayoutRef.current.explorer),
    getMax: () => Math.max(paneLayoutRef.current.explorer, paneLayoutRef.current.explorerMax),
    getValue: () => explorerWidthRef.current,
    getPane: () => explorerPaneRef.current,
    onPreview: next => {
      explorerWidthRef.current = next;
      setExplorerWidth(next);
    },
    onCommit: commitExplorerWidth
  });
  const editorDrag = usePaneDrag({
    axis: 'x',
    valueSide: 'before',
    disabled: editorHidden,
    getMin: () => Math.min(EDITOR_MIN, paneLayoutRef.current.editor),
    getMax: () => Math.max(paneLayoutRef.current.editor, paneLayoutRef.current.editorMax),
    getValue: () => editorWidthRef.current,
    getPane: () => editorPaneRef.current,
    onPreview: next => {
      editorWidthRef.current = next;
      setEditorWidth(next);
    },
    onCommit: commitEditorWidth
  });

  const resetPaneSizes = useCallback(() => {
    setExplorerWidth(PANE_RESET.explorerWidth);
    setEditorWidth(PANE_RESET.editorWidth);
    setAgentControlWidth(PANE_RESET.agentControlWidth);
    setAgentNodeWorkWidth(PANE_RESET.agentNodeWorkWidth);
    updateSettings({
      explorerWidth: PANE_RESET.explorerWidth,
      editorWidth: PANE_RESET.editorWidth,
      agentControlWidth: PANE_RESET.agentControlWidth,
      agentNodeWorkWidth: PANE_RESET.agentNodeWorkWidth
    });
    setTerminalResetNonce(n => n + 1);
  }, [updateSettings]);

  const toggleCodeEditor = useCallback(() => {
    const next = !editorHiddenRef.current;
    editorHiddenRef.current = next;
    setEditorHidden(next);
    updateSettings({ editorHidden: next });
  }, [updateSettings]);

  // 3. Cluster Polling — preserve user toggles/benchmarks; only merge live status fields
  const nodesRef = React.useRef(nodes);
  nodesRef.current = nodes;

  const refreshNodes = useCallback(async (opts?: { force?: boolean }) => {
    if (!window.electronAPI) return;
    const endpointsToPing = nodesRef.current.map(n => ({
      id: n.id,
      url: n.url,
      type: n.type,
      apiKey: n.apiKey
    }));

    try {
      const results = await window.electronAPI.clusterStatus(
        endpointsToPing,
        opts?.force ? { force: true } : undefined
      );
      setNodes(prev =>
        prev.map(n => {
          const res = results[n.id];
          if (res) {
            const meta = n.modelMeta || {};
            const models = (res.models || []).map(m => {
              const cached = meta[m.name];
              return {
                ...m,
                capabilities: m.capabilities || cached?.capabilities,
                description: cached?.description,
                thinking: cached?.thinking
              };
            });
            return {
              ...n,
              online: res.online,
              latency: res.latency,
              models,
              loaded: res.loaded || [],
              error: res.error,
              // A status poll reports installed tags. It must not clear a disable the user just saved.
              disabledModels: n.disabledModels,
              activeModel: n.activeModel,
              modelPrefs: n.modelPrefs,
              benchmarks: n.benchmarks,
              modelMeta: n.modelMeta,
              roles: n.roles
            };
          }
          return n;
        })
      );
    } catch (err) {
      console.error('Error pinging cluster nodes:', err);
    }
  }, []);

  useEffect(() => {
    // Web clients share one main-process cache and poll less often. A running turn
    // slows /api/ps further so prefilling GPUs are not probed every 15s.
    // Skip the immediate ping when a turn just became busy.
    if (!agentBusy) void refreshNodes();
    const baseSec = settings.pollIntervalSec || 15;
    const sec = agentBusy ? Math.max(baseSec, 60) : isRemoteClient ? Math.max(baseSec, 30) : baseSec;
    const interval = window.setInterval(() => {
      void refreshNodes();
    }, sec * 1000);
    return () => window.clearInterval(interval);
  }, [settings.pollIntervalSec, refreshNodes, agentBusy, isRemoteClient]);

  // 4. File Tree
  const loadDirectory = async (dirPath: string) => {
    if (!window.electronAPI) return;
    const result = await window.electronAPI.readDir(dirPath);
    if (normalizeWorkspacePath(dirPath) !== normalizeWorkspacePath(workspacePathRef.current || '')) return;
    setFiles(Array.isArray(result) ? result : []);
  };

  const openWorkspace = (chosen: string, opts?: { newChat?: boolean }) => {
    if (!chosen) return;
    forceNewChatRef.current = !!opts?.newChat;
    loadedWorkspaceRef.current = '';
    setWorkspaceEpoch(n => n + 1);
    tabsEpochRef.current += 1;
    setOpenTabs([]);
    setActiveTabPath(undefined);
    workspacePathRef.current = chosen;
    setWorkspacePath(chosen);
    loadDirectory(chosen);
  };

  const handleSelectFolder = async () => {
    if (!window.electronAPI) return;
    if (isRemoteClient) {
      setProjectPicker({ open: true, mode: 'open' });
      return;
    }
    const chosen = await window.electronAPI.selectFolder();
    if (!chosen) return;
    openWorkspace(chosen);
  };

  /** Open a folder and start a new chat, keeping older chats for that project. */
  const handleNewProject = async () => {
    if (!window.electronAPI) return;
    if (isRemoteClient) {
      setProjectPicker({ open: true, mode: 'new' });
      return;
    }
    const chosen = await window.electronAPI.selectFolder();
    if (!chosen) return;
    openWorkspace(chosen, { newChat: true });
  };

  const handleOpenRecent = (chosen: string) => {
    if (!chosen) return;
    openWorkspace(chosen);
  };

  /** New Chat adds a thread. Project brain and older chats stay. */
  const handleNewChat = () => {
    const fresh = createConversation(workspacePath, selectedAgentId);
    setActiveConversationId(fresh.id);
    setSettings(prev => {
      const existing = conversationsForWorkspace(prev.conversations, workspacePath);
      const conversations = replaceWorkspaceConversations(prev.conversations, workspacePath, [
        fresh,
        ...existing
      ]);
      const next = {
        ...prev,
        conversations,
        activeConversationId: fresh.id
      };
      if (window.electronAPI) {
        window.electronAPI.saveSettings(next);
        if (workspacePath) {
          window.electronAPI.saveProjectChats(workspacePath, {
            conversations: conversationsForWorkspace(conversations, workspacePath),
            activeConversationId: fresh.id
          });
          markChatsSaved();
        }
      }
      return next;
    });
  };

  /** Explicit wipe of chat threads. Project files and project.json stay. */
  const handleClearProjectChats = () => {
    const fresh = createConversation(workspacePath, selectedAgentId);
    setActiveConversationId(fresh.id);
    setSettings(prev => {
      const conversations = replaceWorkspaceConversations(prev.conversations, workspacePath, [
        fresh
      ]);
      const next = { ...prev, conversations, activeConversationId: fresh.id };
      if (window.electronAPI) {
        window.electronAPI.saveSettings(next);
        if (workspacePath) {
          window.electronAPI.saveProjectChats(workspacePath, {
            conversations: [fresh],
            activeConversationId: fresh.id
          });
          markChatsSaved();
        }
      }
      return next;
    });
  };

  const handleSelectConversation = (id: string) => {
    setActiveConversationId(id);
    setSettings(prev => {
      const next = { ...prev, activeConversationId: id };
      if (window.electronAPI) {
        window.electronAPI.saveSettings(next);
        if (workspacePath) {
          window.electronAPI.saveProjectChats(workspacePath, {
            conversations: conversationsForWorkspace(next.conversations, workspacePath),
            activeConversationId: id
          });
          markChatsSaved();
        }
      }
      return next;
    });
    const conv = (settings.conversations || []).find(c => c.id === id);
    if (conv?.agentId) setSelectedAgentId(conv.agentId);
  };

  const handleDeleteConversation = (id: string) => {
    setSettings(prev => {
      const remaining = (prev.conversations || []).filter(c => c.id !== id);
      let nextActive = prev.activeConversationId;
      if (id === activeConversationId) {
        const forWs = conversationsForWorkspace(remaining, workspacePath);
        if (forWs[0]) {
          nextActive = forWs[0].id;
        } else {
          const fresh = createConversation(workspacePath, selectedAgentId);
          remaining.unshift(fresh);
          nextActive = fresh.id;
        }
        setActiveConversationId(nextActive);
      }
      const next = {
        ...prev,
        conversations: remaining,
        activeConversationId: nextActive
      };
      if (window.electronAPI) {
        window.electronAPI.saveSettings(next);
        if (workspacePath) {
          window.electronAPI.saveProjectChats(workspacePath, {
            conversations: conversationsForWorkspace(remaining, workspacePath),
            activeConversationId: nextActive
          });
          markChatsSaved();
        }
      }
      return next;
    });
  };

  const handleMessagesChange = (messages: ChatMessage[]) => {
    if (!activeConversationId) return;
    setSettings(prev => {
      const existing = (prev.conversations || []).find(c => c.id === activeConversationId);
      if (!existing) return prev;
      // Avoid noop writes when switching threads loads the same snapshot
      if (
        existing.messages.length === messages.length &&
        existing.messages[existing.messages.length - 1]?.id === messages[messages.length - 1]?.id &&
        existing.messages[existing.messages.length - 1]?.raw === messages[messages.length - 1]?.raw &&
        existing.messages.every(
          (m, i) =>
            m.id === messages[i]?.id &&
            m.display === messages[i]?.display &&
            m.pipelineSteps === messages[i]?.pipelineSteps &&
            m.reviewPlan === messages[i]?.reviewPlan &&
            m.selectedPlanOptionId === messages[i]?.selectedPlanOptionId &&
            m.chosenPlanOptionId === messages[i]?.chosenPlanOptionId
        )
      ) {
        return prev;
      }
      const updated: ChatConversation = {
        ...existing,
        messages,
        title: titleFromMessages(messages),
        agentId: selectedAgentId,
        workspacePath,
        updatedAt: Date.now()
      };
      const next = {
        ...prev,
        conversations: upsertConversation(prev.conversations, updated)
      };
      if (window.electronAPI) {
        window.electronAPI.saveSettings(next);
        if (workspacePath) {
          window.electronAPI.saveProjectChats(workspacePath, {
            conversations: conversationsForWorkspace(next.conversations, workspacePath),
            activeConversationId
          });
          markChatsSaved();
        }
      }
      return next;
    });
  };

  /** Persist approved plan / agent switch without rewriting the full message list. */
  const handleConversationPatch = (
    patch: Partial<
      Pick<ChatConversation, 'approvedPlan' | 'executionQueue' | 'plannerPlan' | 'agentId'>
    >
  ) => {
    if (!activeConversationId) return;
    if (patch.agentId) setSelectedAgentId(patch.agentId);
    setSettings(prev => {
      const existing = (prev.conversations || []).find(c => c.id === activeConversationId);
      if (!existing) return prev;
      const updated: ChatConversation = {
        ...existing,
        ...patch,
        updatedAt: Date.now()
      };
      const next = {
        ...prev,
        conversations: upsertConversation(prev.conversations, updated)
      };
      if (window.electronAPI) {
        window.electronAPI.saveSettings(next);
        if (workspacePath) {
          window.electronAPI.saveProjectChats(workspacePath, {
            conversations: conversationsForWorkspace(next.conversations, workspacePath),
            activeConversationId
          });
          markChatsSaved();
        }
      }
      return next;
    });
  };

  // 5. Editor Tabs
  const handleFileSelect = async (filePath: string) => {
    if (editorHidden) {
      setEditorHidden(false);
      updateSettings({ editorHidden: false });
    }
    const target = canonicalTabPath(filePath, pathSepFor(workspacePathRef.current || workspacePath));
    const existing = openTabsSnapshotRef.current.find(t => sameTabPath(t.path, target));
    if (existing) {
      setActiveTabPath(existing.path);
      return;
    }

    if (!window.electronAPI) return;
    const wsAtStart = normalizeWorkspacePath(workspacePathRef.current || '');
    const epochAtStart = tabsEpochRef.current;
    const res = await window.electronAPI.readFile(target);
    if (
      tabsEpochRef.current !== epochAtStart ||
      normalizeWorkspacePath(workspacePathRef.current || '') !== wsAtStart
    ) {
      return;
    }
    if (res.content !== undefined) {
      const fileName = target.split(/[\\/]/).pop() || 'Untitled';
      const newTab: OpenTab = {
        path: target,
        name: fileName,
        content: res.content,
        originalContent: res.content,
        isDirty: false,
        language: getLanguageFromPath(target)
      };
      setOpenTabs(prev => (prev.some(t => sameTabPath(t.path, target)) ? prev : [...prev, newTab]));
      setActiveTabPath(target);
    }
  };

  const handleCloseTab = (path: string) => {
    setOpenTabs(prev => {
      const filtered = prev.filter(t => t.path !== path);
      if (activeTabPath === path) {
        const nextActive = filtered.length > 0 ? filtered[filtered.length - 1].path : undefined;
        setActiveTabPath(nextActive);
      }
      return filtered;
    });
  };

  const handleCursorLine = useCallback((path: string, line: number) => {
    setOpenTabs(prev => {
      let changed = false;
      const next = prev.map(tab => {
        if (tab.path !== path || tab.cursorLine === line) return tab;
        changed = true;
        return { ...tab, cursorLine: line };
      });
      return changed ? next : prev;
    });
  }, []);

  const handleContentChange = (path: string, newContent: string) => {
    setOpenTabs(prev =>
      prev.map(tab => {
        if (tab.path === path) {
          return {
            ...tab,
            content: newContent,
            isDirty: newContent !== tab.originalContent
          };
        }
        return tab;
      })
    );
  };

  const handleSaveTab = async (path: string) => {
    const tab = openTabs.find(t => t.path === path);
    if (!tab || !window.electronAPI) return;

    const res = await window.electronAPI.writeFile(path, tab.content);
    if (res.success) {
      setOpenTabs(prev =>
        prev.map(t =>
          t.path === path ? { ...t, originalContent: tab.content, isDirty: t.content !== tab.content } : t
        )
      );
      loadDirectory(workspacePath);
    }
  };

  const handleCreateFile = async (dirPath: string) => {
    const name = prompt('Enter new file name:');
    if (!name || !window.electronAPI) return;
    const fullPath = `${dirPath}\\${name}`;
    await window.electronAPI.createFile(fullPath);
    await loadDirectory(workspacePath);
    handleFileSelect(fullPath);
  };

  const handleCreateFolder = async (dirPath: string) => {
    const name = prompt('Enter new folder name:');
    if (!name || !window.electronAPI) return;
    const fullPath = `${dirPath}\\${name}`;
    await window.electronAPI.createFolder(fullPath);
    loadDirectory(workspacePath);
  };

  const handleDeleteTarget = async (targetPath: string) => {
    if (!window.electronAPI) return;
    const res = await window.electronAPI.deleteTarget(targetPath);
    if (!res?.success) {
      console.warn('Delete failed:', res?.error || 'unknown error');
      return;
    }
    const remaining = openTabsSnapshotRef.current.filter(t => !isSameOrUnderPath(t.path, targetPath));
    setOpenTabs(prev => prev.filter(t => !isSameOrUnderPath(t.path, targetPath)));
    const active = activeTabPathRef.current;
    if (active && isSameOrUnderPath(active, targetPath)) {
      setActiveTabPath(remaining.length ? remaining[remaining.length - 1].path : undefined);
    }
    loadDirectory(workspacePath);
  };

  // 6. Agent Tool Execution Callbacks (workspace-scoped via tools:exec)
  const handleApplyFileWrite = async (filePath: string, content: string): Promise<boolean> => {
    if (!window.electronAPI || !workspacePath) return false;

    // workspacePath is the desktop-opened folder. Web clients mirror it from the live
    // session; execTool still rejects a root that is not the main-process pin.
    const rel = clampWritePath(workspacePath, filePath);
    if (!rel) {
      console.error('Write rejected: path outside workspace', filePath);
      return false;
    }
    let writeContent = content;
    if (/(^|[/\\])package\.json$/i.test(rel.replace(/\\/g, '/'))) {
      const { sanitizePackageJsonContent } = await import('./lib/npmDeps');
      writeContent = sanitizePackageJsonContent(content).content;
    }

    // Prefer scoped agent write so paths cannot escape the open workspace
    const scoped = await window.electronAPI.execTool(workspacePath, 'write_file', {
      path: rel,
      content: writeContent
    });
    if (scoped.error) {
      console.error('Scoped write failed:', scoped.error);
      return false;
    }

    const absolutePath = canonicalTabPath(
      scoped.path || (filePath.includes(':') ? filePath : `${workspacePath}\\${filePath.replace(/^[\\/]+/, '')}`),
      pathSepFor(workspacePath)
    );
    await loadDirectory(workspacePath);
    if (/(^|[/\\])package\.json$/i.test(rel.replace(/\\/g, '/'))) {
      setCanInstallDeps(true);
    }
    const existingTab = openTabsSnapshotRef.current.find(t => sameTabPath(t.path, absolutePath));
    if (existingTab?.isDirty && existingTab.content !== writeContent) {
      console.warn(`${absolutePath} changed on disk while it has unsaved edits. Your unsaved buffer was kept.`);
    }
    setOpenTabs(prev => {
      const idx = prev.findIndex(t => sameTabPath(t.path, absolutePath));
      if (idx >= 0) {
        const updated = [...prev];
        const current = updated[idx];
        updated[idx] = current.isDirty
          ? {
              ...current,
              originalContent: writeContent,
              isDirty: current.content !== writeContent
            }
          : {
              ...current,
              content: writeContent,
              originalContent: writeContent,
              isDirty: false
            };
        return updated;
      }
      const fileName = absolutePath.split(/[\\/]/).pop() || 'file';
      const newTab: OpenTab = {
        path: absolutePath,
        name: fileName,
        content: writeContent,
        originalContent: writeContent,
        isDirty: false,
        language: getLanguageFromPath(absolutePath)
      };
      return [...prev, newTab];
    });
    setActiveTabPath(existingTab?.path ?? absolutePath);
    return true;
  };

  const handleExecuteToolCommand = async (
    command: string,
    opts?: { timeoutSec?: number }
  ): Promise<string> => {
    setIsTerminalOpen(true);
    if (!window.electronAPI || !workspacePath) return '';
    const res = await window.electronAPI.execTool(workspacePath, 'run_command', {
      command,
      ...(opts?.timeoutSec ? { timeoutSec: opts.timeoutSec } : {})
    });
    return res.content || res.error || '';
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!workspacePath || !window.electronAPI?.hasPackageJson) {
        setCanInstallDeps(false);
        return;
      }
      const res = await window.electronAPI.hasPackageJson(workspacePath);
      if (!cancelled) setCanInstallDeps(!!res.exists);
    })();
    return () => {
      cancelled = true;
    };
  }, [workspacePath, workspaceEpoch, files]);

  const handleInstallDeps = async () => {
    if (!workspacePath || !window.electronAPI?.installWorkspaceDeps || installingDeps) return;
    setIsTerminalOpen(true);
    setInstallingDeps(true);
    try {
      const res = await window.electronAPI.installWorkspaceDeps(workspacePath, {
        timeoutMs: 300000
      });
      if (!res.ok) {
        console.warn('npm install failed:', res.error || res.output);
      }
      await loadDirectory(workspacePath);
      const again = await window.electronAPI.hasPackageJson(workspacePath);
      setCanInstallDeps(!!again.exists);
    } finally {
      setInstallingDeps(false);
    }
  };

  const handleOpenFileInEditor = (filePath: string) => {
    const isAbsolute = /^[a-zA-Z]:/.test(filePath) || /^[\\/]{2}/.test(filePath);
    const absolutePath = isAbsolute
      ? filePath
      : `${workspacePath}${pathSepFor(workspacePath)}${filePath.replace(/^[\\/]+/, '')}`;
    handleFileSelect(absolutePath);
  };

  // 7. Node / Hardware Updates
  const handleUpdateNodes = (updatedNodes: NodeConfig[]) => {
    // Persist config fields only (strip live status if present)
    const configs: NodeConfig[] = normalizeClusterNodes(
      updatedNodes.map(n => {
        const { online: _o, latency: _l, models: _m, loaded: _ld, error: _e, ...cfg } = n as EndpointNode;
        return cfg;
      })
    );
    updateSettings({ nodes: configs });
    setNodes(prev =>
      configs.map(cfg => {
        const incoming = updatedNodes.find(u => u.id === cfg.id) as EndpointNode | undefined;
        const existing = prev.find(p => p.id === cfg.id);
        const meta = cfg.modelMeta || existing?.modelMeta || {};
        const incomingModels = incoming?.models;
        const liveModels = Array.isArray(incomingModels) ? incomingModels : (existing?.models ?? []);
        return {
          ...cfg,
          online: existing?.online ?? false,
          latency: existing?.latency ?? null,
          loaded: existing?.loaded ?? [],
          error: existing?.error,
          models: liveModels.map(m => ({
            ...m,
            capabilities: m.capabilities || meta[m.name]?.capabilities,
            description: meta[m.name]?.description || m.description,
            thinking: meta[m.name]?.thinking || m.thinking
          }))
        };
      })
    );
  };

  const handleSelectNodeModel = (nodeId: string, model: string) => {
    const updatedConfigs: NodeConfig[] = nodes.map(n => {
      const { online, latency, models, loaded, error, ...cfg } = n;
      if (cfg.id === nodeId) {
        return { ...cfg, activeModel: model };
      }
      return cfg;
    });
    handleUpdateNodes(updatedConfigs);
  };

  const handleToggleModelThinking = (nodeId: string, modelName: string, enabled: boolean) => {
    const updatedConfigs: NodeConfig[] = nodes.map(n => {
      const { online, latency, models, loaded, error, ...cfg } = n;
      if (cfg.id !== nodeId) return cfg;
      return {
        ...cfg,
        modelPrefs: {
          ...(cfg.modelPrefs || {}),
          [modelName]: { ...(cfg.modelPrefs?.[modelName] || {}), think: enabled }
        }
      };
    });
    handleUpdateNodes(updatedConfigs);
  };

  const handleNoteFreeTierCall = (nodeId: string) => {
    const stamp = bumpFreeTierUsage;
    setSettings(prev => {
      const next = {
        ...prev,
        nodes: prev.nodes.map(n => n.id === nodeId ? { ...n, freeTierUsage: stamp(n.freeTierUsage) } : n)
      };
      window.electronAPI?.saveSettings(next);
      return next;
    });
    setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, freeTierUsage: stamp(n.freeTierUsage) } : n));
  };

  const handleRecordTokens = (localCount: number, frontierCount: number) => {
    setSettings(prev => {
      const usage = { ...(prev.workspaceTokenUsage || {}) };
      const key = normalizeWorkspacePath(workspacePath);
      if (key) {
        const cur = usage[key] || { localTokensGenerated: 0, frontierTokensUsed: 0 };
        usage[key] = {
          localTokensGenerated: (cur.localTokensGenerated || 0) + localCount,
          frontierTokensUsed: (cur.frontierTokensUsed || 0) + frontierCount
        };
      }
      const next: AppSettings = {
        ...prev,
        localTokensGenerated: (prev.localTokensGenerated || 0) + localCount,
        frontierTokensUsed: (prev.frontierTokensUsed || 0) + frontierCount,
        workspaceTokenUsage: usage
      };
      if (window.electronAPI) {
        if (!settingsReadyRef.current) {
          const { roleRoutes: _omit, ...rest } = next;
          window.electronAPI.saveSettings(rest);
        } else {
          window.electronAPI.saveSettings(next);
        }
      }
      return next;
    });
  };

  const tokenMirror = isRemoteClient ? sessionTokens : null;
  const tokenStatsScope =
    tokenMirror?.tokenStatsScope === 'project' || tokenMirror?.tokenStatsScope === 'global'
      ? tokenMirror.tokenStatsScope
      : settings.tokenStatsScope === 'project'
        ? 'project'
        : 'global';
  const projectTokenKey = normalizeWorkspacePath(workspacePath);
  const tokenUsage = tokenMirror?.workspaceTokenUsage ?? settings.workspaceTokenUsage;
  const projectTokens = projectTokenKey ? tokenUsage?.[projectTokenKey] : undefined;
  const displayLocalTokens =
    tokenStatsScope === 'project'
      ? projectTokens?.localTokensGenerated || 0
      : tokenMirror
        ? tokenMirror.localTokensGenerated
        : settings.localTokensGenerated || 0;
  const displayFrontierTokens =
    tokenStatsScope === 'project'
      ? projectTokens?.frontierTokensUsed || 0
      : tokenMirror
        ? tokenMirror.frontierTokensUsed
        : settings.frontierTokensUsed || 0;

  const handleTokenStatsScopeChange = (scope: 'global' | 'project') => {
    updateSettings({ tokenStatsScope: scope });
  };

  const handleResetTokenStats = () => {
    if (tokenStatsScope === 'project') {
      if (!projectTokenKey) return;
      const label = workspacePath.split(/[\\/]/).filter(Boolean).pop() || 'this project';
      if (!window.confirm(`Reset token stats for ${label}?`)) return;
      const usage = { ...(settings.workspaceTokenUsage || {}) };
      delete usage[projectTokenKey];
      updateSettings({ workspaceTokenUsage: usage });
      return;
    }
    if (!window.confirm('Reset global token stats?')) return;
    updateSettings({ localTokensGenerated: 0, frontierTokensUsed: 0 });
  };

  const handleAgentBusyChange = useCallback((busy: boolean) => {
    setAgentBusy(busy);
    void window.electronAPI?.setUpdateBusy?.(busy);
  }, []);
  const runLogCopyRef = useRef<(() => void) | null>(null);
  const registerRunLog = useCallback((api: { copy: () => void } | null) => {
    runLogCopyRef.current = api ? () => api.copy() : null;
  }, []);

  const agentChatProps = {
    agents: settings.agents,
    selectedAgentId,
    onSelectAgent: setSelectedAgentId,
    nodes,
    activeTab: openTabs.find(t => t.path === activeTabPath),
    workspacePath,
    workspaceFiles: files,
    controlWidth: agentControlWidth,
    onControlWidthChange: (w: number) => {
      setAgentControlWidth(w);
      updateSettings({ agentControlWidth: w });
    },
    nodeWorkWidth: agentNodeWorkWidth,
    onNodeWorkWidthChange: (w: number) => {
      setAgentNodeWorkWidth(w);
      updateSettings({ agentNodeWorkWidth: w });
    },
    onChromeWidthsChange: (control: number, node: number) => {
      setShownControlWidth(prev => (prev === control ? prev : control));
      setShownNodeWidth(prev => (prev === node ? prev : node));
    },
    onSelectNodeModel: handleSelectNodeModel,
    onApplyFileWrite: handleApplyFileWrite,
    onExecuteToolCommand: handleExecuteToolCommand,
    onOpenFileInEditor: (path: string) => {
      handleOpenFileInEditor(path);
      if (isNarrow) setMobilePane('code');
    },
    onRecordTokens: handleRecordTokens,
    onNoteFreeTierCall: handleNoteFreeTierCall,
    maxAgentSteps: settings.maxAgentSteps || 12,
    conversation: activeConversation,
    workspaceConversations,
    onMessagesChange: handleMessagesChange,
    onConversationPatch: handleConversationPatch,
    onNewChat: handleNewChat,
    onClearProjectChats: handleClearProjectChats,
    onSelectConversation: handleSelectConversation,
    onDeleteConversation: handleDeleteConversation,
    onToggleModelThinking: handleToggleModelThinking,
    searxngUrl: settings.searxngUrl || '',
    mcpServersJson: settings.mcpServersJson || '',
    swarmEnabled: settings.swarmEnabled !== false,
    autoNodeEnabled: settings.autoSelectEndpoint !== false,
    autoApplyEnabled: settings.autoApplyWrites !== false,
    autoReviewEnabled: settings.autoReview !== false,
    fullAutoEnabled: settings.fullAuto === true,
    cloudStrategistEnabled: settings.cloudStrategistEnabled !== false,
    roleRoutesEnabled: settings.roleRoutes,
    onConductorPrefsChange: (patch: Parameters<NonNullable<React.ComponentProps<typeof AgentChat>['onConductorPrefsChange']>>[0]) => {
      if (isRemoteClient && Object.prototype.hasOwnProperty.call(patch, 'roleRoutes')) {
        const routes = normalizeRoleRoutes(patch.roleRoutes);
        setSettings(prev =>
          sameRoleRoutes(prev.roleRoutes, routes) ? prev : { ...prev, roleRoutes: routes }
        );
        const rest = { ...patch };
        delete rest.roleRoutes;
        if (Object.keys(rest).length > 0) updateSettings(rest);
        return;
      }
      updateSettings(patch);
    },
    onUpdateNodes: handleUpdateNodes,
    onBusyChange: handleAgentBusyChange,
    onOpenHardware: () => {
      setHardwareTab('nodes');
      setIsHardwareModalOpen(true);
    },
    onOpenFolder: handleSelectFolder,
    peerConductor,
    peerChatMirror,
    onLiveConductorPublish: handleLiveConductorPublish,
    onRunLogApi: registerRunLog
  };

  const openHardwareTab = (tab: HardwareSettingsTab) => {
    setHardwareTab(tab);
    setIsHardwareModalOpen(true);
  };

  const paletteActions = [
    { id: 'open-folder', label: 'Open folder', keywords: 'project workspace', run: () => void handleSelectFolder() },
    {
      id: 'hw-endpoints',
      label: 'Hardware & Models: Endpoints',
      hint: 'Nodes',
      keywords: 'cluster gpu ollama',
      run: () => openHardwareTab('endpoints')
    },
    {
      id: 'hw-models',
      label: 'Hardware & Models: Models',
      keywords: 'pull benchmark installed',
      run: () => openHardwareTab('models')
    },
    {
      id: 'hw-integrations',
      label: 'Hardware & Models: Integrations',
      keywords: 'mcp searxng',
      run: () => openHardwareTab('integrations')
    },
    {
      id: 'hw-hub',
      label: 'Hardware & Models: Model Hub',
      keywords: 'catalog recommend quant',
      run: () => openHardwareTab('hub')
    },
    {
      id: 'hw-appearance',
      label: 'Hardware & Models: Appearance',
      keywords: 'zoom scale theme',
      run: () => openHardwareTab('appearance')
    },
    {
      id: 'hw-stats',
      label: 'Hardware & Models: Stats',
      keywords: 'tokens usage',
      run: () => openHardwareTab('stats')
    },
    {
      id: 'hw-remote',
      label: 'Hardware & Models: Remote',
      keywords: 'web console lan',
      run: () => openHardwareTab('remote')
    },
    {
      id: 'hw-support',
      label: 'Hardware & Models: Support',
      keywords: 'logs help',
      run: () => openHardwareTab('support')
    },
    {
      id: 'toggle-terminal',
      label: isTerminalOpen ? 'Hide terminal' : 'Show terminal',
      keywords: 'powershell console',
      run: () => {
        const next = !isTerminalOpen;
        setIsTerminalOpen(next);
        if (isNarrow) setMobilePane(next ? 'term' : 'chat');
      }
    },
    {
      id: 'reset-pane-sizes',
      label: 'Reset pane sizes',
      keywords: 'layout splitter width explorer editor terminal',
      run: () => resetPaneSizes()
    },
    {
      id: 'toggle-code-editor',
      label: 'Toggle code editor',
      hint: editorHidden ? 'Show' : 'Hide',
      keywords: 'layout monaco hide code column',
      run: () => toggleCodeEditor()
    },
    {
      id: 'copy-run-log',
      label: 'Copy run log',
      keywords: 'conductor log failures paste',
      run: () => runLogCopyRef.current?.()
    },
    { id: 'new-chat', label: 'New chat', keywords: 'conversation thread', run: () => handleNewChat() },
    {
      id: 'refresh-cluster',
      label: 'Refresh cluster',
      keywords: 'ping nodes status',
      run: () => void refreshNodes({ force: true })
    }
  ];

  const mobileNavBtn = (id: MobilePane, label: string, Icon: typeof MessageSquare) => (
    <button
      key={id}
      type="button"
      onClick={() => {
        setMobilePane(id);
        if (id === 'term') setIsTerminalOpen(true);
        if (id === 'more') setIsHardwareModalOpen(true);
      }}
      className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition ${
        mobilePane === id || (id === 'more' && isHardwareModalOpen)
          ? 'text-indigo-300'
          : 'text-zinc-500'
      }`}
    >
      <Icon className="w-5 h-5" />
      <span>{label}</span>
    </button>
  );

  return (
    <div
      className={`flex flex-col h-[100dvh] w-screen bg-[#18181b] text-zinc-100 overflow-hidden font-sans ${
        isNarrow ? 'select-text' : 'select-none'
      }`}
    >
      {/* Top header stays visible. Web console keeps the same brand, tokens, and endpoints as desktop. */}
      <div className="shrink-0">
        <Header
          workspacePath={workspacePath}
          recentWorkspaces={settings.recentWorkspaces || []}
          onSelectFolder={handleSelectFolder}
          onOpenRecent={handleOpenRecent}
          onNewProject={handleNewProject}
          nodes={nodes}
          onRefreshNodes={() => {
            void refreshNodes({ force: true });
          }}
          isTerminalOpen={isTerminalOpen}
          onToggleTerminal={() => {
            setIsTerminalOpen(!isTerminalOpen);
            if (isNarrow) setMobilePane('term');
          }}
          onOpenHardware={tab => {
            if (isHardwareTab(tab)) setHardwareTab(tab);
          }}
          onOpenHardwareModal={() => setIsHardwareModalOpen(true)}
          localTokens={displayLocalTokens}
          frontierTokens={displayFrontierTokens}
          tokenStatsScope={tokenStatsScope}
          onTokenStatsScopeChange={handleTokenStatsScopeChange}
          hasProject={!!projectTokenKey}
          canInstallDeps={canInstallDeps}
          installingDeps={installingDeps}
          onInstallDeps={() => void handleInstallDeps()}
          uiScale={uiScale}
          onUpdateUiScale={handleUpdateUiScale}
          appVersion={appVersion}
          compact={isNarrow && !isRemoteClient}
          wrapChrome={isRemoteClient && isNarrow}
        />
      </div>
      <UpdateBanner />

      {isRemoteClient && (
        <RemoteHostBanner remoteLive={remoteLive} />
      )}

      <ProjectPickerModal
        open={projectPicker.open}
        title={projectPicker.mode === 'new' ? 'New project' : 'Open project'}
        onClose={() => setProjectPicker(p => ({ ...p, open: false }))}
        onPick={path => openWorkspace(path, { newChat: projectPicker.mode === 'new' })}
      />

      {isNarrow ? (
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          <div className="flex-1 overflow-hidden min-h-0">
            {mobilePane === 'files' && (
              <FileTree
                files={files}
                activeFilePath={activeTabPath}
                onFileSelect={path => {
                  void handleFileSelect(path);
                  setMobilePane('code');
                }}
                onRefresh={() => loadDirectory(workspacePath)}
                onCreateFile={handleCreateFile}
                onCreateFolder={handleCreateFolder}
                onDelete={handleDeleteTarget}
                onOpenFolder={handleSelectFolder}
                rootPath={workspacePath}
                fill
              />
            )}
            {mobilePane === 'code' && (
              <div className="h-full flex flex-col overflow-hidden">
                <GitPanel workspacePath={workspacePath} />
                <EditorView
                  tabs={openTabs}
                  activeTabPath={activeTabPath}
                  onSelectTab={setActiveTabPath}
                  onCloseTab={handleCloseTab}
                  onContentChange={handleContentChange}
                  onSaveTab={handleSaveTab}
                  onCursorLine={handleCursorLine}
                  onOpenFolder={handleSelectFolder}
                  workspacePath={workspacePath}
                />
              </div>
            )}
            {mobilePane === 'term' && (
              <div className="h-full flex flex-col overflow-hidden">
                <TerminalPanel
                  isOpen
                  fill
                  resetNonce={terminalResetNonce}
                  onClose={() => setMobilePane('chat')}
                  workspacePath={workspacePath}
                />
              </div>
            )}
            {(mobilePane === 'chat' || mobilePane === 'more') && (
              <AgentChat {...agentChatProps} fill />
            )}
          </div>
          <nav className="shrink-0 flex border-t border-[#27272a] bg-[#121215] pb-[env(safe-area-inset-bottom)]">
            {mobileNavBtn('chat', 'Chat', MessageSquare)}
            {mobileNavBtn('files', 'Files', FolderTree)}
            {mobileNavBtn('code', 'Code', Code2)}
            {mobileNavBtn('term', 'Term', TerminalIcon)}
            {mobileNavBtn('more', 'More', MoreHorizontal)}
          </nav>
        </div>
      ) : (
        <div ref={layoutRowRef} className="flex-1 flex overflow-hidden min-h-0 min-w-0">
          <div ref={explorerPaneRef} style={{ width: paneLayout.explorer }} className="h-full shrink-0">
            <FileTree
              files={files}
              activeFilePath={activeTabPath}
              onFileSelect={handleFileSelect}
              onRefresh={() => loadDirectory(workspacePath)}
              onCreateFile={handleCreateFile}
              onCreateFolder={handleCreateFolder}
              onDelete={handleDeleteTarget}
              onOpenFolder={handleSelectFolder}
              rootPath={workspacePath}
              width="100%"
            />
          </div>

          <SplitHandle
            orientation="vertical"
            label="Resize explorer"
            value={paneLayout.explorer}
            min={Math.min(EXPLORER_MIN, paneLayout.explorer)}
            max={Math.max(paneLayout.explorer, paneLayout.explorerMax)}
            valueSide="before"
            resetValue={PANE_RESET.explorerWidth}
            active={explorerDrag.dragging}
            onPointerDown={explorerDrag.onPointerDown}
            onChange={next => {
              explorerWidthRef.current = next;
              setExplorerWidth(next);
            }}
            onCommit={commitExplorerWidth}
          />

          {!editorHidden && (
            <div
              ref={editorPaneRef}
              style={{ width: paneLayout.editor }}
              className="shrink-0 h-full min-h-0 flex flex-col overflow-hidden"
            >
              <GitPanel workspacePath={workspacePath} />
              <EditorView
                tabs={openTabs}
                activeTabPath={activeTabPath}
                onSelectTab={setActiveTabPath}
                onCloseTab={handleCloseTab}
                onContentChange={handleContentChange}
                onSaveTab={handleSaveTab}
                onCursorLine={handleCursorLine}
                onOpenFolder={handleSelectFolder}
                workspacePath={workspacePath}
              />

              <TerminalPanel
                isOpen={isTerminalOpen}
                onClose={() => setIsTerminalOpen(false)}
                workspacePath={workspacePath}
                resetNonce={terminalResetNonce}
              />
            </div>
          )}

          {!editorHidden && (
            <SplitHandle
              orientation="vertical"
              label="Resize code editor"
              value={paneLayout.editor}
              min={Math.min(EDITOR_MIN, paneLayout.editor)}
              max={Math.max(paneLayout.editor, paneLayout.editorMax)}
              valueSide="before"
              resetValue={PANE_RESET.editorWidth}
              active={editorDrag.dragging}
              onPointerDown={editorDrag.onPointerDown}
              onChange={setEditorWidth}
              onCommit={commitEditorWidth}
            />
          )}

          <AgentChat {...agentChatProps} />
        </div>
      )}

      <HardwareSettingsModal
        isOpen={isHardwareModalOpen}
        initialTab={hardwareTab}
        onClose={() => setIsHardwareModalOpen(false)}
        nodes={nodes}
        onUpdateNodes={handleUpdateNodes}
        onRefreshNodes={refreshNodes}
        estimateContext={settings.estimateContext || 16384}
        onUpdateEstimateContext={ctx => updateSettings({ estimateContext: ctx })}
        localTokens={displayLocalTokens}
        frontierTokens={displayFrontierTokens}
        tokenStatsScope={tokenStatsScope}
        onTokenStatsScopeChange={handleTokenStatsScopeChange}
        onResetTokenStats={handleResetTokenStats}
        hasProject={!!projectTokenKey}
        projectLabel={
          workspacePath.split(/[\\/]/).filter(Boolean).pop() || undefined
        }
        uiScale={uiScale}
        onUpdateUiScale={handleUpdateUiScale}
        searxngUrl={settings.searxngUrl || ''}
        onUpdateSearxngUrl={url => updateSettings({ searxngUrl: url })}
        mcpServersJson={settings.mcpServersJson || ''}
        onUpdateMcpServersJson={json => updateSettings({ mcpServersJson: json })}
        onWebConsoleChange={web =>
          setSettings(prev => ({
            ...prev,
            webConsole: {
              ...(prev.webConsole || { enabled: false, port: 3847 }),
              enabled: web.enabled,
              port: web.port
            }
          }))
        }
      />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} actions={paletteActions} />
    </div>
  );
};
