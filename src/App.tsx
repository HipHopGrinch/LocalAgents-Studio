import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Header } from './components/Header';
import { FileTree } from './components/FileTree';
import { EditorView } from './components/EditorView';
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
  LiveSessionNode
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
  const [selectedAgentId, setSelectedAgentId] = useState<string>(DEFAULT_SETTINGS.agents[0].id);
  const [activeConversationId, setActiveConversationId] = useState<string | undefined>(undefined);
  const loadedWorkspaceRef = useRef('');
  const forceNewChatRef = useRef(false);
  const [workspaceEpoch, setWorkspaceEpoch] = useState(0);

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
  const [resizingSide, setResizingSide] = useState<'explorer' | 'chat' | null>(null);

  // UI & Text Scaling (Discord-style zoom factor: 0.75 to 2.0)
  const [uiScale, setUiScale] = useState<number>(DEFAULT_SETTINGS.uiScale || 1.0);
  const [appVersion, setAppVersion] = useState<string>('');
  const isRemoteClient = isWebConsoleClient();
  const sessionAppliedAtRef = useRef(0);
  const chatsRevisionRef = useRef(0);
  const workspacePathRef = useRef(workspacePath);
  workspacePathRef.current = workspacePath;
  const publishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [projectPicker, setProjectPicker] = useState<{
    open: boolean;
    mode: 'open' | 'new';
  }>({ open: false, mode: 'open' });
  const [remoteLive, setRemoteLive] = useState(false);
  const [chatsTick, setChatsTick] = useState(0);

  const markChatsSaved = useCallback(() => {
    if (isRemoteClient) return;
    chatsRevisionRef.current += 1;
    setChatsTick(t => t + 1);
  }, [isRemoteClient]);

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
    if (session.updatedAt < sessionAppliedAtRef.current) return;
    sessionAppliedAtRef.current = session.updatedAt;

    if (Array.isArray(session.nodes) && session.nodes.length > 0) {
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
      chatsRevisionRef.current = session.chatsRevision;
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
      // Same folder — reload chats from disk after desktop saved.
      forceNewChatRef.current = false;
      loadedWorkspaceRef.current = '';
      setWorkspaceEpoch(n => n + 1);
    }
  }, []);

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
      if (merged.explorerWidth) setExplorerWidth(merged.explorerWidth);
      if (merged.chatWidth) setChatWidth(merged.chatWidth);
      if (merged.agentControlWidth) setAgentControlWidth(merged.agentControlWidth);

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

  // Web console: host link is "live" once settings RPC works; also follow desktop session stream.
  useEffect(() => {
    if (!isRemoteClient || !window.electronAPI) return;

    let cancelled = false;
    const markHostUp = () => {
      if (!cancelled) setRemoteLive(true);
    };

    // Prove the WebSocket bridge works immediately (do not wait for desktop publish).
    void window.electronAPI
      .loadSettings()
      .then(() => markHostUp())
      .catch(() => {});

    const unsub = window.electronAPI.onLiveSession?.(session => {
      markHostUp();
      applyLiveSession(session);
    });

    const poll = window.setInterval(() => {
      void window.electronAPI.getLiveSession?.().then(s => {
        markHostUp();
        if (s && s.updatedAt > 0) applyLiveSession(s);
      });
    }, 2000);

    return () => {
      cancelled = true;
      unsub?.();
      window.clearInterval(poll);
    };
  }, [isRemoteClient, applyLiveSession]);

  // Desktop Electron window publishes continuously for remotes to mirror workspace/chat.
  useEffect(() => {
    if (!window.electronAPI?.publishLiveSession || isRemoteClient) return;
    if (publishTimerRef.current) clearTimeout(publishTimerRef.current);
    publishTimerRef.current = setTimeout(() => {
      void window.electronAPI.publishLiveSession?.({
        workspacePath,
        activeConversationId: activeConversationId || null,
        selectedAgentId,
        nodes: toLiveSessionNodes(nodes),
        chatsRevision: chatsRevisionRef.current,
        source: 'desktop'
      });
    }, 150);
    return () => {
      if (publishTimerRef.current) clearTimeout(publishTimerRef.current);
    };
  }, [
    isRemoteClient,
    workspacePath,
    activeConversationId,
    selectedAgentId,
    nodes,
    toLiveSessionNodes,
    chatsTick
  ]);

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
        if (wantNewChat || !forWs.some(c => c.id === active)) {
          if (wantNewChat || !forWs.length) {
            const fresh = createConversation(workspacePath, selectedAgentId);
            forWs = [fresh, ...forWs.filter(c => c.id !== fresh.id)];
            active = fresh.id;
          } else if (!forWs.some(c => c.id === active)) {
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
        markChatsSaved();
        return next;
      });
    })();
    return () => {
      cancelled = true;
      if (loadedWorkspaceRef.current === key) loadedWorkspaceRef.current = '';
    };
  }, [workspacePath, workspaceEpoch, markChatsSaved]);

  // Sidebar Drag-Resize Listeners
  useEffect(() => {
    if (!resizingSide) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (resizingSide === 'explorer') {
        const nextWidth = Math.max(160, Math.min(540, e.clientX));
        setExplorerWidth(nextWidth);
      } else if (resizingSide === 'chat') {
        const nextWidth = Math.max(480, Math.min(1100, window.innerWidth - e.clientX));
        setChatWidth(nextWidth);
      }
    };

    const handleMouseUp = () => {
      setResizingSide(null);
      updateSettings({ explorerWidth, chatWidth, agentControlWidth });
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingSide, explorerWidth, chatWidth, agentControlWidth, updateSettings]);

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

  const handleNewChat = () => {
    const fresh = createConversation(workspacePath, selectedAgentId);
    setActiveConversationId(fresh.id);
    setSettings(prev => {
      const next = {
        ...prev,
        conversations: upsertConversation(prev.conversations, fresh),
        activeConversationId: fresh.id
      };
      if (window.electronAPI) {
        window.electronAPI.saveSettings(next);
        if (workspacePath) {
          window.electronAPI.saveProjectChats(workspacePath, {
            conversations: conversationsForWorkspace(next.conversations, workspacePath),
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

    // Prefer scoped agent write so paths cannot escape the open workspace
    const scoped = await window.electronAPI.execTool(workspacePath, 'write_file', {
      path: clampWritePath(workspacePath, filePath),
      content
    });
    if (scoped.error) {
      console.error('Scoped write failed:', scoped.error);
      return false;
    }

    const absolutePath = scoped.path || (filePath.includes(':') ? filePath : `${workspacePath}\\${filePath.replace(/^[\\/]+/, '')}`);
    await loadDirectory(workspacePath);
    setOpenTabs(prev => {
      const idx = prev.findIndex(t => t.path === absolutePath);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], content, originalContent: content, isDirty: false };
        return updated;
      }
      const fileName = absolutePath.split(/[\\/]/).pop() || 'file';
      const newTab: OpenTab = {
        path: absolutePath,
        name: fileName,
        content,
        originalContent: content,
        isDirty: false,
        language: getLanguageFromPath(absolutePath)
      };
      return [...prev, newTab];
    });
    setActiveTabPath(absolutePath);
    return true;
  };

  const handleExecuteToolCommand = async (command: string): Promise<string> => {
    setIsTerminalOpen(true);
    if (!window.electronAPI || !workspacePath) return '';
    const res = await window.electronAPI.execTool(workspacePath, 'run_command', { command });
    return res.content || res.error || '';
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
    updateSettings({
      localTokensGenerated: (settings.localTokensGenerated || 0) + localCount,
      frontierTokensUsed: (settings.frontierTokensUsed || 0) + frontierCount
    });
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
    onSelectConversation: handleSelectConversation,
    onDeleteConversation: handleDeleteConversation,
    onToggleModelThinking: handleToggleModelThinking,
    searxngUrl: settings.searxngUrl || '',
    onBusyChange: handleAgentBusyChange
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
      {/* Top Header — hide dense chrome on very small screens */}
      <div className={isNarrow ? 'shrink-0' : undefined}>
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
          localTokens={settings.localTokensGenerated || 0}
          frontierTokens={settings.frontierTokensUsed || 0}
          uiScale={uiScale}
          onUpdateUiScale={handleUpdateUiScale}
          appVersion={appVersion}
          compact={isNarrow}
        />
      </div>
      <UpdateBanner />

      {isRemoteClient && (
        <div className="shrink-0 px-3 py-1 bg-indigo-950/70 border-b border-indigo-500/25 text-[10px] text-indigo-100/90 flex items-center gap-2">
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              remoteLive ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]' : 'bg-amber-400 animate-pulse'
            }`}
          />
          <span className="truncate">
            {remoteLive
              ? 'Connected to Studio host — cluster status is live'
              : 'Connecting to Studio host…'}
          </span>
        </div>
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
        localTokens={settings.localTokensGenerated || 0}
        frontierTokens={settings.frontierTokensUsed || 0}
        uiScale={uiScale}
        onUpdateUiScale={handleUpdateUiScale}
        searxngUrl={settings.searxngUrl || ''}
        onUpdateSearxngUrl={url => updateSettings({ searxngUrl: url })}
      />
    </div>
  );
};
