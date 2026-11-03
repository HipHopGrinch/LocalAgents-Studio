/**
 * Host API: Electron preload in-desktop, WebSocket RPC in the browser web console.
 */
import type { ElectronAPI } from '../types';

const TOKEN_KEY = 'la_web_console_token';

export function isWebConsoleClient(): boolean {
  return typeof window !== 'undefined' && !(window as Window & { electronAPI?: ElectronAPI }).electronAPI;
}

export function getStoredWebToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredWebToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

type RpcResult = { type: 'rpc-result'; id: number; result?: unknown; error?: string };
type EventMsg = { type: 'event'; channel: string; payload: unknown };

function downloadTextFile(fileName: string, content: string) {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName || 'download.enc';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function pickTextFile(): Promise<string | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.enc,.json,application/json,text/plain';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      resolve(await file.text());
    };
    input.click();
  });
}

function showPathNotice(title: string, pathValue?: string) {
  const text = pathValue || '(unavailable)';
  window.prompt(`${title}\n\nCopy path:`, text);
}

export async function loginWebConsole(password: string): Promise<{ token: string } | { error: string }> {
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error || `Login failed (${res.status})` };
    if (!data.token) return { error: 'No session token returned' };
    return { token: data.token as string };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function logoutWebConsole(token?: string | null) {
  const t = token ?? getStoredWebToken();
  try {
    await fetch('/api/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: t })
    });
  } catch {
    /* ignore */
  }
  setStoredWebToken(null);
}

/** Build a full ElectronAPI that talks to the Studio host over WebSocket. */
export function createWebHostApi(token: string): Promise<ElectronAPI> {
  return new Promise((resolve, reject) => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws?token=${encodeURIComponent(token)}`);
    let nextId = 1;
    const pending = new Map<
      number,
      { resolve: (v: unknown) => void; reject: (e: Error) => void }
    >();
    const listeners = new Map<string, Set<(payload: unknown) => void>>();
    let opened = false;
    let cssZoom = 1;

    const subscribe = (channel: string, cb: (payload: unknown) => void) => {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel)!.add(cb);
      return () => listeners.get(channel)?.delete(cb);
    };

    const invoke = <T = unknown>(method: string, args: unknown[] = []): Promise<T> =>
      new Promise((res, rej) => {
        if (ws.readyState !== WebSocket.OPEN) {
          rej(new Error('Web console disconnected'));
          return;
        }
        const id = nextId++;
        pending.set(id, {
          resolve: v => res(v as T),
          reject: rej
        });
        ws.send(JSON.stringify({ type: 'rpc', id, method, args }));
      });

    ws.addEventListener('message', ev => {
      let msg: RpcResult | EventMsg | { type: string };
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.type === 'rpc-result') {
        const m = msg as RpcResult;
        const p = pending.get(m.id);
        if (!p) return;
        pending.delete(m.id);
        if (m.error) p.reject(new Error(m.error));
        else p.resolve(m.result);
        return;
      }
      if (msg.type === 'event') {
        const m = msg as EventMsg;
        const set = listeners.get(m.channel);
        if (set) for (const cb of set) cb(m.payload);
      }
    });

    ws.addEventListener('close', () => {
      for (const [, p] of pending) p.reject(new Error('Web console disconnected'));
      pending.clear();
      if (!opened) reject(new Error('Failed to connect web console'));
    });

    ws.addEventListener('error', () => {
      if (!opened) reject(new Error('Web console WebSocket error'));
    });

    const api: ElectronAPI = {
      setZoomFactor: factor => {
        if (typeof factor === 'number' && factor >= 0.5 && factor <= 3) {
          cssZoom = factor;
          document.documentElement.style.zoom = String(factor);
        }
      },
      getZoomFactor: () => cssZoom,

      loadSettings: () => invoke('settings:load'),
      saveSettings: s => invoke('settings:save', [s]),
      settingsPath: () => invoke('settings:path'),
      openSettingsFolder: async () => {
        const res = await invoke<{ success?: boolean; path?: string; error?: string }>(
          'settings:openFolder'
        );
        showPathNotice('Settings folder (on Studio host)', res.path);
        return res;
      },
      writeLog: (level, message) => invoke('logs:write', [level, message]),
      readLogTail: () => invoke('logs:readTail'),
      logsPath: () => invoke('logs:path'),
      openLogsFolder: async () => {
        const res = await invoke<{ success?: boolean; path?: string; error?: string }>(
          'logs:openFolder'
        );
        showPathNotice('Logs folder (on Studio host)', res.path);
        return res;
      },
      reportLogsToGitHub: opts => invoke('logs:reportToGitHub', [opts || {}]),

      exportNodes: async (nodes, passphrase) => {
        const res = await invoke<{
          success?: boolean;
          canceled?: boolean;
          content?: string;
          fileName?: string;
          path?: string;
          nodeCount?: number;
          error?: string;
        }>('settings:exportNodes', [{ nodes, passphrase }]);
        if (res.content && res.fileName) downloadTextFile(res.fileName, res.content);
        return res;
      },
      importNodes: async passphrase => {
        const fileContent = await pickTextFile();
        if (fileContent == null) return { canceled: true };
        return invoke('settings:importNodes', [{ passphrase, fileContent }]);
      },

      getDefaultWorkspace: () => invoke('workspace:default'),
      loadProjectChats: root => invoke('project:loadChats', [root]),
      saveProjectChats: (root, payload) => invoke('project:saveChats', [root, payload]),
      selectFolder: async () => {
        const typed = window.prompt(
          'Enter a folder path on the Studio host PC (e.g. C:\\\\Users\\\\you\\\\Projects\\\\MyApp):'
        );
        if (!typed) return null;
        const res = await invoke<{ path?: string; error?: string }>('workspace:resolve-path', [
          typed.trim()
        ]);
        if (res.error || !res.path) {
          window.alert(res.error || 'Invalid folder');
          return null;
        }
        return res.path;
      },
      readDir: dirPath => invoke('fs:read-dir', [dirPath]),
      readFile: filePath => invoke('fs:read-file', [filePath]),
      writeFile: (filePath, content) => invoke('fs:write-file', [filePath, content]),
      createFile: filePath => invoke('fs:create-file', [filePath]),
      createFolder: folderPath => invoke('fs:create-folder', [folderPath]),
      deleteTarget: targetPath => invoke('fs:delete', [targetPath]),
      revealInExplorer: async targetPath => {
        await invoke('fs:reveal', [targetPath]);
        showPathNotice('Path on Studio host', targetPath);
      },

      execTool: (root, name, args) => invoke('tools:exec', [root, name, args]),
      typecheckWorkspace: (root, opts) => invoke('workspace:typecheck', [root, opts]),
      webSearch: (baseUrl, query) => invoke('web:search', [baseUrl, query]),
      generateImage: (url, model, prompt) => invoke('image:generate', [url, model, prompt]),

      executeCommand: (command, cwd) => invoke('terminal:execute', [command, cwd]),
      killCommand: () => invoke('terminal:kill'),
      getTerminalBuffer: opts => invoke('terminal:getBuffer', [opts]),
      clearTerminalBuffer: () => invoke('terminal:clearBuffer'),
      onTerminalOutput: cb => subscribe('terminal:output', p => cb(p as string)),
      onTerminalState: cb => subscribe('terminal:state', p => cb(p as { running: boolean })),

      clusterStatus: nodes => invoke('ollama:status', [nodes]),
      chat: (requestId, url, body, nodeType, apiKey) =>
        invoke('ollama:chat', [requestId, url, body, nodeType, apiKey]),
      benchmarkModel: (node, model) => invoke('ollama:benchmark', [node, model]),
      onChatEvent: cb => subscribe('ollama:chat-event', p => cb(p as never)),
      pullModel: (requestId, url, model) => invoke('ollama:pull', [requestId, url, model]),
      onPullEvent: cb => subscribe('ollama:pull-event', p => cb(p as never)),
      abortStream: requestId => invoke('ollama:abort', [requestId]),
      deleteModel: (url, model) => invoke('ollama:delete', [url, model]),
      setKeepAlive: (url, model, keepAlive) => invoke('ollama:keepalive', [url, model, keepAlive]),
      registryLookup: tag => invoke('registry:lookup', [tag]),
      showModel: (url, model) => invoke('ollama:show', [url, model]),

      getAppVersion: () => invoke('app:getVersion'),
      detectHardware: () => invoke('system:detect-hardware'),

      getUpdateStatus: () => invoke('update:getStatus'),
      checkForUpdate: () => invoke('update:check'),
      downloadUpdate: () => invoke('update:download'),
      installUpdate: async () => {
        window.alert('Installing updates is only available in the Studio desktop app.');
        return invoke('update:getStatus');
      },
      setUpdateBusy: busy => invoke('update:setBusy', [busy]),
      onUpdateStatus: cb => subscribe('update:status', p => cb(p as never)),

      webConsoleGetStatus: () => invoke('webConsole:getStatus'),
      webConsoleUpdate: patch => invoke('webConsole:update', [patch]),
      webConsoleSetPassword: password => invoke('webConsole:setPassword', [password])
    };

    const finish = () => {
      if (opened) return;
      opened = true;
      resolve(api);
    };
    if (ws.readyState === WebSocket.OPEN) finish();
    else ws.addEventListener('open', finish, { once: true });
  });
}

export function getHostAPI(): ElectronAPI {
  const api = (window as Window & { electronAPI?: ElectronAPI }).electronAPI;
  if (!api) throw new Error('Host API not ready');
  return api;
}

export async function bootHostApi(): Promise<'electron' | 'web'> {
  if ((window as Window & { electronAPI?: ElectronAPI }).electronAPI) {
    return 'electron';
  }
  throw new Error('WEB_LOGIN_REQUIRED');
}
