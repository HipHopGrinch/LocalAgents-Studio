import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Header } from './components/Header';
import { FileTree } from './components/FileTree';
import { EditorView } from './components/EditorView';
import { GitPanel } from './components/GitPanel';
import { TerminalPanel } from './components/TerminalPanel';
import { AgentChat } from './components/AgentChat';
import { HardwareSettingsModal } from './components/HardwareSettingsModal';
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
import { bumpFreeTierUsage } from './lib/freeTierAssist';
import { normalizeClusterNodes } from './lib/tools';
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

/** Keep agent writes inside the open folder, even when a model emits an absolute path. */
function clampWritePath(root: string, filePath: string): string {
  let p = (filePath || '').trim().replace(/^["']|["']$/g, '');
  if (!p) return 'file';
  const rootNorm = root.replace(/[\\/]+$/, '').replace(/\\/g, '/');
  let norm = p.replace(/\\/g, '/');
  const rootLower = rootNorm.toLowerCase();
  const lower = norm.toLowerCase();
  if (lower.startsWith(rootLower + '/')) norm = norm.slice(rootNorm.length + 1);
  else if (/^[a-zA-Z]:\//.test(norm) || norm.startsWith('//') || norm.startsWith('/')) {
    norm = norm.split('/').filter(Boolean).pop() || 'file';
  }
  const parts = norm.split('/').filter(part => part && part !== '.' && part !== '..');
  return parts.join('/') || 'file';
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

  // Resizable Sidebar Widths
  const [explorerWidth, setExplorerWidth] = useState<number>(DEFAULT_SETTINGS.explorerWidth || 240);
  const [chatWidth, setChatWidth] = useState<number>(DEFAULT_SETTINGS.chatWidth || 640);
  const [agentControlWidth, setAgentControlWidth] = useState<number>(
    DEFAULT_SETTINGS.agentControlWidth || 270
  );
  const [agentNodeWorkWidth, setAgentNodeWorkWidth] = useState<number>(
    DEFAULT_SETTINGS.agentNodeWorkWidth || 280
  );
  const [resizingSide, setResizingSide] = useState<'explorer' | 'chat' | null>(null);

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
    }, 350);

    // Cluster status: desktop is authoritative; remotes always take node mirrors from peers that sent them.
    if (Array.isArray(session.nodes) && session.nodes.length > 0) {
      if (isRemoteClient || session.source === 'desktop' || session.source === 'seed') {
        const configs: NodeConfig[] = session.nodes.map(n => {
          const { online: _o, latency: _l, models: _m, loaded: _ld, error: _e, ...cfg } = n as LiveSessionNode &
            EndpointNode;
          return cfg;
        });
        setSettings(prev => ({ ...prev, nodes: configs }));
        setNodes(prev => {
          const byId = new Map(prev.map(n => [n.id, n]));
          return session.nodes.map(n => {
            const existing = byId.get(n.id);
            const { online: _o, latency: _l, models: _m, loaded: _ld, error: _e, ...cfg } = n;
            const hasLiveModels = Array.isArray(n.models) && n.models.length > 0;
            return {
              ...cfg,
              online: typeof n.online === 'boolean' ? n.online : existing?.online ?? false,
              latency: n.latency != null ? n.latency : existing?.latency ?? null,
              models: hasLiveModels ? n.models! : existing?.models ?? [],
              loaded: n.loaded?.length ? n.loaded : existing?.loaded ?? [],
              error: n.error ?? existing?.error
            } as EndpointNode;
          });
        });
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
      setWorkspacePath(nextWs);
      void window.electronAPI?.readDir(nextWs).then(result => {
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
    if (nextTab && nextTab !== activeTabPathRef.current) {
      void (async () => {
        if (!window.electronAPI) return;
        const alreadyOpen = openTabsSnapshotRef.current.some(t => t.path === nextTab);
        if (!alreadyOpen) {
          const res = await window.electronAPI.readFile(nextTab);
          if (res.content !== undefined) {
            const fileName = nextTab.split(/[\\/]/).pop() || 'Untitled';
            setOpenTabs(prev => {
              if (prev.some(t => t.path === nextTab)) return prev;
              return [
                ...prev,
                {
                  path: nextTab,
                  name: fileName,
                  content: res.content!,
                  originalContent: res.content!,
                  isDirty: false,
                  language: getLanguageFromPath(nextTab)
                }
              ];
            });
          }
        }
        setActiveTabPath(nextTab);
      })();
    }

    if (session.conductor) {
      setPeerConductor(session.conductor);
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

      // Prefer the live desktop session cluster when the disk snapshot is empty (remote attach).
      if (live && Array.isArray(live.nodes) && live.nodes.length > 0) {
        if (!merged.nodes.length || (live.updatedAt && live.nodes.length >= merged.nodes.length)) {
          merged.nodes = live.nodes;
        }
      }

      const sortedChats = [...(merged.conversations || [])].sort((a, b) => a.updatedAt - b.updatedAt);
      let recent = merged.recentWorkspaces || [];
      for (const chat of sortedChats) {
        if (chat.workspacePath) recent = rememberWorkspace(recent, chat.workspacePath);
      }
      merged.recentWorkspaces = recent;
      setSettings(merged);
      setSettingsReady(true);
      if (isRemoteClient && live) {
        setSessionTokens(prev => mergeTokenMirror(prev, live));
      }
      if (merged.explorerWidth) setExplorerWidth(merged.explorerWidth);
      if (merged.chatWidth) setChatWidth(merged.chatWidth);
      if (merged.agentControlWidth) setAgentControlWidth(merged.agentControlWidth);
      if (merged.agentNodeWorkWidth) setAgentNodeWorkWidth(merged.agentNodeWorkWidth);

      const initialActive =
        (live && live.activeConversationId) || merged.activeConversationId || undefined;
      if (initialActive) setActiveConversationId(initialActive);
      if (live?.selectedAgentId) setSelectedAgentId(live.selectedAgentId);

      const initialScale = merged.uiScale || 1.0;
      setUiScale(initialScale);
      if (window.electronAPI.setZoomFactor) {
        window.electronAPI.setZoomFactor(initialScale);
      }
      document.documentElement.style.setProperty('--app-scale', String(initialScale));

      if (live && Array.isArray(live.nodes) && live.nodes.length > 0 && live.nodes.some(n => n.online != null)) {
        setNodes(
          live.nodes.map(n => {
            const { online: _o, latency: _l, models: _m, loaded: _ld, error: _e, ...cfg } = n;
            return {
              ...cfg,
              online: !!n.online,
              latency: n.latency ?? null,
              models: n.models || [],
              loaded: n.loaded || [],
              error: n.error
            } as EndpointNode;
          })
        );
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

    const poll = window.setInterval(() => {
      void window.electronAPI.getLiveSession?.().then(s => {
        markHostUp();
        if (s && s.updatedAt > 0) applyLiveSession(s);
      });
    }, 750);

    return () => {
      cancelled = true;
      unsub?.();
      window.clearInterval(poll);
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
      localConductorRef.current = payload.conductor;
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
        window.electronAPI.saveSettings(next);
      }
      return next;
    });
  }, []);

  const handleUpdateUiScale = useCallback((scale: number) => {
    const clamped = Math.max(0.75, Math.min(2.0, Math.round(scale * 100) / 100));
    setUiScale(clamped);
    if (window.electronAPI?.setZoomFactor) {
      window.electronAPI.setZoomFactor(clamped);
    }
    document.documentElement.style.setProperty('--app-scale', String(clamped));
    updateSettings({ uiScale: clamped });
  }, [updateSettings]);

  // Global Keyboard Zoom Shortcuts: Ctrl + / Ctrl - / Ctrl 0
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault();
          handleUpdateUiScale(uiScale + 0.05);
        } else if (e.key === '-' || e.key === '_') {
          e.preventDefault();
          handleUpdateUiScale(uiScale - 0.05);
        } else if (e.key === '0') {
          e.preventDefault();
          handleUpdateUiScale(1.0);
        }
      }
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
        let forWs = fromDisk.length ? fromDisk : fromSettings;
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
        window.electronAPI.saveSettings(next);
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

  // Sidebar Drag-Resize Listeners
  useEffect(() => {
    if (!resizingSide) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (resizingSide === 'explorer') {
        const nextWidth = Math.max(160, Math.min(540, e.clientX));
        setExplorerWidth(nextWidth);
      } else if (resizingSide === 'chat') {
        // Whole Agent Conductor (chat + Conductor + Node Work) — allow pulling further left.
        const nextWidth = Math.max(560, Math.min(1600, window.innerWidth - e.clientX));
        setChatWidth(nextWidth);
      }
    };

    const handleMouseUp = () => {
      setResizingSide(null);
      updateSettings({ explorerWidth, chatWidth, agentControlWidth, agentNodeWorkWidth });
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingSide, explorerWidth, chatWidth, agentControlWidth, agentNodeWorkWidth, updateSettings]);

  // 3. Cluster Polling — preserve user toggles/benchmarks; only merge live status fields
  const nodesRef = React.useRef(nodes);
  nodesRef.current = nodes;

  const refreshNodes = useCallback(async () => {
    if (!window.electronAPI) return;
    const endpointsToPing = nodesRef.current.map(n => ({
      id: n.id,
      url: n.url,
      type: n.type,
      apiKey: n.apiKey
    }));

    try {
      const results = await window.electronAPI.clusterStatus(endpointsToPing);
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
              error: res.error
              // disabledModels / activeModel / benchmarks / modelMeta / modelPrefs retained via ...n
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
    // Web + desktop both ping through the host — remotes must not wait solely on live session.
    refreshNodes();
    const interval = setInterval(refreshNodes, (settings.pollIntervalSec || 15) * 1000);
    return () => clearInterval(interval);
  }, [settings.pollIntervalSec, refreshNodes]);

  // 4. File Tree
  const loadDirectory = async (dirPath: string) => {
    if (!window.electronAPI) return;
    const result = await window.electronAPI.readDir(dirPath);
    setFiles(Array.isArray(result) ? result : []);
  };

  const openWorkspace = (chosen: string, opts?: { newChat?: boolean }) => {
    if (!chosen) return;
    forceNewChatRef.current = !!opts?.newChat;
    loadedWorkspaceRef.current = '';
    setWorkspaceEpoch(n => n + 1);
    setOpenTabs([]);
    setActiveTabPath(undefined);
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
    const existing = openTabs.find(t => t.path === filePath);
    if (existing) {
      setActiveTabPath(filePath);
      return;
    }

    if (!window.electronAPI) return;
    const res = await window.electronAPI.readFile(filePath);
    if (res.content !== undefined) {
      const fileName = filePath.split(/[\\/]/).pop() || 'Untitled';
      const newTab: OpenTab = {
        path: filePath,
        name: fileName,
        content: res.content,
        originalContent: res.content,
        isDirty: false,
        language: getLanguageFromPath(filePath)
      };
      setOpenTabs(prev => [...prev, newTab]);
      setActiveTabPath(filePath);
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
        prev.map(t => (t.path === path ? { ...t, originalContent: tab.content, isDirty: false } : t))
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
    await window.electronAPI.deleteTarget(targetPath);
    handleCloseTab(targetPath);
    loadDirectory(workspacePath);
  };

  // 6. Agent Tool Execution Callbacks (workspace-scoped via tools:exec)
  const handleApplyFileWrite = async (filePath: string, content: string): Promise<boolean> => {
    if (!window.electronAPI || !workspacePath) return false;

    const rel = clampWritePath(workspacePath, filePath);
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

    const absolutePath = scoped.path || (filePath.includes(':') ? filePath : `${workspacePath}\\${filePath.replace(/^[\\/]+/, '')}`);
    await loadDirectory(workspacePath);
    if (/(^|[/\\])package\.json$/i.test(rel.replace(/\\/g, '/'))) {
      setCanInstallDeps(true);
    }
    setOpenTabs(prev => {
      const idx = prev.findIndex(t => t.path === absolutePath);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = {
          ...updated[idx],
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
    setActiveTabPath(absolutePath);
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
    const absolutePath = filePath.includes(':') ? filePath : `${workspacePath}\\${filePath.replace(/^\//, '')}`;
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
      window.electronAPI?.saveSettings(next);
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
    void window.electronAPI?.setUpdateBusy?.(busy);
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
    onConductorPrefsChange: updateSettings,
    onBusyChange: handleAgentBusyChange,
    peerConductor,
    peerChatMirror,
    onLiveConductorPublish: handleLiveConductorPublish
  };

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
          onRefreshNodes={refreshNodes}
          isTerminalOpen={isTerminalOpen}
          onToggleTerminal={() => {
            setIsTerminalOpen(!isTerminalOpen);
            if (isNarrow) setMobilePane('term');
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
                />
              </div>
            )}
            {mobilePane === 'term' && (
              <div className="h-full flex flex-col overflow-hidden">
                <TerminalPanel
                  isOpen
                  fill
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
        <div className="flex-1 flex overflow-hidden">
          <FileTree
            files={files}
            activeFilePath={activeTabPath}
            onFileSelect={handleFileSelect}
            onRefresh={() => loadDirectory(workspacePath)}
            onCreateFile={handleCreateFile}
            onCreateFolder={handleCreateFolder}
            onDelete={handleDeleteTarget}
            rootPath={workspacePath}
            width={explorerWidth}
          />

          <div
            onMouseDown={() => setResizingSide('explorer')}
            title="Drag to resize Explorer sidebar"
            className={`w-1 cursor-col-resize transition-colors shrink-0 ${
              resizingSide === 'explorer' ? 'bg-indigo-500' : 'bg-transparent hover:bg-indigo-500/60'
            }`}
          />

          <div className="flex-1 flex flex-col overflow-hidden min-w-[260px]">
            <GitPanel workspacePath={workspacePath} />
            <EditorView
              tabs={openTabs}
              activeTabPath={activeTabPath}
              onSelectTab={setActiveTabPath}
              onCloseTab={handleCloseTab}
              onContentChange={handleContentChange}
              onSaveTab={handleSaveTab}
            />

            <TerminalPanel
              isOpen={isTerminalOpen}
              onClose={() => setIsTerminalOpen(false)}
              workspacePath={workspacePath}
            />
          </div>

          <div
            onMouseDown={() => setResizingSide('chat')}
            title="Drag to resize Agent Conductor sidebar"
            className={`w-1 cursor-col-resize transition-colors shrink-0 ${
              resizingSide === 'chat' ? 'bg-indigo-500' : 'bg-transparent hover:bg-indigo-500/60'
            }`}
          />

          <AgentChat {...agentChatProps} width={chatWidth} />
        </div>
      )}

      <HardwareSettingsModal
        isOpen={isHardwareModalOpen}
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
    </div>
  );
};
