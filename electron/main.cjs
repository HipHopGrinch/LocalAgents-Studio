// LocalAgents Studio - Electron main process
// Owns everything privileged: filesystem, PowerShell, and all network calls to Ollama nodes.
// The renderer runs sandboxed with webSecurity on and talks to this file only via IPC (see preload.cjs).

const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const webConsole = require('./webConsole.cjs');
const {
  sanitizePackageJsonContent,
  sanitizePackageJsonObject,
  isPackageJsonPath
} = require('./npmDeps.cjs');
const { mcpStdio, parseMcpServers, killTracked: killTrackedMcp } = require('./mcpClient.cjs');
const {
  resolveJailedPath,
  recheckJailedLeaf,
  mergeWebNodeList,
  pathsEqual,
  agentCommandBlockReason
} = require('./sandbox.cjs');
const { buildGitArgv, scrubGitEnv } = require('./gitGuard.cjs');

/** Releases are unsigned until a real publisher cert is wired up. */
const VERIFY_UPDATE_CODE_SIGNATURE = false;
const API_KEY_ENC_VERSION = 1;
const STREAM_IDLE_MS = 120_000;
const STREAM_ABSOLUTE_MS = 15 * 60 * 1000;
const OUTPUT_CAP_BYTES = 1024 * 1024;
const READ_CAP_BYTES = 5 * 1024 * 1024;
const TAGS_TTL_MS = 3 * 60 * 1000;
const MODELS_TTL_MS = 5 * 60 * 1000;
const PS_TTL_MS = 5 * 1000;
/** Ceiling for frontier max_tokens. Local num_predict below this is kept. */
const FRONTIER_MAX_OUTPUT_TOKENS = 8192;

// Per-user settings live under AppData — NEVER inside the install dir or portable EXE.
// Must be set before app.ready().
(() => {
  const appData = app.getPath('appData');
  const userDataDir = path.join(appData, 'LocalAgents Studio');
  const legacyDir = path.join(appData, 'local-agents-ide');
  app.setPath('userData', userDataDir);
  try {
    if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });
    const nextSettings = path.join(userDataDir, 'settings.json');
    const legacySettings = path.join(legacyDir, 'settings.json');
    if (!fs.existsSync(nextSettings) && fs.existsSync(legacySettings)) {
      fs.copyFileSync(legacySettings, nextSettings);
    }
  } catch (err) {
    console.warn('userData setup:', err.message);
  }
})();

let mainWindow = null;

// ==========================================
// WINDOW
// ==========================================

function createWindow() {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.localagents.studio');
  }

  const windowIcon = path.join(__dirname, 'icon.ico');
  const appTitle = `LocalAgents Studio ${app.getVersion()}`;
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1100,
    minHeight: 640,
    backgroundColor: '#18181b',
    title: appTitle,
    icon: fs.existsSync(windowIcon) ? windowIcon : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });

  const distIndex = path.join(__dirname, '../dist/index.html');
  const useDevServer = process.env.VITE_DEV_SERVER === 'true' && !app.isPackaged;
  if (useDevServer || (!app.isPackaged && !fs.existsSync(distIndex))) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(distIndex);
  }

  // Warnings and errors go to the feedback log and, when present, the launching terminal.
  // Electron 35+ puts these fields on the event; positional args were removed in 47.
  mainWindow.webContents.on('console-message', ({ level, message, lineNumber, sourceId }) => {
    if (level !== 'warning' && level !== 'error') return;
    const label = level === 'error' ? 'error' : 'warn';
    const text = `[renderer] ${message} (${sourceId}:${lineNumber})`;
    if (level === 'error') console.error(text);
    else console.warn(text);
    appendLog(label, text);
  });

  // Open external links in the default browser instead of inside the app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  installNavigationGuard(mainWindow);
}

let quitDrainStarted = false;
function drainChildrenAndExit(code) {
  if (quitDrainStarted) {
    try {
      app.exit(code);
    } catch {
      /* already leaving */
    }
    return;
  }
  quitDrainStarted = true;
  const exit = () => {
    try {
      app.exit(code);
    } catch {
      process.exit(code);
    }
  };
  try {
    webConsole.stopServer();
  } catch {
    /* ignore */
  }
  const cap = new Promise(resolve => setTimeout(resolve, 2000));
  Promise.race([Promise.resolve().then(() => killAllProcesses()), cap]).then(exit, exit);
}

process.on('uncaughtException', err => {
  const text = err && err.stack ? err.stack : String(err);
  try {
    appendLog('error', `uncaughtException: ${text}`);
  } catch {
    /* logging itself failed */
  }
  const exit = () => drainChildrenAndExit(1);
  try {
    Promise.resolve(typeof logChain !== 'undefined' ? logChain : null).then(exit, exit);
  } catch {
    exit();
  }
  setTimeout(exit, 1500);
});
process.on('unhandledRejection', reason => {
  const text = reason && reason.stack ? reason.stack : String(reason);
  appendLog('error', `unhandledRejection: ${text}`);
});

app.whenReady().then(async () => {
  createWindow();
  setupAutoUpdater();
  try {
    await migratePlaintextApiKeys();
    const saved = await readSettingsFile();
    if (saved?.lastWorkspace) pinWorkspaceRoot(saved.lastWorkspace);
    if (saved?.webConsole) await webConsole.applyConfig(saved.webConsole);
  } catch (err) {
    appendLog('warn', `web console autostart: ${err.message}`);
  }
});
app.on('window-all-closed', () => {
  drainChildrenAndExit(0);
});
app.on('before-quit', event => {
  if (quitDrainStarted) return;
  event.preventDefault();
  drainChildrenAndExit(0);
});

function contentSecurityPolicy() {
  const dev = process.env.VITE_DEV_SERVER === 'true' && !app.isPackaged;
  const devSrc = dev ? ' http://localhost:5173 http://127.0.0.1:5173 ws://localhost:5173 ws://127.0.0.1:5173' : '';
  // unsafe-eval is only for the Vite dev server (HMR). Production relies on the
  // build-time meta CSP as well; packaged file:// loads do not get this header.
  const scriptEval = dev ? " 'unsafe-eval'" : '';
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${scriptEval}${devSrc}`,
    `style-src 'self' 'unsafe-inline'${devSrc}`,
    "img-src 'self' data: blob:",
    "font-src 'self' data: blob:",
    `connect-src 'self'${devSrc}`,
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'"
  ].join('; ');
}

function fileUrlToPath(url) {
  const u = new URL(url);
  let pathname = decodeURIComponent(u.pathname || '');
  if (process.platform === 'win32' && /^\/[A-Za-z]:/.test(pathname)) pathname = pathname.slice(1);
  return path.normalize(pathname);
}

function realpathOrNull(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return null;
  }
}

/** Only the packaged UI or the Vite dev server may navigate the privileged window. */
function isAllowedAppNavigation(url) {
  try {
    const u = new URL(String(url || ''));
    if (u.protocol === 'file:') {
      const distDir = path.resolve(__dirname, '../dist');
      const distReal = realpathOrNull(distDir) || distDir;
      const resolved = path.resolve(fileUrlToPath(url));
      const fileReal = realpathOrNull(resolved);
      // asar paths sometimes refuse realpath; compare lexically only then.
      if (!fileReal && !resolved.toLowerCase().includes('.asar')) return false;
      const root = fileReal ? distReal : distDir;
      const candidate = fileReal || resolved;
      const rel = path.relative(root, candidate);
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    }
    if ((u.protocol === 'http:' || u.protocol === 'ws:') && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) {
      return u.port === '5173' && process.env.VITE_DEV_SERVER === 'true' && !app.isPackaged;
    }
    return false;
  } catch {
    return false;
  }
}

function ipcSenderUrl(event) {
  try {
    const frame = event && event.senderFrame;
    if (frame && typeof frame.url === 'string' && frame.url) return frame.url;
  } catch {
    /* frame already destroyed */
  }
  try {
    if (event && event.sender && typeof event.sender.getURL === 'function') return event.sender.getURL();
  } catch {
    /* webContents already destroyed */
  }
  return '';
}

function installNavigationGuard(win) {
  const block = (event, url) => {
    if (isAllowedAppNavigation(url)) return;
    event.preventDefault();
    appendLog('warn', `Blocked navigation to ${url}`);
  };
  win.webContents.on('will-navigate', block);
  win.webContents.on('will-redirect', block);
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...(details.responseHeaders || {}) };
    headers['Content-Security-Policy'] = [contentSecurityPolicy()];
    callback({ responseHeaders: headers });
  });
}

/** IPC handlers registered for both Electron preload and the web console WS bridge. */
const rpcHandlers = new Map();
const _ipcHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => {
  rpcHandlers.set(channel, listener);
  return _ipcHandle(channel, async (event, ...args) => {
    if (event && event.webConsole) return listener(event, ...args);
    const frameUrl = ipcSenderUrl(event);
    if (!isAllowedAppNavigation(frameUrl)) {
      appendLog('warn', `IPC ${channel} rejected untrusted sender`);
      throw new Error('IPC rejected: untrusted sender');
    }
    return listener(event, ...args);
  });
};

async function invokeRpc(channel, args = []) {
  const listener = rpcHandlers.get(channel);
  if (!listener) throw new Error(`Unknown method: ${channel}`);
  return listener({ webConsole: true }, ...(Array.isArray(args) ? args : []));
}

const send = (channel, payload) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  const webPayload =
    channel === 'session:changed' && payload && typeof payload === 'object'
      ? { ...payload, nodes: stripNodeApiKeys(payload.nodes) }
      : payload;
  webConsole.broadcast(channel, webPayload);
};

webConsole.init({
  invokeRpc,
  getDistDir: () => path.join(__dirname, '../dist'),
  getViteDevUrl: () =>
    process.env.VITE_DEV_SERVER === 'true' && !app.isPackaged ? 'http://127.0.0.1:5173' : null,
  appendLog: (level, message) => appendLog(level, message)
});

// ==========================================
// SETTINGS PERSISTENCE (userData/settings.json)
// Outside the app package — e.g. %APPDATA%\LocalAgents Studio\settings.json
// ==========================================

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

/** Serialize overlapping atomic writes to the same path. */
const writeQueues = new Map();
function withWriteLock(filePath, fn) {
  const key = path.resolve(String(filePath || ''));
  const prev = writeQueues.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  writeQueues.set(
    key,
    next.then(
      () => {},
      () => {}
    )
  );
  return next;
}

function uniqueTmpPath(filePath) {
  return `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
}

/** Desktop-chosen workspace. Web clients and agent tools cannot retarget it. */
let activeWorkspaceRoot = '';

/**
 * Electron 43+ opens file dialogs in Downloads when `defaultPath` is omitted,
 * and no longer restores the last OS directory. Remember it ourselves.
 */
let lastDialogDir = '';

function rememberDialogPath(chosen) {
  if (!chosen) return;
  try {
    const abs = path.resolve(String(chosen));
    lastDialogDir = fs.existsSync(abs) && fs.statSync(abs).isDirectory() ? abs : path.dirname(abs);
  } catch {
    /* ignore */
  }
}

function dialogDefaultPath(fileName) {
  const dir = lastDialogDir || activeWorkspaceRoot || '';
  if (fileName && dir) return path.join(dir, fileName);
  return fileName || dir || undefined;
}

function pinWorkspaceRoot(dirPath) {
  const resolved = path.resolve(String(dirPath || '').trim());
  if (!resolved) return '';
  try {
    const real = fs.realpathSync(resolved);
    if (!fs.statSync(real).isDirectory()) return activeWorkspaceRoot;
    activeWorkspaceRoot = real;
    return real;
  } catch {
    return activeWorkspaceRoot;
  }
}

/** @deprecated name kept for call sites; only the desktop pin is stored. */
function rememberWorkspaceRoot(dirPath) {
  return pinWorkspaceRoot(dirPath);
}

function workspaceRoots() {
  return activeWorkspaceRoot ? [activeWorkspaceRoot] : [];
}

function assertWithinWorkspace(targetPath, opts = {}) {
  const roots = workspaceRoots();
  if (!roots.length) throw new Error('No workspace folder is open');
  let lastErr = null;
  for (const root of roots) {
    try {
      return resolveJailedPath(root, targetPath, { allowRoot: !!opts.allowRoot });
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Path is outside the open workspace');
}

async function encryptionAvailable() {
  try {
    return !!(safeStorage && (await safeStorage.isAsyncEncryptionAvailable()));
  } catch {
    return false;
  }
}

async function encryptApiKey(plain) {
  if (!plain || !(await encryptionAvailable())) return '';
  try {
    const encrypted = await safeStorage.encryptStringAsync(String(plain));
    const buf = Buffer.isBuffer(encrypted)
      ? encrypted
      : Buffer.from(encrypted && encrypted.result != null ? encrypted.result : encrypted);
    return buf.toString('base64');
  } catch (err) {
    appendLog('warn', `apiKey encrypt failed: ${err.message}`);
    return '';
  }
}

const reEncryptAt = new Map();
let reEncryptChain = Promise.resolve();

function plainFromDecrypt(out) {
  if (typeof out === 'string') return { plain: out, shouldReEncrypt: false };
  if (out && typeof out.result === 'string') {
    return { plain: out.result, shouldReEncrypt: out.shouldReEncrypt === true };
  }
  return { plain: '', shouldReEncrypt: false };
}

/** Replace one stored blob only after the settings write succeeds. */
async function persistReEncryptedApiKey(oldEnc, newEnc) {
  if (!newEnc || newEnc === oldEnc) return false;
  const file = settingsPath();
  return withWriteLock(file, async () => {
    const data = await readSettingsForMutation();
    if (!data || !Array.isArray(data.nodes)) return false;
    let changed = false;
    for (const node of data.nodes) {
      if (node && node.apiKeyEnc === oldEnc) {
        node.apiKeyEnc = newEnc;
        node.apiKeyEncV = API_KEY_ENC_VERSION;
        if (node.apiKey) delete node.apiKey;
        changed = true;
      }
    }
    if (!changed) return false;
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await writeSettingsBody(file, data);
    return true;
  });
}

async function decryptApiKey(enc) {
  if (!enc || !(await encryptionAvailable())) return '';
  try {
    const buf = Buffer.from(String(enc), 'base64');
    let { plain, shouldReEncrypt } = plainFromDecrypt(await safeStorage.decryptStringAsync(buf));
    if (shouldReEncrypt) {
      try {
        const again = plainFromDecrypt(await safeStorage.decryptStringAsync(buf));
        if (again.plain) plain = again.plain;
      } catch {
        /* keep the first plaintext */
      }
    }
    if (!plain) return '';
    if (shouldReEncrypt) {
      const key = String(enc);
      const now = Date.now();
      if (now - (reEncryptAt.get(key) || 0) > 60_000) {
        reEncryptAt.set(key, now);
        reEncryptChain = reEncryptChain
          .catch(() => {})
          .then(async () => {
            try {
              const next = await encryptApiKey(plain);
              if (!next) return;
              const wrote = await persistReEncryptedApiKey(key, next);
              if (wrote) appendLog('info', 'Re-encrypted an API key after OS key rotation');
              else appendLog('warn', 'API key re-encrypt did not persist; stored blob left unchanged');
            } catch (err) {
              appendLog('warn', `API key re-encrypt failed: ${err.message || err}`);
            }
          });
      }
    }
    return plain;
  } catch (err) {
    appendLog('warn', `apiKey decrypt failed: ${err.message}`);
    return '';
  }
}

async function decryptStoredKey(node) {
  if (!node || typeof node !== 'object') return '';
  if (typeof node.apiKey === 'string' && node.apiKey && node.apiKey !== '********') return node.apiKey;
  if (node.apiKeyEnc) return decryptApiKey(node.apiKeyEnc);
  return '';
}

/** Persist apiKey as apiKeyEnc when DPAPI is available. */
async function sealNode(node, prev) {
  if (!node || typeof node !== 'object') return node;
  const { apiKey, apiKeyEnc, apiKeyEncV, hasApiKey, ...rest } = node;
  const plain =
    (apiKey && apiKey !== '********' ? String(apiKey) : '') ||
    (await decryptStoredKey(prev)) ||
    (await decryptStoredKey({ apiKeyEnc }));
  if (plain) {
    const enc = await encryptApiKey(plain);
    if (enc) return { ...rest, apiKeyEnc: enc, apiKeyEncV: API_KEY_ENC_VERSION };
    return { ...rest, apiKey: plain };
  }
  const enc = apiKeyEnc || prev?.apiKeyEnc;
  if (enc) return { ...rest, apiKeyEnc: enc, apiKeyEncV: apiKeyEncV || prev?.apiKeyEncV || API_KEY_ENC_VERSION };
  if (prev?.apiKey) return { ...rest, apiKey: prev.apiKey };
  return rest;
}

/** Web mirrors never receive key material. Presence does not require a decrypt. */
function redactNodeForWeb(node) {
  if (!node || typeof node !== 'object') return node;
  const { apiKey, apiKeyEnc, apiKeyEncV, ...rest } = node;
  return { ...rest, hasApiKey: !!(apiKey || apiKeyEnc || node.hasApiKey) };
}

function stripNodeApiKeys(nodes) {
  if (!Array.isArray(nodes)) return nodes;
  return nodes.map(redactNodeForWeb);
}

function stripSecretsForWeb(data) {
  if (!data || typeof data !== 'object') return data;
  const out = { ...data };
  if (out.webConsole) {
    const wc = out.webConsole;
    out.webConsole = {
      enabled: !!wc.enabled,
      port: wc.port || webConsole.DEFAULT_PORT,
      lanEnabled: !!wc.lanEnabled,
      allowShell: !!wc.allowShell,
      tlsCertPath: wc.tlsCertPath || '',
      tlsKeyPath: wc.tlsKeyPath || ''
    };
  }
  if (Array.isArray(out.nodes)) out.nodes = stripNodeApiKeys(out.nodes);
  return out;
}

async function presentSettings(data, forWeb) {
  if (!data || typeof data !== 'object') return data;
  if (forWeb) return stripSecretsForWeb({ ...data });
  const out = { ...data };
  if (Array.isArray(out.nodes)) {
    out.nodes = await Promise.all(
      out.nodes.map(async node => {
        if (!node || typeof node !== 'object') return node;
        const plain = await decryptStoredKey(node);
        const { apiKey, apiKeyEnc, apiKeyEncV, ...rest } = node;
        const hasApiKey = !!(plain || apiKey || apiKeyEnc || node.hasApiKey);
        if (plain) return { ...rest, apiKey: plain };
        return { ...rest, hasApiKey };
      })
    );
  }
  return out;
}

async function readSettingsFile() {
  const file = settingsPath();
  try {
    return JSON.parse(await fsp.readFile(file, 'utf-8'));
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    try {
      return JSON.parse(await fsp.readFile(`${file}.bak`, 'utf-8'));
    } catch {
      return null;
    }
  }
}

/**
 * Read settings for a write. Missing file yields {}. Corrupt JSON throws so we
 * never replace the cluster with {}.
 */
async function readSettingsForMutation() {
  const file = settingsPath();
  let raw;
  try {
    raw = await fsp.readFile(file, 'utf-8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return {};
    const bak = await fsp.readFile(`${file}.bak`, 'utf-8').catch(() => null);
    if (bak) {
      try {
        return JSON.parse(bak);
      } catch {
        throw new Error('settings.json is unreadable and the backup is invalid; save aborted');
      }
    }
    throw new Error('settings.json is unreadable; save aborted');
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not-json');
    }
    return parsed;
  } catch (err) {
    if (err && /save aborted/.test(err.message || '')) throw err;
    const bak = await fsp.readFile(`${file}.bak`, 'utf-8').catch(() => null);
    if (bak) {
      try {
        const parsed = JSON.parse(bak);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      } catch {
        /* backup is also bad */
      }
    }
    throw new Error('settings.json is invalid JSON; save aborted');
  }
}

async function writeSettingsBody(file, settings) {
  try {
    const current = await fsp.readFile(file, 'utf-8');
    const parsed = JSON.parse(current);
    if (parsed && typeof parsed === 'object') await fsp.copyFile(file, `${file}.bak`);
  } catch {
    /* missing or corrupt — do not clobber a good backup */
  }
  const tmp = uniqueTmpPath(file);
  await fsp.writeFile(tmp, JSON.stringify(settings, null, 2), 'utf-8');
  try {
    await fsp.rename(tmp, file);
  } catch {
    await fsp.copyFile(tmp, file);
    await fsp.unlink(tmp).catch(() => {});
  }
}

async function writeSettingsAtomic(settings) {
  const file = settingsPath();
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await withWriteLock(file, () => writeSettingsBody(file, settings));
}

async function migratePlaintextApiKeys() {
  if (!(await encryptionAvailable())) return;
  let data;
  try {
    data = await readSettingsForMutation();
  } catch (err) {
    appendLog('warn', `settings migrate skipped: ${err.message}`);
    return;
  }
  if (!data || !Array.isArray(data.nodes)) return;
  let changed = false;
  const nextNodes = [];
  for (const n of data.nodes) {
    if (n && n.apiKey && !n.apiKeyEnc) {
      const sealed = await sealNode(n, null);
      if (sealed && sealed.apiKeyEnc && !sealed.apiKey) {
        changed = true;
        nextNodes.push(sealed);
        continue;
      }
    }
    nextNodes.push(n);
  }
  data.nodes = nextNodes;
  if (changed) {
    await writeSettingsAtomic(data);
    appendLog('info', 'Migrated frontier API keys to OS credential storage');
  }
}

function normalizeNodeUrl(u) {
  return String(u || '').trim().replace(/\/+$/, '').toLowerCase();
}

function webShellDenial(e) {
  if (e?.webConsole && !webConsole.allowShell()) {
    return 'Shell and delete tools are disabled for the web console';
  }
  return null;
}

async function configuredNodeUrlSet() {
  const data = await readSettingsFile();
  const nodes = Array.isArray(data?.nodes) ? data.nodes : [];
  return new Set(nodes.map(n => normalizeNodeUrl(n && n.url)).filter(Boolean));
}

async function webNodeUrlDenial(e, url) {
  if (!e?.webConsole) return null;
  const want = normalizeNodeUrl(url);
  if (!want) return 'URL is not a configured cluster node';
  const allowed = await configuredNodeUrlSet();
  return allowed.has(want) ? null : 'URL is not a configured cluster node';
}

/** Web clients must not supply API keys. A stored key is released only when the URL matches. */
async function resolveApiKeyForRequest(e, url, apiKey, nodeId) {
  if (!e?.webConsole) return apiKey || '';
  const data = await readSettingsFile();
  const nodes = Array.isArray(data?.nodes) ? data.nodes : [];
  const want = normalizeNodeUrl(url);
  if (!want) return '';
  if (nodeId) {
    const byId = nodes.find(n => n && n.id === nodeId);
    if (!byId || normalizeNodeUrl(byId.url) !== want) return '';
    return decryptStoredKey(byId);
  }
  const byUrl = nodes.find(n => n && normalizeNodeUrl(n.url) === want);
  return byUrl ? decryptStoredKey(byUrl) : '';
}

ipcMain.handle('settings:load', async (e) => {
  try {
    const data = await readSettingsFile();
    if (!data) return null;
    return presentSettings(data, !!e?.webConsole);
  } catch {
    return null;
  }
});

ipcMain.handle('settings:save', async (e, settings) => {
  try {
    await fsp.mkdir(app.getPath('userData'), { recursive: true });
    let existing;
    try {
      existing = await readSettingsForMutation();
    } catch (err) {
      return { error: err.message || 'settings.json is invalid JSON; save aborted' };
    }
    if (!settings || typeof settings !== 'object') return { error: 'Invalid settings' };
      // Web console lifecycle is owned only by webConsole:update / setPassword / app startup.
      // Never let a renderer settings save flip enabled off or restart the HTTP server
      // (that was kicking LAN clients and clearing the Enable toggle).
      if (existing?.webConsole) {
        settings.webConsole = { ...existing.webConsole };
      } else {
        delete settings.webConsole;
      }
      // Web clients cannot change console privileges, MCP commands, or drop nodes.
      if (e?.webConsole) {
        if (existing && Object.prototype.hasOwnProperty.call(existing, 'mcpServersJson')) {
          settings.mcpServersJson = existing.mcpServersJson;
        } else {
          delete settings.mcpServersJson;
        }
        settings.nodes = mergeWebNodeList(existing?.nodes, settings.nodes);
      }
      // Guard against a second client racing with empty defaults and wiping the cluster.
      if (
        Array.isArray(existing?.nodes) &&
        existing.nodes.length > 0 &&
        (!Array.isArray(settings.nodes) || settings.nodes.length === 0)
      ) {
        settings.nodes = existing.nodes;
        appendLog('warn', 'settings:save refused empty nodes overwrite — kept existing cluster');
      }
      if (
        Array.isArray(existing?.agents) &&
        existing.agents.length > 0 &&
        (!Array.isArray(settings.agents) || settings.agents.length === 0)
      ) {
        settings.agents = existing.agents;
      }
      // Web clients persist a settings snapshot that can still say 0 tokens and
      // wipe the desktop counters. Never store a lower total from the web console.
      if (e?.webConsole && existing) {
        const keepHigher = key => {
          const prev = Number(existing[key]);
          const next = Number(settings[key]);
          if (Number.isFinite(prev) && (!Number.isFinite(next) || next < prev)) {
            settings[key] = prev;
          }
        };
        keepHigher('localTokensGenerated');
        keepHigher('frontierTokensUsed');
        if (existing.workspaceTokenUsage && typeof existing.workspaceTokenUsage === 'object') {
          const prevUsage = existing.workspaceTokenUsage;
          const nextUsage =
            settings.workspaceTokenUsage && typeof settings.workspaceTokenUsage === 'object'
              ? { ...settings.workspaceTokenUsage }
              : {};
          for (const [key, value] of Object.entries(prevUsage)) {
            const prevLocal = Number(value && value.localTokensGenerated) || 0;
            const prevFrontier = Number(value && value.frontierTokensUsed) || 0;
            const nextRow = nextUsage[key] || {};
            const nextLocal = Number(nextRow.localTokensGenerated) || 0;
            const nextFrontier = Number(nextRow.frontierTokensUsed) || 0;
            nextUsage[key] = {
              localTokensGenerated: Math.max(nextLocal, prevLocal),
              frontierTokensUsed: Math.max(nextFrontier, prevFrontier)
            };
          }
          settings.workspaceTokenUsage = nextUsage;
        }
      }
    const prevNodes = Array.isArray(existing?.nodes) ? existing.nodes : [];
    const sealed = {
      ...settings,
      nodes: Array.isArray(settings?.nodes)
        ? await Promise.all(
            settings.nodes.map(n => sealNode(n, prevNodes.find(p => p && n && p.id === n.id)))
          )
        : settings?.nodes
    };
    await writeSettingsAtomic(sealed);
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

// ==========================================
// LIVE SESSION (desktop ↔ web console remote control)
// ==========================================

function finiteTokenCount(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function tokenFieldsFromSettings(settings) {
  if (!settings || typeof settings !== 'object') return null;
  const local = finiteTokenCount(Number(settings.localTokensGenerated));
  const frontier = finiteTokenCount(Number(settings.frontierTokensUsed));
  const hasUsage =
    settings.workspaceTokenUsage &&
    typeof settings.workspaceTokenUsage === 'object' &&
    !Array.isArray(settings.workspaceTokenUsage);
  const scope =
    settings.tokenStatsScope === 'project' || settings.tokenStatsScope === 'global'
      ? settings.tokenStatsScope
      : null;
  if (local == null && frontier == null && !hasUsage && !scope) return null;
  return {
    localTokensGenerated: local != null ? local : 0,
    frontierTokensUsed: frontier != null ? frontier : 0,
    tokenStatsScope: scope || 'global',
    workspaceTokenUsage: hasUsage ? settings.workspaceTokenUsage : {}
  };
}

/** In-memory mirror of the Studio window so web clients attach to the same session. */
let liveSession = {
  updatedAt: 0,
  workspacePath: '',
  activeConversationId: null,
  selectedAgentId: 'coder',
  nodes: [],
  chatsRevision: 0,
  activeTabPath: null,
  openTabPaths: [],
  conductor: null,
  chatMirror: null,
  source: 'none',
  clientId: null
};

ipcMain.handle('session:get', (e) => {
  const snap = { ...liveSession };
  if (e?.webConsole) {
    return { ...snap, nodes: stripNodeApiKeys(snap.nodes) };
  }
  return snap;
});

ipcMain.handle('session:publish', (e, snapshot = {}) => {
  try {
    // Remotes may omit nodes (desktop owns cluster status). A web payload that still
    // includes an older node list must not re-enable models the desktop just disabled.
    const fromWeb = !!(e?.webConsole || snapshot.source === 'web');
    const nodes = fromWeb
      ? liveSession.nodes
      : Array.isArray(snapshot.nodes)
        ? stripNodeApiKeys(snapshot.nodes)
        : liveSession.nodes;
    const incomingRev =
      typeof snapshot.chatsRevision === 'number' ? snapshot.chatsRevision : liveSession.chatsRevision || 0;
    // Monotonic — a stale client must not roll chatsRevision backwards.
    const chatsRevision = Math.max(incomingRev, liveSession.chatsRevision || 0);
    // Desktop owns token totals. Web publishes omit them; a zero snapshot must not wipe the mirror.
    const incomingLocal = finiteTokenCount(snapshot.localTokensGenerated);
    const incomingFrontier = finiteTokenCount(snapshot.frontierTokensUsed);
    const prevLocal = finiteTokenCount(liveSession.localTokensGenerated);
    const prevFrontier = finiteTokenCount(liveSession.frontierTokensUsed);
    const localTokensGenerated = fromWeb
      ? prevLocal
      : incomingLocal != null
        ? incomingLocal
        : prevLocal;
    const frontierTokensUsed = fromWeb
      ? prevFrontier
      : incomingFrontier != null
        ? incomingFrontier
        : prevFrontier;
    let tokenStatsScope = liveSession.tokenStatsScope;
    if (
      !fromWeb &&
      (snapshot.tokenStatsScope === 'project' || snapshot.tokenStatsScope === 'global')
    ) {
      tokenStatsScope = snapshot.tokenStatsScope;
    }
    const incomingUsage =
      !fromWeb &&
      snapshot.workspaceTokenUsage &&
      typeof snapshot.workspaceTokenUsage === 'object' &&
      !Array.isArray(snapshot.workspaceTokenUsage)
        ? snapshot.workspaceTokenUsage
        : null;
    const workspaceTokenUsage = incomingUsage || liveSession.workspaceTokenUsage;
    if (!fromWeb && typeof snapshot.workspacePath === 'string' && snapshot.workspacePath.trim()) {
      pinWorkspaceRoot(snapshot.workspacePath);
    }
    const workspacePath = fromWeb
      ? liveSession.workspacePath
      : typeof snapshot.workspacePath === 'string'
        ? snapshot.workspacePath
        : liveSession.workspacePath;
    liveSession = {
      updatedAt: Date.now(),
      workspacePath,
      activeConversationId:
        snapshot.activeConversationId !== undefined
          ? snapshot.activeConversationId
          : liveSession.activeConversationId,
      selectedAgentId: snapshot.selectedAgentId || liveSession.selectedAgentId || 'coder',
      nodes,
      chatsRevision,
      activeTabPath:
        snapshot.activeTabPath !== undefined ? snapshot.activeTabPath : liveSession.activeTabPath || null,
      openTabPaths: Array.isArray(snapshot.openTabPaths)
        ? snapshot.openTabPaths
        : liveSession.openTabPaths || [],
      // Last writer wins for conductor / chat mirror (each publish carries full snapshot).
      conductor: snapshot.conductor !== undefined ? snapshot.conductor : liveSession.conductor,
      chatMirror: snapshot.chatMirror !== undefined ? snapshot.chatMirror : liveSession.chatMirror,
      ...(localTokensGenerated != null ? { localTokensGenerated } : {}),
      ...(frontierTokensUsed != null ? { frontierTokensUsed } : {}),
      ...(tokenStatsScope === 'project' || tokenStatsScope === 'global' ? { tokenStatsScope } : {}),
      ...(workspaceTokenUsage && typeof workspaceTokenUsage === 'object'
        ? { workspaceTokenUsage }
        : {}),
      source: snapshot.source || 'renderer',
      clientId: snapshot.clientId || liveSession.clientId || null
    };
    send('session:changed', { ...liveSession });
    // Avoid flooding studio.log on rapid node/tab publishes — sample meaningfully.
    if (
      snapshot.chatsRevision !== undefined ||
      snapshot.workspacePath !== undefined ||
      snapshot.activeConversationId !== undefined ||
      snapshot.activeTabPath !== undefined ||
      snapshot.conductor !== undefined
    ) {
      appendLog(
        'info',
        `session:publish ${liveSession.source || '?'} client=${String(liveSession.clientId || '').slice(0, 12)} ws=${liveSession.workspacePath || '(none)'} chat=${liveSession.activeConversationId || '(none)'} rev=${liveSession.chatsRevision} swarm=${liveSession.conductor?.isPipelineMode ? 1 : 0} stream=${liveSession.conductor?.isStreaming ? 1 : 0}`
      );
    }
    return { success: true, updatedAt: liveSession.updatedAt };
  } catch (err) {
    return { error: err.message || 'publish failed' };
  }
});

/** If the Electron window has not published yet, seed from settings.json for web clients. */
async function ensureLiveSessionSeeded() {
  try {
    const settings = (await readSettingsFile()) || {};
    const tokens = tokenFieldsFromSettings(settings);
    if (liveSession.updatedAt > 0 && Array.isArray(liveSession.nodes) && liveSession.nodes.length > 0) {
      if (
        tokens &&
        liveSession.localTokensGenerated == null &&
        liveSession.frontierTokensUsed == null
      ) {
        liveSession = { ...liveSession, ...tokens, updatedAt: Date.now() };
      }
      send('session:changed', { ...liveSession });
      return;
    }
    const nodes = stripNodeApiKeys(Array.isArray(settings.nodes) ? settings.nodes : []);
    liveSession = {
      updatedAt: Date.now(),
      workspacePath: settings.lastWorkspace || liveSession.workspacePath || '',
      activeConversationId: settings.activeConversationId || liveSession.activeConversationId || null,
      selectedAgentId: liveSession.selectedAgentId || 'coder',
      nodes,
      chatsRevision: liveSession.chatsRevision || 0,
      activeTabPath: liveSession.activeTabPath || null,
      openTabPaths: liveSession.openTabPaths || [],
      ...(tokens || {}),
      source: 'seed',
      clientId: null
    };
    send('session:changed', { ...liveSession });
  } catch (err) {
    appendLog('warn', `live session seed: ${err.message}`);
  }
}

webConsole.setHooks({
  onClientConnected: () => {
    void ensureLiveSessionSeeded();
  }
});

ipcMain.handle('settings:path', () => settingsPath());

ipcMain.handle('settings:openFolder', async () => {
  const dir = app.getPath('userData');
  await fsp.mkdir(dir, { recursive: true });
  const err = await shell.openPath(dir);
  return err ? { error: err } : { success: true, path: dir };
});

// ==========================================
// FEEDBACK LOG (userData/logs/studio.log)
// Rotates once at ~2 MB so a session can be pasted without a huge file.
// ==========================================

const LOG_MAX_BYTES = 2 * 1024 * 1024;
const LOG_TAIL_BYTES = 200 * 1024;

function logFilePath() {
  return path.join(app.getPath('userData'), 'logs', 'studio.log');
}

function redactLog(text) {
  return String(text || '')
    .replace(/sk-or-v1-[A-Za-z0-9_\-]+/g, 'sk-or-v1-[redacted]')
    .replace(/sk-[A-Za-z0-9_\-]{8,}/g, 'sk-[redacted]')
    .replace(/xai-[A-Za-z0-9_\-]+/gi, 'xai-[redacted]')
    .replace(/AIzaSy[A-Za-z0-9_\-]{20,}/g, 'AIzaSy[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._\-+/=]+/gi, 'Bearer [redacted]')
    .replace(/"apiKey"\s*:\s*"[^"]*"/gi, '"apiKey":"[redacted]"')
    .replace(/(api[_-]?key|token|password|passphrase|authorization)\s*[=:]\s*\S+/gi, '$1=[redacted]');
}

let logChain = Promise.resolve();

function appendLog(level, message) {
  const line = `${new Date().toISOString()} ${(level || 'info').toUpperCase()} ${redactLog(message).replace(/\s*\r?\n\s*/g, ' | ').slice(0, 4000)}\n`;
  logChain = logChain.then(async () => {
    const file = logFilePath();
    await fsp.mkdir(path.dirname(file), { recursive: true });
    try {
      const stat = await fsp.stat(file);
      if (stat.size >= LOG_MAX_BYTES) {
        const backup = `${file}.1`;
        await fsp.rm(backup, { force: true }).catch(() => {});
        await fsp.rename(file, backup);
      }
    } catch {
      /* file not created yet */
    }
    await fsp.appendFile(file, line, 'utf-8');
  }).catch(err => {
    console.error('log write failed:', err.message);
  });
  return logChain;
}

async function readLogTail() {
  const file = logFilePath();
  const chunks = [];
  for (const candidate of [`${file}.1`, file]) {
    try {
      const stat = await fsp.stat(candidate);
      const start = Math.max(0, stat.size - LOG_TAIL_BYTES);
      const fh = await fsp.open(candidate, 'r');
      try {
        const buf = Buffer.alloc(stat.size - start);
        await fh.read(buf, 0, buf.length, start);
        chunks.push(buf.toString('utf-8'));
      } finally {
        await fh.close();
      }
    } catch {
      /* missing */
    }
  }
  const text = chunks.join('');
  return text.length > LOG_TAIL_BYTES ? text.slice(-LOG_TAIL_BYTES) : text;
}

ipcMain.handle('logs:write', async (_e, level, message) => {
  try {
    await appendLog(level || 'info', message);
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('logs:readTail', async () => {
  try {
    const text = await readLogTail();
    return { success: true, text, path: logFilePath() };
  } catch (err) {
    return { error: err.message, text: '', path: logFilePath() };
  }
});

ipcMain.handle('logs:path', () => logFilePath());

ipcMain.handle('logs:openFolder', async () => {
  const dir = path.dirname(logFilePath());
  await fsp.mkdir(dir, { recursive: true });
  const err = await shell.openPath(dir);
  return err ? { error: err } : { success: true, path: dir };
});

const GITHUB_ISSUES_NEW =
  'https://github.com/HipHopGrinch/LocalAgents-Studio/issues/new';

/**
 * Build a redacted bug-report file, copy-friendly log text, and open a prefilled
 * GitHub issue in the browser (no API token in the app — user submits while signed in).
 */
ipcMain.handle('logs:reportToGitHub', async (_e, opts = {}) => {
  try {
    const version = app.getVersion();
    const note = String(opts?.note || '').trim().slice(0, 2000);
    const title = String(opts?.title || `Studio error report (v${version})`)
      .trim()
      .slice(0, 120);
    const tail = redactLog(await readLogTail());
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportName = `bug-report-${stamp}.txt`;
    const reportPath = path.join(path.dirname(logFilePath()), reportName);
    const reportBody = [
      `LocalAgents Studio bug report`,
      `Version: ${version}`,
      `Electron: ${process.versions.electron || '?'}`,
      `Chrome: ${process.versions.chrome || '?'}`,
      `Node: ${process.versions.node || '?'}`,
      `OS: ${process.platform} ${os.release()} (${process.arch})`,
      `When: ${new Date().toISOString()}`,
      '',
      '## User notes',
      note || '(none)',
      '',
      '## Recent logs (redacted)',
      tail || '(empty)'
    ].join('\n');
    await fsp.mkdir(path.dirname(reportPath), { recursive: true });
    await fsp.writeFile(reportPath, reportBody, 'utf-8');

    // GitHub new-issue URLs truncate around ~8KB — keep a short body and ask to attach the file.
    const logSnippet = (tail || '').slice(-2800);
    let issueBody = [
      '## What happened',
      note || '_Describe the steps that led to the error._',
      '',
      '## Environment',
      `- App version: \`${version}\``,
      `- OS: \`${process.platform} ${os.release()} (${process.arch})\``,
      `- Electron: \`${process.versions.electron || '?'}\``,
      '',
      '## Logs',
      `A redacted report was saved on the reporter's PC as \`${reportName}\` (Hardware Settings → Open logs folder). Please paste or attach it if the snippet below is incomplete.`,
      '',
      '```text',
      logSnippet || '(no log lines yet)',
      '```'
    ].join('\n');

    let url = `${GITHUB_ISSUES_NEW}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(issueBody)}`;
    // Stay under common URL length limits
    if (url.length > 7000) {
      issueBody = [
        '## What happened',
        note || '_Describe the steps that led to the error._',
        '',
        '## Environment',
        `- App version: \`${version}\``,
        `- OS: \`${process.platform} ${os.release()} (${process.arch})\``,
        '',
        '## Logs',
        `Attach \`${reportName}\` from the Studio logs folder (full redacted report). Snippet omitted because it was too long for the issue URL.`
      ].join('\n');
      url = `${GITHUB_ISSUES_NEW}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(issueBody)}`;
    }

    await shell.openExternal(url);
    appendLog('info', `opened GitHub issue draft; report=${reportName}`);
    return {
      success: true,
      url,
      reportPath,
      reportName,
      logText: reportBody,
      version
    };
  } catch (err) {
    appendLog('error', `logs:reportToGitHub: ${err?.message || err}`);
    return { error: err.message || String(err) };
  }
});

appendLog('info', `studio start ${app.getVersion()}`);

// ==========================================
// ENCRYPTED NODE SETUP EXPORT / IMPORT
// AES-256-GCM + scrypt; passphrase never stored or logged.
// ==========================================

const NODES_EXPORT_FORMAT = 'localagents-nodes-v1';
const NODES_SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const NODES_KEY_LEN = 32;
const NODES_SALT_LEN = 16;
const NODES_IV_LEN = 12;
const NODES_TAG_LEN = 16;

function stripNodeForExport(n) {
  if (!n || typeof n !== 'object') return null;
  const cfg = {
    id: String(n.id || ''),
    name: String(n.name || ''),
    url: String(n.url || ''),
    hardware: n.hardware && typeof n.hardware === 'object' ? n.hardware : {
      gpuModel: 'Unknown', vramGB: 0, ramGB: 0, ramBandwidthGBs: 0, reserveVramGB: 1
    }
  };
  if (n.type === 'ollama' || n.type === 'openai') cfg.type = n.type;
  if (typeof n.apiKey === 'string') cfg.apiKey = n.apiKey;
  if (typeof n.dnsAlias === 'string') cfg.dnsAlias = n.dnsAlias;
  if (Array.isArray(n.roles)) cfg.roles = n.roles;
  if (n.benchmarks && typeof n.benchmarks === 'object') cfg.benchmarks = n.benchmarks;
  if (Array.isArray(n.disabledModels)) cfg.disabledModels = n.disabledModels;
  if (typeof n.activeModel === 'string') cfg.activeModel = n.activeModel;
  if (n.modelMeta && typeof n.modelMeta === 'object') cfg.modelMeta = n.modelMeta;
  if (n.modelPrefs && typeof n.modelPrefs === 'object') cfg.modelPrefs = n.modelPrefs;
  if (n.freeTier === true) cfg.freeTier = true;
  if (typeof n.freeTierDailyCap === 'number' && n.freeTierDailyCap >= 1) {
    cfg.freeTierDailyCap = Math.min(500, Math.floor(n.freeTierDailyCap));
  }
  if (typeof n.freeTierRpm === 'number' && n.freeTierRpm >= 1) {
    cfg.freeTierRpm = Math.min(60, Math.floor(n.freeTierRpm));
  }
  return cfg;
}

function deriveNodesKey(passphrase, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(passphrase), salt, NODES_KEY_LEN, NODES_SCRYPT, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

async function encryptNodesPayload(payload, passphrase) {
  const salt = crypto.randomBytes(NODES_SALT_LEN);
  const iv = crypto.randomBytes(NODES_IV_LEN);
  const key = await deriveNodesKey(passphrase, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plain = Buffer.from(JSON.stringify(payload), 'utf8');
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    format: NODES_EXPORT_FORMAT,
    kdf: 'scrypt',
    kdfParams: { N: NODES_SCRYPT.N, r: NODES_SCRYPT.r, p: NODES_SCRYPT.p, dkLen: NODES_KEY_LEN },
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    ciphertext: Buffer.concat([enc, tag]).toString('base64')
  };
}

async function decryptNodesFile(fileObj, passphrase) {
  if (!fileObj || fileObj.format !== NODES_EXPORT_FORMAT) {
    throw new Error('Unrecognized or unsupported export format');
  }
  if (fileObj.kdf !== 'scrypt') {
    throw new Error('Unsupported key derivation');
  }
  const salt = Buffer.from(fileObj.salt, 'base64');
  const iv = Buffer.from(fileObj.iv, 'base64');
  const packed = Buffer.from(fileObj.ciphertext, 'base64');
  if (salt.length < 8 || iv.length !== NODES_IV_LEN || packed.length <= NODES_TAG_LEN) {
    throw new Error('Corrupt export file');
  }
  const data = packed.subarray(0, packed.length - NODES_TAG_LEN);
  const tag = packed.subarray(packed.length - NODES_TAG_LEN);
  const key = await deriveNodesKey(passphrase, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(plain.toString('utf8'));
}

function validateImportedNodesPayload(payload) {
  if (!payload || payload.format !== NODES_EXPORT_FORMAT) {
    throw new Error('Invalid decrypted payload format');
  }
  if (!Array.isArray(payload.nodes)) {
    throw new Error('Export does not contain a nodes array');
  }
  const nodes = [];
  for (const raw of payload.nodes) {
    const cfg = stripNodeForExport(raw);
    if (!cfg || !cfg.id || !cfg.url) continue;
    nodes.push(cfg);
  }
  if (nodes.length === 0) {
    throw new Error('No valid nodes found in export');
  }
  return nodes;
}

async function buildNodesExportEnvelope(nodes, passphrase) {
  if (!passphrase || typeof passphrase !== 'string' || passphrase.length < 8) {
    return { error: 'Passphrase must be at least 8 characters' };
  }
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return { error: 'No nodes to export' };
  }
  const sanitized = nodes.map(stripNodeForExport).filter(Boolean);
  if (sanitized.length === 0) return { error: 'No valid nodes to export' };
  const inner = {
    format: NODES_EXPORT_FORMAT,
    exportedAt: new Date().toISOString(),
    nodes: sanitized
  };
  const envelope = await encryptNodesPayload(inner, passphrase);
  return {
    success: true,
    content: JSON.stringify(envelope, null, 2),
    fileName: 'localagents-nodes.enc',
    nodeCount: sanitized.length
  };
}

async function importNodesFromRaw(raw, passphrase, sourcePath) {
  if (!passphrase || typeof passphrase !== 'string') {
    return { error: 'Passphrase required' };
  }
  let fileObj;
  try {
    fileObj = JSON.parse(raw);
  } catch {
    return { error: 'File is not valid JSON' };
  }
  let payload;
  try {
    payload = await decryptNodesFile(fileObj, passphrase);
  } catch {
    return { error: 'Decryption failed (wrong passphrase or corrupt file)' };
  }
  const nodes = validateImportedNodesPayload(payload);
  return { success: true, path: sourcePath || '', nodes, nodeCount: nodes.length };
}

ipcMain.handle('settings:exportNodes', async (e, { nodes, passphrase } = {}) => {
  try {
    const built = await buildNodesExportEnvelope(nodes, passphrase);
    if (built.error) return built;
    if (e?.webConsole) {
      return { success: true, content: built.content, fileName: built.fileName, nodeCount: built.nodeCount };
    }
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export encrypted node setup',
      defaultPath: dialogDefaultPath(built.fileName),
      filters: [
        { name: 'Encrypted LocalAgents nodes', extensions: ['enc'] },
        { name: 'All files', extensions: ['*'] }
      ]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    rememberDialogPath(result.filePath);
    await fsp.writeFile(result.filePath, built.content, 'utf-8');
    return { success: true, path: result.filePath, nodeCount: built.nodeCount };
  } catch (err) {
    return { error: err.message || 'Export failed' };
  }
});

ipcMain.handle('settings:importNodes', async (e, { passphrase, fileContent } = {}) => {
  try {
    if (e?.webConsole || typeof fileContent === 'string') {
      return await importNodesFromRaw(fileContent, passphrase, 'upload');
    }
    if (!passphrase || typeof passphrase !== 'string') {
      return { error: 'Passphrase required' };
    }
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import encrypted node setup',
      defaultPath: dialogDefaultPath(),
      properties: ['openFile'],
      filters: [
        { name: 'Encrypted LocalAgents nodes', extensions: ['enc'] },
        { name: 'JSON / encrypted', extensions: ['enc', 'json'] },
        { name: 'All files', extensions: ['*'] }
      ]
    });
    if (result.canceled || !result.filePaths?.length) return { canceled: true };
    rememberDialogPath(result.filePaths[0]);
    const raw = await fsp.readFile(result.filePaths[0], 'utf-8');
    return await importNodesFromRaw(raw, passphrase, result.filePaths[0]);
  } catch (err) {
    return { error: err.message || 'Import failed' };
  }
});

// ==========================================
// WEB CONSOLE (LAN remote UI)
// ==========================================

ipcMain.handle('webConsole:getStatus', () => webConsole.getStatus());

function publicWebConsoleSettings(wc = {}) {
  return {
    enabled: !!wc.enabled,
    port: wc.port || webConsole.DEFAULT_PORT,
    lanEnabled: !!wc.lanEnabled,
    allowShell: !!wc.allowShell,
    tlsCertPath: wc.tlsCertPath || '',
    tlsKeyPath: wc.tlsKeyPath || ''
  };
}

ipcMain.handle('webConsole:setPassword', async (_e, password) => {
  try {
    const rec = await webConsole.createPasswordRecord(password);
    if (rec.error) return rec;
    const settings = await readSettingsForMutation();
    settings.webConsole = {
      ...(settings.webConsole || {}),
      enabled: !!(settings.webConsole && settings.webConsole.enabled),
      port: (settings.webConsole && settings.webConsole.port) || webConsole.DEFAULT_PORT,
      passwordHash: rec.passwordHash,
      passwordSalt: rec.passwordSalt
    };
    await writeSettingsAtomic(settings);
    const status = await webConsole.applyConfig(settings.webConsole);
    if (status && status.error) return { error: status.error, status };
    return { success: true, status: webConsole.getStatus() };
  } catch (err) {
    return { error: err.message || 'Failed to save password' };
  }
});

ipcMain.handle('webConsole:update', async (_e, patch = {}) => {
  try {
    const settings = await readSettingsForMutation();
    const prev = settings.webConsole || {};
    const next = {
      enabled: typeof patch.enabled === 'boolean' ? patch.enabled : !!prev.enabled,
      port:
        typeof patch.port === 'number' && patch.port > 0
          ? Math.floor(patch.port)
          : prev.port || webConsole.DEFAULT_PORT,
      passwordHash: prev.passwordHash,
      passwordSalt: prev.passwordSalt,
      lanEnabled: typeof patch.lanEnabled === 'boolean' ? patch.lanEnabled : !!prev.lanEnabled,
      allowShell: typeof patch.allowShell === 'boolean' ? patch.allowShell : !!prev.allowShell,
      tlsCertPath: typeof patch.tlsCertPath === 'string' ? patch.tlsCertPath : prev.tlsCertPath || '',
      tlsKeyPath: typeof patch.tlsKeyPath === 'string' ? patch.tlsKeyPath : prev.tlsKeyPath || ''
    };
    if (typeof patch.password === 'string' && patch.password.length > 0) {
      const rec = await webConsole.createPasswordRecord(patch.password);
      if (rec.error) return rec;
      next.passwordHash = rec.passwordHash;
      next.passwordSalt = rec.passwordSalt;
    }
    if (next.enabled && (!next.passwordHash || !next.passwordSalt)) {
      return { error: 'Set a password before enabling the web console' };
    }
    settings.webConsole = next;
    await writeSettingsAtomic(settings);
    const status = await webConsole.applyConfig(next);
    if (status && status.error) {
      return { error: status.error, status, webConsole: publicWebConsoleSettings(next) };
    }
    return { success: true, status, webConsole: publicWebConsoleSettings(next) };
  } catch (err) {
    return { error: err.message || 'Failed to update web console' };
  }
});

// ==========================================
// USER-DRIVEN FILESYSTEM (explorer / editor)
// ==========================================

const IGNORED_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'dist-electron', 'build', 'out', '.next', '.nuxt', 'target',
  '__pycache__', '.venv', 'venv', '.mypy_cache', '.pytest_cache', '.idea', '.vs', 'coverage', '.turbo', '.cache', '.localagents'
]);

async function readDirSorted(dirPath) {
  const entries = await fsp.readdir(dirPath, { withFileTypes: true });
  return entries
    .filter(e => !(e.isDirectory() && IGNORED_DIRS.has(e.name)))
    .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1))
    .map(e => ({ name: e.name, path: path.join(dirPath, e.name), isDirectory: e.isDirectory() }));
}

ipcMain.handle('workspace:select-folder', async (e) => {
  if (e?.webConsole) {
    return null; // web clients cannot retarget the desktop workspace
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: dialogDefaultPath()
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  rememberDialogPath(result.filePaths[0]);
  return pinWorkspaceRoot(result.filePaths[0]);
});

ipcMain.handle('workspace:resolve-path', async (e, dirPath) => {
  try {
    const resolved = path.resolve(String(dirPath || '').trim());
    if (!resolved) return { error: 'Path required' };
    const st = await fsp.stat(resolved);
    if (!st.isDirectory()) return { error: 'Not a directory' };
    if (e?.webConsole) {
      const pin = workspaceRoots()[0];
      if (!pin) return { error: 'Open a folder on the desktop first' };
      try {
        const real = resolveJailedPath(pin, resolved, { allowRoot: true });
        return { path: real };
      } catch {
        return { error: 'Web console cannot change the open workspace' };
      }
    }
    const pinned = pinWorkspaceRoot(resolved);
    return pinned ? { path: pinned } : { error: 'Path not found' };
  } catch {
    return { error: 'Path not found' };
  }
});

function projectsRootPath() {
  return path.join(os.homedir(), 'Projects');
}

function sanitizeProjectName(name) {
  const cleaned = String(name || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\.+$/g, '')
    .slice(0, 80);
  return cleaned;
}

ipcMain.handle('workspace:projectsRoot', async () => {
  const root = projectsRootPath();
  await fsp.mkdir(root, { recursive: true });
  return root;
});

ipcMain.handle('workspace:listProjects', async () => {
  try {
    const root = projectsRootPath();
    await fsp.mkdir(root, { recursive: true });
    const entries = await fsp.readdir(root, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({ name: e.name, path: path.join(root, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    return { error: err.message || 'Failed to list projects' };
  }
});

ipcMain.handle('workspace:createProject', async (e, name) => {
  try {
    const cleaned = sanitizeProjectName(name);
    if (!cleaned) return { error: 'Enter a folder name' };
    const root = projectsRootPath();
    await fsp.mkdir(root, { recursive: true });
    const dest = path.join(root, cleaned);
    if (!dest.startsWith(root + path.sep) && dest !== root) {
      return { error: 'Invalid project path' };
    }
    await fsp.mkdir(dest, { recursive: true });
    if (!e?.webConsole) pinWorkspaceRoot(dest);
    return { path: dest, name: cleaned };
  } catch (err) {
    return { error: err.message || 'Failed to create project' };
  }
});

ipcMain.handle('workspace:default', () => process.cwd());

function projectChatsPath(root) {
  return path.join(root, '.localagents', 'chats.json');
}

ipcMain.handle('project:loadChats', async (e, root) => {
  try {
    if (!root) return { conversations: [], activeConversationId: null };
    if (e?.webConsole) assertWithinWorkspace(root, { allowRoot: true });
    else pinWorkspaceRoot(root);
    const raw = await fsp.readFile(projectChatsPath(root), 'utf-8');
    const data = JSON.parse(raw);
    return {
      conversations: Array.isArray(data.conversations) ? data.conversations : [],
      activeConversationId: data.activeConversationId || null
    };
  } catch (err) {
    if (err && /workspace|outside/i.test(err.message || '')) return { error: err.message, conversations: [], activeConversationId: null };
    return { conversations: [], activeConversationId: null };
  }
});

ipcMain.handle('project:saveChats', async (e, root, payload) => {
  try {
    if (!root) return { error: 'No workspace' };
    const pinned = e?.webConsole ? assertWithinWorkspace(root, { allowRoot: true }) : pinWorkspaceRoot(root);
    if (!pinned) return { error: 'No workspace folder is open' };
    const dir = path.join(pinned, '.localagents');
    await fsp.mkdir(dir, { recursive: true });
    const body = JSON.stringify({
      version: 1,
      activeConversationId: payload?.activeConversationId || null,
      conversations: Array.isArray(payload?.conversations) ? payload.conversations : []
    });
    const file = projectChatsPath(pinned);
    await atomicWriteFile(file, body);
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('fs:read-dir', async (e, dirPath) => {
  try {
    if (!e?.webConsole) {
      let inside = false;
      try {
        assertWithinWorkspace(dirPath, { allowRoot: true });
        inside = true;
      } catch {
        inside = false;
      }
      // Desktop recent-folder opens list the new root before anything else pins it.
      // A junction whose realpath leaves the current folder must not become the root.
      if (!inside) {
        const resolved = path.resolve(String(dirPath || ''));
        try {
          const lst = fs.lstatSync(resolved);
          const real = fs.realpathSync(resolved);
          if (lst.isDirectory() && pathsEqual(real, resolved)) pinWorkspaceRoot(resolved);
        } catch {
          /* not a real directory */
        }
      }
    }
    const abs = assertWithinWorkspace(dirPath, { allowRoot: true });
    return await readDirSorted(abs);
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('fs:read-file', async (_e, filePath) => {
  try {
    const abs = assertWithinWorkspace(filePath, { allowRoot: false });
    const root = workspaceRoots()[0];
    const stable = recheckJailedLeaf(root, abs);
    const stat = await fsp.lstat(stable);
    if (stat.isSymbolicLink()) return { error: 'Refusing to use a symlink or junction' };
    if (!stat.isFile()) return { error: 'Not a file' };
    if (stat.size > READ_CAP_BYTES) return { error: `File too large to open (${(stat.size / 1048576).toFixed(1)} MB)` };
    const buf = await fsp.readFile(stable);
    if (isBinary(buf)) return { error: 'Binary file - not opened in editor' };
    return { content: buf.toString('utf-8') };
  } catch (err) {
    return { error: err.message };
  }
});

function recheckWorkspaceLeaf(filePath) {
  const root = workspaceRoots()[0];
  if (!root) throw new Error('No workspace folder is open');
  return recheckJailedLeaf(root, filePath);
}

async function atomicWriteFile(filePath, body) {
  const data = Buffer.isBuffer(body) ? body : String(body ?? '');
  return withWriteLock(filePath, async () => {
    // Re-check immediately before each syscall. This is best-effort: Node on
    // Windows cannot open with O_NOFOLLOW plus a directory handle, so a link
    // can still be swapped after the check returns.
    let dest = recheckWorkspaceLeaf(filePath);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    dest = recheckWorkspaceLeaf(dest);
    const tmp = uniqueTmpPath(dest);
    await fsp.writeFile(tmp, data);
    try {
      dest = recheckWorkspaceLeaf(dest);
      // Keep last-good copy for plan/progress recovery
      if (
        fs.existsSync(dest) &&
        (dest.includes(`${path.sep}.localagents${path.sep}plans${path.sep}`) ||
          dest.includes(`${path.sep}.localagents${path.sep}progress${path.sep}`))
      ) {
        await fsp.copyFile(dest, dest + '.bak').catch(() => {});
      }
      await fsp.rename(tmp, dest);
    } catch (err) {
      if (err && /symlink|junction|outside the open workspace/i.test(err.message || '')) {
        await fsp.unlink(tmp).catch(() => {});
        throw err;
      }
      dest = recheckWorkspaceLeaf(dest);
      await fsp.copyFile(tmp, dest);
      await fsp.unlink(tmp).catch(() => {});
    }
  });
}

ipcMain.handle('fs:write-file', async (_e, filePath, content) => {
  try {
    const abs = assertWithinWorkspace(filePath, { allowRoot: false });
    let body = content;
    if (isPackageJsonPath(abs)) {
      body = sanitizePackageJsonContent(String(content ?? '')).content;
    }
    await atomicWriteFile(abs, body);
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('fs:create-file', async (_e, filePath) => {
  try {
    const abs = assertWithinWorkspace(filePath, { allowRoot: false });
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    if (!fs.existsSync(abs)) await atomicWriteFile(abs, '');
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('fs:create-folder', async (_e, folderPath) => {
  try {
    const abs = assertWithinWorkspace(folderPath, { allowRoot: false });
    await fsp.mkdir(abs, { recursive: true });
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('fs:delete', async (e, targetPath) => {
  try {
    if (e?.webConsole && !webConsole.allowShell()) {
      return { error: 'Shell and delete tools are disabled for the web console' };
    }
    const abs = assertWithinWorkspace(targetPath, { allowRoot: false });
    const pin = workspaceRoots()[0];
    const st = await fsp.stat(abs);
    if (st.isDirectory() && pin && pathsEqual(path.dirname(abs), pin)) {
      const choice = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        buttons: ['Cancel', 'Move to Recycle Bin'],
        defaultId: 0,
        cancelId: 0,
        message: `Move top-level folder "${path.basename(abs)}" to the Recycle Bin?`
      });
      if (choice.response !== 1) return { error: 'Cancelled' };
    }
    await shell.trashItem(abs);
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('fs:reveal', (_e, targetPath) => {
  try {
    const abs = assertWithinWorkspace(targetPath, { allowRoot: true });
    shell.showItemInFolder(abs);
  } catch (err) {
    appendLog('warn', `fs:reveal blocked: ${err.message}`);
  }
});

function isBinary(buf) {
  const len = Math.min(buf.length, 8000);
  for (let i = 0; i < len; i++) if (buf[i] === 0) return true;
  return false;
}

// ==========================================
// AGENT TOOLS (always scoped to the workspace root)
// ==========================================

function resolveScoped(root, p, opts = {}) {
  const pin = workspaceRoots()[0];
  if (!pin) throw new Error('No workspace folder is open');
  if (root) {
    let baseReal = path.resolve(String(root));
    try {
      baseReal = fs.realpathSync(baseReal);
    } catch {
      /* caller root may not exist yet */
    }
    if (!pathsEqual(baseReal, pin)) {
      throw new Error('Workspace root does not match the folder open on the desktop');
    }
  }
  const raw = p == null || p === '' ? '.' : String(p);
  try {
    return resolveJailedPath(pin, raw, { allowRoot: !!opts.allowRoot });
  } catch (err) {
    throw new Error(err.message || `Path "${p}" is outside the workspace`);
  }
}

const MAX_READ_CHARS = 60000;

async function toolReadFile(root, args) {
  const abs = resolveScoped(root, args.path, { allowRoot: false });
  const stat = await fsp.stat(abs);
  if (!stat.isFile()) throw new Error('Not a file');
  if (stat.size > READ_CAP_BYTES) {
    throw new Error(`File too large to read (${(stat.size / 1048576).toFixed(1)} MB)`);
  }
  const buf = await fsp.readFile(abs);
  if (isBinary(buf)) throw new Error('File is binary');
  const text = buf.toString('utf-8');
  if (args.raw) return { content: text, path: abs };

  const lines = text.split(/\r?\n/);
  const start = Math.max(1, parseInt(args.start, 10) || 1);
  const end = Math.min(lines.length, parseInt(args.end, 10) || lines.length);
  let body = lines.slice(start - 1, end).join('\n');
  let note = '';
  if (body.length > MAX_READ_CHARS) {
    body = body.slice(0, MAX_READ_CHARS);
    note = `\n[truncated at ${MAX_READ_CHARS} chars - use start/end to read further]`;
  }
  const range = start === 1 && end === lines.length ? `${lines.length} lines` : `lines ${start}-${end} of ${lines.length}`;
  return { content: `${args.path} (${range})\n${body}${note}`, path: abs };
}

async function toolListDir(root, args) {
  const base = resolveScoped(root, args.path || '.', { allowRoot: true });
  const maxDepth = Math.min(Math.max(parseInt(args.depth, 10) || 2, 1), 5);
  const out = [];
  let count = 0;
  async function walk(dir, depth, indent) {
    if (count > 600) return;
    let entries;
    try {
      entries = await readDirSorted(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (++count > 600) {
        out.push(`${indent}... (listing truncated)`);
        return;
      }
      if (e.isDirectory) {
        try {
          resolveScoped(root, e.path, { allowRoot: true });
        } catch {
          continue;
        }
        out.push(`${indent}${e.name}/`);
        if (depth < maxDepth) await walk(e.path, depth + 1, indent + '  ');
      } else {
        let size = '';
        try {
          size = ` (${formatBytes((await fsp.stat(e.path)).size)})`;
        } catch {}
        out.push(`${indent}${e.name}${size}`);
      }
    }
  }
  await walk(base, 1, '');
  return { content: out.length ? out.join('\n') : '(empty directory)' };
}

async function toolSearch(root, args) {
  const base = resolveScoped(root, args.path || '.', { allowRoot: true });
  const query = args.query || '';
  if (!query) throw new Error('search requires a query');
  const useRegex = String(args.regex).toLowerCase() === 'true';
  let re;
  try {
    re = useRegex ? new RegExp(query, 'i') : null;
  } catch (err) {
    throw new Error(`Invalid regex: ${err.message}`);
  }
  const needle = query.toLowerCase();
  const results = [];
  let filesScanned = 0;
  let yieldTicks = 0;
  const MAX_RESULTS = 150;

  const yieldNow = async () => {
    if (++yieldTicks % 25 === 0) await new Promise(resolve => setImmediate(resolve));
  };

  const escaped = full => {
    try {
      resolveScoped(root, full, { allowRoot: true });
      return false;
    } catch {
      return true;
    }
  };

  async function walk(dir) {
    if (results.length >= MAX_RESULTS || filesScanned > 25000) return;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (results.length >= MAX_RESULTS) return;
      await yieldNow();
      const full = path.join(dir, e.name);
      if (escaped(full)) continue;
      if (e.isDirectory()) {
        if (!IGNORED_DIRS.has(e.name)) await walk(full);
        continue;
      }
      filesScanned++;
      try {
        const stat = await fsp.stat(full);
        if (stat.size > 1024 * 1024) continue;
        const buf = await fsp.readFile(full);
        if (isBinary(buf)) continue;
        const lines = buf.toString('utf-8').split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (re ? re.test(line) : line.toLowerCase().includes(needle)) {
            results.push(`${path.relative(root || base, full)}:${i + 1}: ${line.trim().slice(0, 220)}`);
            if (results.length >= MAX_RESULTS) break;
          }
        }
      } catch {
        /* unreadable file */
      }
    }
  }

  const stat = await fsp.stat(base);
  if (stat.isFile()) {
    if (stat.size > READ_CAP_BYTES) throw new Error('File too large to search');
    filesScanned = 0;
    const lines = (await fsp.readFile(base, 'utf-8')).split(/\r?\n/);
    lines.forEach((line, i) => {
      if (re ? re.test(line) : line.toLowerCase().includes(needle)) results.push(`${path.relative(root || base, base)}:${i + 1}: ${line.trim()}`);
    });
  } else {
    await walk(base);
  }
  const suffix = results.length >= MAX_RESULTS ? `\n[stopped after ${MAX_RESULTS} matches - narrow the query or path]` : '';
  return { content: results.length ? results.join('\n') + suffix : `No matches for "${query}"` };
}

async function toolWriteFile(root, args) {
  const abs = resolveScoped(root, args.path);
  let body = args.content ?? '';
  let note = '';
  if (isPackageJsonPath(args.path || abs)) {
    const sanitized = sanitizePackageJsonContent(body);
    body = sanitized.content;
    if (sanitized.changed.length) {
      note = ` (rewrote deps: ${sanitized.changed.join('; ')})`;
    }
  }
  await atomicWriteFile(abs, body);
  return {
    content: `Wrote ${formatBytes(Buffer.byteLength(body))} to ${args.path}${note}`,
    path: abs
  };
}

ipcMain.handle('tools:exec', async (e, root, name, args) => {
  try {
    if (e?.webConsole && !webConsole.allowShell() && (name === 'run_command' || name === 'read_terminal')) {
      return { error: 'Shell and delete tools are disabled for the web console' };
    }
    switch (name) {
      case 'read_file': return await toolReadFile(root, args);
      case 'list_dir': return await toolListDir(root, args);
      case 'search': return await toolSearch(root, args);
      case 'write_file': return await toolWriteFile(root, args);
      case 'write_base64': {
        const abs = resolveScoped(root, args.path);
        await atomicWriteFile(abs, Buffer.from(String(args.content || ''), 'base64'));
        return { content: `Wrote binary ${args.path}`, path: abs };
      }
      case 'resolve': return { path: resolveScoped(root, args.path, { allowRoot: true }) };
      case 'exists': {
        try {
          return { exists: fs.existsSync(resolveScoped(root, args.path, { allowRoot: true })) };
        } catch {
          return { exists: false };
        }
      }
      case 'run_command': {
        const requested = Number(args && args.timeoutSec);
        const timeoutSec =
          Number.isFinite(requested) && requested > 0 ? Math.min(requested, 1800) : 120;
        const timeoutMs = timeoutSec * 1000;
        // Ordinary commands keep a 45s idle kill. Electron pack downloads can sit
        // quiet longer than that, so a long timeout also gets a longer idle window.
        const idleMs = timeoutSec > 180 ? Math.min(timeoutMs, 5 * 60 * 1000) : 45000;
        const res = await runPowerShell(args.command, root, {
          timeoutMs,
          echo: true,
          capture: true,
          idleMs,
          kind: 'agent'
        });
        const cap = timeoutSec > 180 ? 24000 : 12000;
        const tail = res.output.length > cap ? '[...output truncated...]\n' + res.output.slice(-cap) : res.output;
        return {
          content: `Exit code: ${res.code}${res.timedOut ? ' (timed out and was killed)' : ''}\n${tail || '(no output)'}`,
          exitCode: res.code
        };
      }
      case 'read_terminal': {
        const snap = getTerminalSnapshot(args.maxChars || 16000);
        if (args.lines) {
          const n = Math.min(Math.max(Number(args.lines) || 80, 1), 500);
          const lines = snap.content.split(/\r?\n/);
          const sliced = lines.slice(-n).join('\n');
          return {
            content: `Terminal (last ${Math.min(n, lines.length)} lines${snap.running ? ', process running' : ''}):\n${sliced}`
          };
        }
        return {
          content: `Terminal (${snap.chars} chars${snap.running ? ', process running' : ''}):\n${snap.content}`
        };
      }
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('mcp:call', async (e, spec) => {
  if (e?.webConsole && !webConsole.allowShell()) {
    return { error: 'Shell and delete tools are disabled for the web console' };
  }
  const saved = await readSettingsFile();
  const servers = parseMcpServers(saved?.mcpServersJson || '');
  const requested = String(spec?.server || spec?.name || '');
  const server = servers.find(s => s.name === requested);
  if (!server) {
    return { error: 'MCP server is not allowlisted in settings. Add it in Hardware Settings (command + args, no URLs).' };
  }
  const method = spec?.method === 'tools/list' ? 'tools/list' : 'tools/call';
  const params = method === 'tools/list'
    ? {}
    : { name: String(spec?.tool || ''), arguments: spec?.arguments || {} };
  const res = await mcpStdio(server.command, server.args, method, params);
  if (res.error) return { error: res.error };
  const text = typeof res.result === 'string' ? res.result : JSON.stringify(res.result, null, 2);
  return { content: text.slice(0, 12000) };
});

ipcMain.handle('web:search', async (e, baseUrl, query) => {
  try {
    const shellDenied = webShellDenial(e);
    if (shellDenied) return { error: shellDenied };
    let base = String(baseUrl || '').trim();
    if (e?.webConsole) {
      const data = await readSettingsFile();
      const configured = String(data?.searxngUrl || '').trim().replace(/\/+$/, '');
      if (!configured || normalizeNodeUrl(configured) !== normalizeNodeUrl(base)) {
        return { error: 'Search URL is not the configured SearXNG base' };
      }
      base = configured;
    }
    const q = String(query || '').trim();
    if (!base) {
      return { error: 'SearXNG is not configured. Set the URL in Hardware Settings and continue from local knowledge if needed.' };
    }
    if (!q) return { error: 'Empty search query' };
    const root = base.replace(/\/+$/, '');
    const url = `${root}/search?q=${encodeURIComponent(q)}&format=json`;
    const resp = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(20000)
    });
    if (!resp.ok) return { error: `SearXNG HTTP ${resp.status}` };
    const raw = await resp.text();
    const data = raw ? JSON.parse(raw.slice(0, OUTPUT_CAP_BYTES)) : {};
    const results = Array.isArray(data.results) ? data.results.slice(0, 6) : [];
    if (!results.length) return { content: `No results for: ${q}` };
    const lines = results.map((r, i) => {
      const title = String(r.title || 'Untitled').slice(0, 160);
      const link = String(r.url || '');
      const snippet = String(r.content || '').replace(/\s+/g, ' ').slice(0, 280);
      return `${i + 1}. ${title}\n${link}\n${snippet}`;
    });
    return { content: lines.join('\n\n') };
  } catch (err) {
    const message = err && (err.name === 'TimeoutError' || err.name === 'AbortError')
      ? 'Web search timed out. This is retriable.'
      : err.message || String(err);
    return { error: message };
  }
});

ipcMain.handle('image:generate', async (_e, nodeUrl, model, prompt) => {
  try {
    const base = String(nodeUrl || '').replace(/\/+$/, '');
    const resp = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false, think: false }),
      signal: AbortSignal.timeout(180000)
    });
    if (!resp.ok) {
      const text = await readCappedBody(resp);
      return { ok: false, error: `Image HTTP ${resp.status}: ${text.slice(0, 300)}` };
    }
    const data = await resp.json();
    let image = data.image || (Array.isArray(data.images) ? data.images[0] : '');
    if (image && typeof image === 'object' && image.b64_json) image = image.b64_json;
    if (typeof image === 'string' && image.includes('base64,')) image = image.split('base64,').pop();
    if (!image || typeof image !== 'string') {
      return { ok: false, error: 'Model response had no image bytes' };
    }
    return { ok: true, imageBase64: image, mime: 'image/png' };
  } catch (err) {
    const message = err && (err.name === 'TimeoutError' || err.name === 'AbortError')
      ? 'Image generation timed out. This is retriable.'
      : err.message || String(err);
    return { ok: false, error: message };
  }
});

// ==========================================
// WORKSPACE TYPECHECK (Conductor Swarm contract / repair)
// ==========================================

/**
 * Studio's bundled tsc, run via ELECTRON_RUN_AS_NODE. Never the workspace .bin shim.
 * @returns {{ kind: 'node', script: string } | null}
 */
function findTscRunner(_workspaceRoot) {
  const candidates = [];
  try {
    const pkgJson = require.resolve('typescript/package.json');
    const tsDir = path.dirname(pkgJson);
    candidates.push(path.join(tsDir, 'lib', 'tsc.js'));
    candidates.push(path.join(tsDir, 'bin', 'tsc'));
  } catch {
    /* typescript not resolvable from the packaged app */
  }
  candidates.push(path.join(__dirname, '..', 'node_modules', 'typescript', 'lib', 'tsc.js'));
  for (const script of candidates) {
    if (script && fs.existsSync(script)) return { kind: 'node', script };
  }
  return null;
}

function runTsc(cwd, args, timeoutMs = 90000) {
  return new Promise(resolve => {
    const runner = findTscRunner(cwd);
    if (!runner) {
      return resolve({
        code: -1,
        output:
          'TypeScript not available — reinstall Studio so the bundled compiler is present.',
        timedOut: false,
        skipped: false,
        missingTsc: true
      });
    }

    let output = '';
    let timedOut = false;
    let proc;
    try {
      proc = spawn(process.execPath, [runner.script, ...args], {
        cwd,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        windowsHide: true,
        shell: false
      });
      trackProc(proc);
    } catch (err) {
      return resolve({ code: -1, output: err.message, timedOut: false, skipped: false });
    }

    const onData = d => {
      if (output.length >= OUTPUT_CAP_BYTES) return;
      output += d.toString();
      if (output.length > OUTPUT_CAP_BYTES) output = output.slice(0, OUTPUT_CAP_BYTES) + '\n[output capped at 1 MB]';
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(proc);
    }, timeoutMs);
    proc.on('close', code => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, output, timedOut, skipped: false });
    });
    proc.on('error', err => {
      clearTimeout(timer);
      resolve({ code: -1, output: output + err.message, timedOut, skipped: false });
    });
  });
}

/**
 * opts.mode: 'contract' | 'workspace'
 * opts.file: relative path for isolated contract check
 */
ipcMain.handle('workspace:typecheck', async (_e, root, opts = {}) => {
  try {
    if (!root || !fs.existsSync(root)) {
      return { ok: false, error: 'Workspace root missing', output: '' };
    }
    try {
      root = assertWithinWorkspace(root, { allowRoot: true });
    } catch (err) {
      return { ok: false, error: err.message, output: '' };
    }
    const mode = opts.mode || 'workspace';
    const timeoutMs = opts.timeoutMs || 90000;

    if (mode === 'contract') {
      const rel = opts.file;
      if (!rel) return { ok: false, error: 'contract file required', output: '' };
      const abs = resolveScoped(root, rel);
      if (!fs.existsSync(abs)) {
        return { ok: false, error: `Contract file not found: ${rel}`, output: '' };
      }
      // Isolated check so worker projects without a full tsconfig still validate the contract
      const args = [
        '--noEmit',
        '--pretty',
        'false',
        '--strict',
        '--skipLibCheck',
        '--target',
        'ES2020',
        '--module',
        'ESNext',
        '--moduleResolution',
        'node',
        '--esModuleInterop',
        '--jsx',
        'react-jsx',
        '--lib',
        'DOM,ES2020,DOM.Iterable',
        abs
      ];
      const res = await runTsc(root, args, timeoutMs);
      if (res.missingTsc) {
        return {
          ok: false,
          error: res.output,
          output: res.output,
          mode: 'contract'
        };
      }
      const tail = (res.output || '').slice(-14000);
      return {
        ok: res.code === 0 && !res.timedOut,
        code: res.code,
        output: tail || (res.code === 0 ? '' : 'tsc failed with no output'),
        timedOut: res.timedOut,
        mode: 'contract'
      };
    }

    const tsconfig = path.join(root, 'tsconfig.json');
    if (!fs.existsSync(tsconfig)) {
      return {
        ok: true,
        skipped: true,
        output: 'No tsconfig.json in workspace — skipped full project typecheck',
        mode: 'workspace'
      };
    }
    const res = await runTsc(root, ['--noEmit', '--pretty', 'false'], timeoutMs);
    if (res.missingTsc) {
      return {
        ok: false,
        error: res.output,
        output: res.output,
        mode: 'workspace'
      };
    }
    const tail = (res.output || '').slice(-16000);
    return {
      ok: res.code === 0 && !res.timedOut,
      code: res.code,
      output: tail,
      timedOut: res.timedOut,
      skipped: false,
      mode: 'workspace'
    };
  } catch (err) {
    return { ok: false, error: err.message, output: err.message };
  }
});

/**
 * Sanitize package.json (known bad LLM package names) then npm install.
 */
ipcMain.handle('workspace:installDeps', async (e, root, opts = {}) => {
  try {
    if (e?.webConsole && !webConsole.allowShell()) {
      return { ok: false, error: 'Shell and delete tools are disabled for the web console', output: '' };
    }
    if (!root || !fs.existsSync(root)) {
      return { ok: false, error: 'Workspace root missing', output: '' };
    }
    try {
      root = assertWithinWorkspace(root, { allowRoot: true });
    } catch (err) {
      return { ok: false, error: err.message, output: '' };
    }
    const pkgPath = path.join(root, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      return { ok: false, error: 'No package.json in workspace', output: '' };
    }

    let rewritten = [];
    try {
      const raw = await fsp.readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(raw);
      const { json, changed, rewritten: did } = sanitizePackageJsonObject(pkg);
      if (did) {
        await atomicWriteFile(pkgPath, JSON.stringify(json, null, 2) + '\n');
        rewritten = changed;
        echoTerminal(
          `\n[Install deps] Rewrote package.json dependencies:\n  ${changed.join('\n  ')}\n`
        );
      }
    } catch (err) {
      return { ok: false, error: `Invalid package.json: ${err.message}`, output: err.message };
    }

    const timeoutMs = opts.timeoutMs || 300000;
    echoTerminal(`\n> npm install\n`);
    const res = await runPowerShell('npm install', root, {
      timeoutMs,
      echo: true,
      capture: true
    });
    const tail =
      (res.output || '').length > 16000
        ? '[...truncated...]\n' + res.output.slice(-16000)
        : res.output || '';
    const ok = res.code === 0 && !res.timedOut;
    return {
      ok,
      code: res.code,
      output: tail,
      timedOut: !!res.timedOut,
      rewritten
    };
  } catch (err) {
    return { ok: false, error: err.message, output: err.message };
  }
});

ipcMain.handle('workspace:hasPackageJson', async (e, root) => {
  try {
    if (!root) return { exists: false };
    let dir;
    try {
      dir = assertWithinWorkspace(root, { allowRoot: true });
    } catch {
      if (e?.webConsole) return { exists: false };
      // Desktop recent-folder opens check package.json before read-dir pins the root.
      const resolved = path.resolve(String(root));
      let lst;
      let real;
      try {
        lst = fs.lstatSync(resolved);
        real = fs.realpathSync(resolved);
      } catch {
        return { exists: false };
      }
      if (!lst.isDirectory() || lst.isSymbolicLink() || !pathsEqual(real, resolved)) return { exists: false };
      dir = pinWorkspaceRoot(resolved);
      if (!dir) return { exists: false };
    }
    const pkg = path.join(dir, 'package.json');
    try {
      recheckJailedLeaf(dir, pkg);
    } catch (err) {
      if (err && /symlink|junction/i.test(err.message || '')) return { exists: false };
      throw err;
    }
    return { exists: fs.existsSync(pkg) };
  } catch {
    return { exists: false };
  }
});

// ==========================================
// SILENT GIT (workspace root only — never the visible user terminal)
// ==========================================

const GIT_TIMEOUT_MS = 20000;

/**
 * Empty directory under userData. Repository hooks are not run from in-app git;
 * a workspace pre-commit must not execute with the app's privileges.
 */
function gitHooksDir() {
  const dir = path.join(app.getPath('userData'), 'empty-git-hooks');
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(dir)) {
    fs.rmSync(path.join(dir, name), { recursive: true, force: true });
  }
  return dir;
}

function runGit(args, cwd) {
  return new Promise(resolve => {
    let hooksDir;
    try {
      hooksDir = gitHooksDir();
    } catch (err) {
      resolve({ code: 1, stdout: '', stderr: '', error: err.message || 'Git hooks directory is not available' });
      return;
    }
    const built = buildGitArgv(args, { workspaceRoot: cwd, hooksDir });
    if (built.error) {
      resolve({ code: 1, stdout: '', stderr: '', error: built.error });
      return;
    }
    const env = scrubGitEnv(process.env);
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    let proc;
    try {
      proc = spawn('git', built.argv, {
        cwd,
        env,
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      trackProc(proc);
    } catch (err) {
      finish({ code: -1, stdout: '', stderr: '', error: err.message || 'Git failed to start' });
      return;
    }
    if (proc.stdout) {
      proc.stdout.on('data', d => {
        stdout = appendCapped(stdout, d.toString());
      });
    }
    if (proc.stderr) {
      proc.stderr.on('data', d => {
        stderr = appendCapped(stderr, d.toString());
      });
    }
    const timer = setTimeout(() => {
      killTree(proc);
      finish({ code: -1, stdout, stderr, error: 'Git command timed out' });
    }, GIT_TIMEOUT_MS);
    proc.on('error', err => {
      clearTimeout(timer);
      const missing = err && err.code === 'ENOENT';
      finish({
        code: -1,
        stdout,
        stderr,
        error: missing ? 'ENOENT: Git is not available on this machine.' : err.message || 'Git failed to start'
      });
    });
    proc.on('close', code => {
      clearTimeout(timer);
      finish({ code: typeof code === 'number' ? code : 1, stdout, stderr });
    });
  });
}

ipcMain.handle('git:run', async (e, args) => {
  if (e?.webConsole && !webConsole.allowShell()) {
    return { code: 1, stdout: '', stderr: '', error: 'Shell tools are disabled for the web console' };
  }
  const root = workspaceRoots()[0];
  if (!root) {
    return { code: 1, stdout: '', stderr: '', error: 'No workspace folder is open' };
  }
  return runGit(args, root);
});

// ==========================================
// POWERSHELL EXECUTION
// ==========================================

const userProcs = new Set();
const agentProcs = new Set();
const extraProcs = new Set();
const TERMINAL_BUF_MAX = 200000;
let terminalBuffer = '';

function trackProc(proc) {
  if (!proc) return proc;
  extraProcs.add(proc);
  const drop = () => extraProcs.delete(proc);
  proc.once('exit', drop);
  proc.once('error', drop);
  return proc;
}

function activeProcCount() {
  return userProcs.size + agentProcs.size;
}

function appendTerminalBuffer(text) {
  if (!text) return;
  terminalBuffer += text;
  if (terminalBuffer.length > TERMINAL_BUF_MAX) {
    terminalBuffer = terminalBuffer.slice(-TERMINAL_BUF_MAX);
  }
}

function echoTerminal(text) {
  appendTerminalBuffer(text);
  send('terminal:output', text);
}

function getTerminalSnapshot(maxChars = 12000) {
  const limit = Math.min(Math.max(Number(maxChars) || 12000, 500), 50000);
  const text =
    terminalBuffer.length > limit ? terminalBuffer.slice(-limit) : terminalBuffer;
  return {
    content: text || '(terminal is empty)',
    running: activeProcCount() > 0,
    chars: text.length
  };
}

function taskkillPid(pid) {
  return new Promise(resolve => {
    if (!pid) {
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timer = setTimeout(finish, 2000);
    try {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {
        clearTimeout(timer);
        finish();
      });
    } catch {
      clearTimeout(timer);
      finish();
    }
  });
}

function killTree(proc) {
  if (!proc || proc.exitCode !== null) return Promise.resolve();
  // proc.kill() on Windows does not kill grandchildren (npm, node, python...). taskkill /T does.
  return taskkillPid(proc.pid);
}

function killUserProcesses() {
  const procs = [...userProcs];
  userProcs.clear();
  return Promise.all(procs.map(proc => killTree(proc)));
}

function killAllProcesses() {
  const procs = [...userProcs, ...agentProcs, ...extraProcs];
  userProcs.clear();
  agentProcs.clear();
  extraProcs.clear();
  const jobs = procs.map(proc => killTree(proc));
  try {
    jobs.push(Promise.resolve(killTrackedMcp()));
  } catch {
    /* mcp module unavailable */
  }
  return Promise.all(jobs);
}

function jailAgentCwd(cwd) {
  const pin = workspaceRoots()[0];
  if (!pin) throw new Error('No workspace folder is open');
  const start = cwd && fs.existsSync(cwd) ? cwd : pin;
  return resolveJailedPath(pin, start, { allowRoot: true });
}

function appendCapped(output, text) {
  if (output.length >= OUTPUT_CAP_BYTES) return output;
  const next = output + text;
  if (next.length <= OUTPUT_CAP_BYTES) return next;
  return next.slice(0, OUTPUT_CAP_BYTES) + '\n[output capped at 1 MB]';
}

function runPowerShell(command, cwd, { timeoutMs = 0, echo = true, capture = false, idleMs = 0, kind = 'agent' } = {}) {
  return new Promise(resolve => {
    const isUser = kind === 'user';
    let effectiveTimeout = Number(timeoutMs) > 0 ? Number(timeoutMs) : 0;
    let effectiveIdle = Number(idleMs) > 0 ? Number(idleMs) : 0;
    if (!isUser) {
      const reason = agentCommandBlockReason(command);
      if (reason) return resolve({ code: -1, output: reason, timedOut: false, blocked: true });
      if (!(effectiveTimeout > 0)) effectiveTimeout = 120000;
      if (!(effectiveIdle > 0)) effectiveIdle = 45000;
      try {
        cwd = jailAgentCwd(cwd);
      } catch (err) {
        return resolve({ code: -1, output: err.message || 'Command cwd is outside the workspace', timedOut: false, blocked: true });
      }
    }
    let output = '';
    let timedOut = false;
    let idleTimedOut = false;
    const bucket = isUser ? userProcs : agentProcs;
    const wrapped =
      `$env:CI='1'; $env:NONINTERACTIVE='1'; $env:TERM='dumb'; ` +
      `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $ProgressPreference = 'SilentlyContinue'; ${command}`;
    let proc;
    try {
      proc = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', wrapped], {
        cwd: cwd && fs.existsSync(cwd) ? cwd : undefined,
        env: { ...process.env, CI: '1', NONINTERACTIVE: '1', TERM: 'dumb' },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      trackProc(proc);
    } catch (err) {
      return resolve({ code: -1, output: err.message, timedOut });
    }
    bucket.add(proc);
    if (echo) echoTerminal(`\n> ${command}\n`);

    let idleTimer = null;
    const bumpIdle = () => {
      if (!(effectiveIdle > 0)) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        idleTimedOut = true;
        timedOut = true;
        killTree(proc);
      }, effectiveIdle);
    };
    bumpIdle();

    const onData = data => {
      bumpIdle();
      const text = data.toString();
      if (capture) output = appendCapped(output, text);
      if (echo) echoTerminal(text);
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);

    const timer = effectiveTimeout > 0 ? setTimeout(() => { timedOut = true; killTree(proc); }, effectiveTimeout) : null;

    proc.on('close', code => {
      if (timer) clearTimeout(timer);
      if (idleTimer) clearTimeout(idleTimer);
      bucket.delete(proc);
      if (echo) {
        if (idleTimedOut) echoTerminal(`\n[idle timeout ${effectiveIdle}ms — no output]\n`);
        echoTerminal(`\n[exit ${code}]\n`);
      }
      send('terminal:state', { running: activeProcCount() > 0 });
      resolve({ code, output, timedOut });
    });
    proc.on('error', err => {
      if (timer) clearTimeout(timer);
      if (idleTimer) clearTimeout(idleTimer);
      bucket.delete(proc);
      resolve({ code: -1, output: output + err.message, timedOut });
    });
    send('terminal:state', { running: true });
  });
}

ipcMain.handle('terminal:execute', async (e, command, cwd, opts) => {
  if (e?.webConsole && !webConsole.allowShell()) {
    return { code: -1, output: 'Shell and delete tools are disabled for the web console' };
  }
  const timeoutMs = Number(opts && opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 0;
  const res = await runPowerShell(command, cwd, {
    echo: true,
    capture: true,
    kind: 'user',
    timeoutMs,
    idleMs: 0
  });
  return { code: res.code, output: res.output || '' };
});

ipcMain.handle('terminal:kill', e => {
  const shellDenied = webShellDenial(e);
  if (shellDenied) return { error: shellDenied };
  // User Stop only kills interactive terminal procs — not in-flight agent run_command.
  const had = userProcs.size > 0;
  killUserProcesses();
  send('terminal:state', { running: activeProcCount() > 0 });
  return { success: had };
});

ipcMain.handle('terminal:getBuffer', (e, opts) => {
  const shellDenied = webShellDenial(e);
  if (shellDenied) return { error: shellDenied };
  return getTerminalSnapshot(opts?.maxChars);
});

ipcMain.handle('terminal:clearBuffer', () => {
  terminalBuffer = '';
  return { success: true };
});

// ==========================================
// OLLAMA CLUSTER (all network I/O happens here, never in the renderer)
// ==========================================

async function fetchJson(url, { timeoutMs = 2500, method = 'GET', body } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method,
      signal: controller.signal,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${(await resp.text().catch(() => '')).slice(0, 500)}`.trim());
    const text = await resp.text();
    if (text.length > 2_000_000) throw new Error('Response too large');
    return text ? JSON.parse(text) : {};
  } finally {
    clearTimeout(t);
  }
}

function normalizeFrontierEndpoint(rawUrl) {
  let endpoint = (rawUrl || '').trim().replace(/\/+$/, '');
  if (endpoint.includes('googleapis.com')) {
    if (!endpoint.includes('/v1beta')) {
      endpoint = `${endpoint}/v1beta`;
    }
    if (!endpoint.includes('/openai')) {
      endpoint = `${endpoint}/openai`;
    }
  }
  return endpoint;
}

const tagsCache = new Map();
const psCache = new Map();
const frontierModelsCache = new Map();

function ollamaModelList(tags) {
  return (tags?.models || []).map(m => ({
    name: m.name,
    size: m.size,
    details: m.details,
    capabilities: m.capabilities
  }));
}

function ollamaLoadedList(ps) {
  return (ps?.models || []).map(m => ({
    name: m.name,
    size: m.size,
    sizeVram: m.size_vram,
    contextLength: m.context_length,
    expiresAt: m.expires_at
  }));
}

async function nodeStatus(node, opts = {}) {
  const url = (node.url || '').replace(/\/+$/, '');
  const started = Date.now();
  const force = !!opts.force;

  // 1. OpenAI-compatible Frontier endpoint (Grok, OpenRouter, OpenAI, Gemini, etc.)
  if (node.type === 'openai' || node.apiKey) {
    try {
      const endpointUrl = normalizeFrontierEndpoint(node.url);
      const cached = frontierModelsCache.get(endpointUrl);
      if (!force && cached && Date.now() - cached.at < MODELS_TTL_MS) {
        return { ...cached.status };
      }
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 6000);
      const headers = { 'Content-Type': 'application/json' };
      if (node.apiKey) {
        headers['Authorization'] = `Bearer ${node.apiKey}`;
        if (endpointUrl.includes('googleapis.com')) {
          headers['x-goog-api-key'] = node.apiKey;
        }
      }

      const resp = await fetch(`${endpointUrl}/models`, { headers, signal: controller.signal });
      clearTimeout(t);
      const latency = Date.now() - started;

      if (resp.ok) {
        const data = await resp.json();
        const modelsList = Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : []);
        const filtered = modelsList
          .map(m => typeof m === 'string' ? m : (m.id || m.name))
          .filter(name => {
            if (!name) return false;
            const lower = name.toLowerCase();
            return !lower.includes('embedding') && !lower.includes('aqa');
          });

        const isGemini = endpointUrl.includes('googleapis.com');
        const fallbackList = isGemini
          ? ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash']
          : ['gpt-4o', 'grok-2-1212', 'claude-3-5-sonnet'];

        const status = {
          online: true,
          latency,
          version: isGemini ? 'Google Gemini API' : 'Frontier API',
          models: (filtered.length > 0 ? filtered : fallbackList).map(name => ({
            name,
            size: 0,
            details: { family: isGemini ? 'Gemini' : 'Frontier API' }
          })),
          loaded: []
        };
        frontierModelsCache.set(endpointUrl, { at: Date.now(), status });
        return status;
      }
      return { online: false, latency: null, models: [], loaded: [], error: `HTTP ${resp.status}` };
    } catch (err) {
      return { online: false, latency: null, models: [], loaded: [], error: err.message };
    }
  }

  // 2. Local Ollama Node — /api/ps cached ~5s unless force; /api/tags cached ~3 min
  try {
    const version = await fetchJson(`${url}/api/version`, { timeoutMs: 2000 });
    const latency = Date.now() - started;
    const psKey = url;
    const cachedPs = psCache.get(psKey);
    let ps;
    if (!force && cachedPs && Date.now() - cachedPs.at < PS_TTL_MS) {
      ps = cachedPs.data;
    } else {
      ps = await fetchJson(`${url}/api/ps`, { timeoutMs: 4000 }).catch(() => ({ models: [] }));
      psCache.set(psKey, { at: Date.now(), data: ps });
    }
    const cachedTags = tagsCache.get(url);
    let tags;
    if (!force && cachedTags && Date.now() - cachedTags.at < TAGS_TTL_MS) {
      tags = cachedTags.data;
    } else {
      tags = await fetchJson(`${url}/api/tags`, { timeoutMs: 4000 });
      tagsCache.set(url, { at: Date.now(), data: tags });
    }
    return {
      online: true,
      latency,
      version: version.version,
      models: ollamaModelList(tags),
      loaded: ollamaLoadedList(ps)
    };
  } catch (err) {
    const msg =
      err.name === 'AbortError'
        ? 'Timed out reaching Ollama. On LAN nodes set OLLAMA_HOST=0.0.0.0 and allow TCP 11434 through the firewall.'
        : /fetch failed|ECONNREFUSED|ENOTFOUND/i.test(err.message || '')
          ? `${err.message} — confirm Ollama is running and OLLAMA_HOST=0.0.0.0 for remote access (port 11434).`
          : err.message;
    return { online: false, latency: null, models: [], loaded: [], error: msg };
  }
}

ipcMain.handle('ollama:status', async (e, nodes, opts) => {
  // Ping every node in parallel - total wait is the slowest node, not the sum.
  // Web clients omit apiKeys; restore them from disk before frontier probes.
  const force = !!(opts && opts.force);
  const allowedUrls = e?.webConsole ? await configuredNodeUrlSet() : null;
  const entries = await Promise.all(
    (nodes || []).map(async n => {
      if (allowedUrls && !allowedUrls.has(normalizeNodeUrl(n && n.url))) {
        return [n && n.id, { online: false, latency: null, models: [], loaded: [], error: 'URL is not a configured cluster node' }];
      }
      const key = await resolveApiKeyForRequest(e, n.url, n.apiKey, n.id);
      return [n.id, await nodeStatus({ ...n, apiKey: key || n.apiKey }, { force })];
    })
  );
  return Object.fromEntries(entries);
});

/**
 * Ollama /api/show — used to discover thinking controls + description after a pull.
 * thinking.values: [false] means unsupported; [true,false] or named levels means controllable.
 */
ipcMain.handle('ollama:show', async (e, url, model) => {
  const denied = await webNodeUrlDenial(e, url);
  if (denied) return { error: denied };
  const base = (url || '').replace(/\/+$/, '');
  try {
    const show = await fetchJson(`${base}/api/show`, {
      method: 'POST',
      body: { model },
      timeoutMs: 20000
    });
    let thinking;
    if (show.thinking && Array.isArray(show.thinking.values) && show.thinking.values.length > 0) {
      thinking = { values: show.thinking.values, default: show.thinking.default };
    } else if (Array.isArray(show.capabilities) && show.capabilities.includes('thinking')) {
      thinking = { values: [false, true], default: true };
    }
    const description =
      (typeof show.description === 'string' && show.description.trim()) ||
      (show.details?.family ? `${show.details.family}${show.details.parameter_size ? ` · ${show.details.parameter_size}` : ''}` : undefined);
    return {
      capabilities: show.capabilities,
      description,
      thinking,
      details: show.details
    };
  } catch (err) {
    return { error: err.message };
  }
});

const streams = new Map(); // requestId -> AbortController

/** Read at most 1 MB of an error body, then cancel the stream. */
async function readCappedBody(response, cap = OUTPUT_CAP_BYTES) {
  const limit = Math.max(1, Math.min(Number(cap) || OUTPUT_CAP_BYTES, OUTPUT_CAP_BYTES));
  if (!response) return '';
  const body = response.body;
  if (!body || typeof body.getReader !== 'function') {
    try {
      const text = await response.text();
      return String(text || '').slice(0, limit);
    } catch {
      return '';
    }
  }
  const reader = body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (size < limit) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const buf = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      const room = limit - size;
      chunks.push(buf.length > room ? buf.subarray(0, room) : buf);
      size += Math.min(buf.length, room);
      if (buf.length > room) break;
    }
  } catch {
    /* return the bytes already read */
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}

function streamTimeoutMessage(kind, absoluteMs) {
  if (kind === 'absolute') {
    const mins = Math.max(1, Math.round((absoluteMs || STREAM_ABSOLUTE_MS) / 60000));
    return `Request exceeded the ${mins} minute limit. This is retriable — retry or reroute to another node.`;
  }
  return 'Model stalled: no data for 120s. This is retriable — retry or reroute to another node.';
}

async function streamNdjson(requestId, url, body, channel, onLine, deadlines) {
  const idleMs = deadlines?.idleMs ?? STREAM_IDLE_MS;
  const absoluteMs = deadlines?.absoluteMs ?? STREAM_ABSOLUTE_MS;
  const controller = new AbortController();
  streams.set(requestId, controller);
  let stopReason = '';
  const startedAt = Date.now();
  let idleTimer = null;
  let reader = null;
  let completed = false;
  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      stopReason = stopReason || 'idle';
      try { controller.abort(); } catch { /* ignore */ }
    }, idleMs);
  };
  const absTimer = setTimeout(() => {
    stopReason = stopReason || 'absolute';
    try { controller.abort(); } catch { /* ignore */ }
  }, absoluteMs);
  try {
    armIdle();
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!resp.ok || !resp.body) {
      const text = await readCappedBody(resp);
      let msg = text.slice(0, 500);
      try { msg = JSON.parse(text).error || msg; } catch { /* keep text */ }
      throw new Error(`HTTP ${resp.status}: ${msg}`);
    }
    reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    armIdle();
    for (;;) {
      if (Date.now() - startedAt >= absoluteMs) {
        stopReason = stopReason || 'absolute';
        controller.abort();
        throw Object.assign(new Error('absolute'), { name: 'AbortError' });
      }
      const { done, value } = await reader.read();
      if (done) break;
      armIdle();
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > OUTPUT_CAP_BYTES) throw new Error('Stream line exceeded 1 MB');
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        let parsed;
        try { parsed = JSON.parse(line); } catch { continue; }
        if (parsed.error) throw new Error(parsed.error);
        onLine(parsed);
      }
    }
    if (buffer.trim()) {
      try { onLine(JSON.parse(buffer)); } catch { /* trailing junk */ }
    }
    completed = true;
  } catch (err) {
    if (stopReason === 'idle' || stopReason === 'absolute') {
      send(channel, {
        requestId,
        type: 'error',
        error: streamTimeoutMessage(stopReason, absoluteMs),
        retriable: true,
        code: stopReason === 'absolute' ? 'absolute_timeout' : 'idle_timeout'
      });
    } else if (err.name === 'AbortError') send(channel, { requestId, type: 'aborted' });
    else send(channel, { requestId, type: 'error', error: err.message, retriable: true });
    return false;
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    clearTimeout(absTimer);
    streams.delete(requestId);
    if (!completed) {
      try { controller.abort(); } catch { /* ignore */ }
      if (reader) {
        try { await reader.cancel(); } catch { /* ignore */ }
      }
    }
    tryInstallWhenIdle();
  }
  return true;
}

function frontierMaxTokens(requested) {
  const n = Number(requested);
  if (!Number.isFinite(n) || n < 1) return FRONTIER_MAX_OUTPUT_TOKENS;
  return Math.min(FRONTIER_MAX_OUTPUT_TOKENS, Math.floor(n));
}

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(part => (typeof part === 'string' ? part : part?.text || part?.content || '')).join('');
  }
  return '';
}

function absorbToolCall(acc, delta) {
  const calls = delta?.tool_calls;
  if (!Array.isArray(calls)) return;
  for (const tc of calls) {
    const i = tc.index ?? 0;
    if (!acc[i]) acc[i] = { name: '', args: '' };
    if (tc.function?.name) acc[i].name += tc.function.name;
    if (typeof tc.function?.arguments === 'string') acc[i].args += tc.function.arguments;
  }
}

function attrEscape(value) {
  return String(value ?? '').replace(/"/g, '').replace(/[<>]/g, '');
}

function canonicalToolName(raw) {
  const underscored = String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  const compact = underscored.replace(/_/g, '');
  const known = new Set([
    'read_file', 'list_dir', 'search', 'write_file', 'edit_file',
    'run_command', 'read_terminal', 'web_search', 'generate_image', 'mcp_call'
  ]);
  if (known.has(underscored)) return underscored;
  const aliases = {
    read: 'read_file',
    readfile: 'read_file',
    write: 'write_file',
    writefile: 'write_file',
    createfile: 'write_file',
    savefile: 'write_file',
    edit: 'edit_file',
    editfile: 'edit_file',
    patch: 'edit_file',
    searchreplace: 'edit_file',
    strreplace: 'edit_file',
    applypatch: 'edit_file',
    listdir: 'list_dir',
    listdirectory: 'list_dir',
    list: 'list_dir',
    grep: 'search',
    codebasesearch: 'search',
    find: 'search',
    run: 'run_command',
    runcommand: 'run_command',
    shell: 'run_command',
    bash: 'run_command',
    execute: 'run_command',
    terminal: 'run_command',
    readterminal: 'read_terminal',
    websearch: 'web_search',
    generateimage: 'generate_image',
    image: 'generate_image',
    mcpcall: 'mcp_call',
    mcp: 'mcp_call'
  };
  if (aliases[compact]) return aliases[compact];
  if (/write|create_file|save_file/.test(underscored)) return 'write_file';
  if (/edit|patch|search_replace|str_replace/.test(underscored)) return 'edit_file';
  return '';
}

function writeTagsFromToolCalls(acc) {
  const chunks = [];
  for (const tool of acc) {
    if (!tool || !tool.name) continue;
    const name = canonicalToolName(tool.name);
    if (!name) continue;
    let parsed = {};
    try { parsed = JSON.parse(tool.args || '{}'); } catch { parsed = {}; }
    const pathVal = parsed.path || parsed.file_path || parsed.filepath || parsed.filename || parsed.file || parsed.target || parsed.directory || parsed.dir || '';
    const query = parsed.query || parsed.pattern || parsed.search || parsed.q || '';
    const command = parsed.command || parsed.cmd || parsed.script || parsed.input || '';
    const prompt = parsed.prompt || '';
    let body = parsed.content ?? parsed.contents ?? parsed.code ?? parsed.text ?? parsed.body ?? '';
    if (name === 'edit_file' && parsed.old_string != null && parsed.new_string != null) {
      body = `<<<<<<< SEARCH\n${parsed.old_string}\n=======\n${parsed.new_string}\n>>>>>>> REPLACE`;
    } else if (name === 'edit_file' && (parsed.search != null || parsed.replace != null || parsed.replacement != null)) {
      body = `<<<<<<< SEARCH\n${parsed.search || ''}\n=======\n${parsed.replace || parsed.replacement || ''}\n>>>>>>> REPLACE`;
    }
    const safePath = attrEscape(pathVal);
    const text = body == null ? '' : String(body);
    if (name === 'write_file' || name === 'edit_file') {
      if (!safePath) continue;
      chunks.push(`<${name} path="${safePath}">\n${text}\n</${name}>`);
    } else if (name === 'read_file') {
      if (!safePath && !text) continue;
      const start = parsed.start || parsed.start_line || parsed.offset;
      const end = parsed.end || parsed.end_line || parsed.limit;
      const extra = `${start != null && start !== '' ? ` start="${attrEscape(start)}"` : ''}${end != null && end !== '' ? ` end="${attrEscape(end)}"` : ''}`;
      if (!safePath) chunks.push(`<read_file path="${attrEscape(text)}"/>`);
      else if (!text) chunks.push(`<read_file path="${safePath}"${extra}/>`);
      else chunks.push(`<read_file path="${safePath}"${extra}>\n${text}\n</read_file>`);
    } else if (name === 'list_dir') {
      chunks.push(`<list_dir path="${safePath || '.'}"/>`);
    } else if (name === 'search') {
      const q = attrEscape(query || text);
      if (!q) continue;
      chunks.push(`<search query="${q}"${safePath ? ` path="${safePath}"` : ''}/>`);
    } else if (name === 'run_command') {
      const cmd = String(command || text || '').trim();
      if (!cmd) continue;
      chunks.push(`<run_command>\n${cmd}\n</run_command>`);
    } else if (name === 'web_search') {
      const q = attrEscape(query || text);
      if (!q) continue;
      chunks.push(`<web_search query="${q}"/>`);
    } else if (name === 'generate_image') {
      const p = String(prompt || text || '').trim();
      if (!p) continue;
      chunks.push(`<generate_image>\n${p}\n</generate_image>`);
    } else if (name === 'read_terminal') {
      const lines = parsed.lines || parsed.max_lines || '';
      chunks.push(lines ? `<read_terminal lines="${attrEscape(lines)}"/>` : '<read_terminal/>');
    } else if (name === 'mcp_call') {
      const payload = text || JSON.stringify({
        server: parsed.server || parsed.name || '',
        tool: parsed.tool || '',
        arguments: parsed.arguments || parsed.args || {}
      });
      chunks.push(`<mcp_call>\n${payload}\n</mcp_call>`);
    }
  }
  return chunks.join('\n');
}

async function streamOpenAI(requestId, url, apiKey, body, channel) {
  const controller = new AbortController();
  streams.set(requestId, controller);
  const started = Date.now();
  const absoluteMs = STREAM_ABSOLUTE_MS;
  let stopReason = '';
  let idleTimer = null;
  let reader = null;
  let completed = false;
  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      stopReason = stopReason || 'idle';
      try { controller.abort(); } catch { /* ignore */ }
    }, STREAM_IDLE_MS);
  };
  const absTimer = setTimeout(() => {
    stopReason = stopReason || 'absolute';
    try { controller.abort(); } catch { /* ignore */ }
  }, absoluteMs);
  let firstTokenTime = 0;
  let tokenCount = 0;
  let finishReason = '';
  let full = '';
  let usage = null;
  const toolAcc = [];

  try {
    const baseUrl = normalizeFrontierEndpoint(url);
    const endpoint = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
      if (baseUrl.includes('googleapis.com')) {
        headers['x-goog-api-key'] = apiKey;
      }
    }

    const postCompletion = payload => fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    let payload = { ...body };
    armIdle();
    let resp = await postCompletion(payload);

    const readErrorMessage = async response => {
      const text = await readCappedBody(response);
      let msg = text;
      try { msg = JSON.parse(text).error?.message || text; } catch { /* keep */ }
      return String(msg || text || response.statusText || '').slice(0, OUTPUT_CAP_BYTES);
    };

    const isRateLimited = (status, msg) => {
      if (status === 429) return true;
      return /rate[- ]?limit|quota|resource.?exhausted|too many requests|rpm\b|requests per minute/i.test(
        String(msg || '')
      );
    };

    const retryAfterMs = (response, msg, attempt) => {
      const header = response.headers?.get?.('retry-after');
      if (header && /^\d+(\.\d+)?$/.test(header.trim())) {
        return Math.min(120000, Math.max(1000, Math.ceil(Number(header) * 1000)));
      }
      const m = String(msg || '').match(/retry-after[=:\s]+(\d+)/i)
        || String(msg || '').match(/try again in\s+(\d+(?:\.\d+)?)\s*s/i);
      if (m) return Math.min(120000, Math.max(1000, Math.ceil(Number(m[1]) * 1000)));
      return Math.min(90000, 15000 * Math.pow(2, Math.max(0, attempt)));
    };

    // Rate-limit / max_tokens recovery before streaming.
    for (let attempt = 0; attempt < 4; attempt++) {
      if (resp.ok) break;
      const msg = await readErrorMessage(resp);
      const capRejected =
        payload.max_tokens &&
        /max_tokens|max_output_tokens|max_completion_tokens|output token|maximum tokens/i.test(msg);
      if (capRejected && payload.max_tokens > 2048) {
        payload.max_tokens = payload.max_tokens > 8192 ? 8192 : payload.max_tokens > 4096 ? 4096 : 2048;
        resp = await postCompletion(payload);
        continue;
      }
      if (payload.response_format && /response_format|json_object/i.test(msg)) {
        delete payload.response_format;
        resp = await postCompletion(payload);
        continue;
      }
      if (payload.stream_options && /stream_options|include_usage|unknown (field|parameter)/i.test(msg)) {
        delete payload.stream_options;
        resp = await postCompletion(payload);
        continue;
      }
      if (isRateLimited(resp.status, msg) && attempt < 3) {
        const waitMs = retryAfterMs(resp, msg, attempt);
        appendLog(
          'warn',
          `frontier rate limit HTTP ${resp.status}; waiting ${Math.round(waitMs / 1000)}s then retry ${attempt + 1}/3`
        );
        if (idleTimer) clearTimeout(idleTimer);
        await new Promise(r => setTimeout(r, waitMs));
        if (controller.signal.aborted) throw new Error('Aborted');
        armIdle();
        resp = await postCompletion(payload);
        continue;
      }
      throw new Error(`HTTP ${resp.status}: ${msg}`);
    }
    if (!resp.ok) {
      const msg = await readErrorMessage(resp);
      throw new Error(`HTTP ${resp.status}: ${msg}`);
    }

    reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    armIdle();

    for (;;) {
      if (Date.now() - started >= absoluteMs) {
        stopReason = stopReason || 'absolute';
        controller.abort();
        throw Object.assign(new Error('absolute'), { name: 'AbortError' });
      }
      const { done, value } = await reader.read();
      if (done) break;
      armIdle();
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > OUTPUT_CAP_BYTES) throw new Error('Stream line exceeded 1 MB');
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line || !line.startsWith('data:')) continue;
        const dataStr = line.slice(5).trim();
        if (dataStr === '[DONE]') break;
        try {
          const parsed = JSON.parse(dataStr);
          if (parsed.usage && typeof parsed.usage === 'object') usage = parsed.usage;
          const choice = parsed.choices?.[0] || {};
          const delta = choice.delta || {};
          if (choice.finish_reason) finishReason = choice.finish_reason;
          absorbToolCall(toolAcc, delta);
          let content = textFromContent(delta.content ?? delta.text ?? choice.message?.content ?? '');
          if (!content && Array.isArray(parsed.candidates?.[0]?.content?.parts)) {
            content = parsed.candidates[0].content.parts.map(part => part.text || '').join('');
          }
          const thinking = textFromContent(delta.reasoning_content || delta.thinking || '');
          if (content || thinking) {
            if (!firstTokenTime) firstTokenTime = Date.now();
            if (content) {
              if (full.length < OUTPUT_CAP_BYTES) full += content;
              tokenCount += Math.ceil(content.length / 4);
            }
            send(channel, { requestId, type: 'chunk', content, thinking });
          }
        } catch { /* skip malformed SSE */ }
      }
    }

    const extra = writeTagsFromToolCalls(toolAcc);
    if (extra) {
      const pieces = extra.split(/\n(?=<)/).filter(piece => {
        const m = piece.match(/^<([A-Za-z0-9_]+)\b/);
        if (!m) return true;
        return !new RegExp(`<${m[1]}\\b`, 'i').test(full);
      });
      const text = pieces.join('\n');
      if (text) {
        tokenCount += Math.ceil(text.length / 4);
        send(channel, { requestId, type: 'chunk', content: `\n${text}\n`, thinking: '' });
      }
    }

    const totalDuration = Date.now() - started;
    const promptTokens = usage && Number.isFinite(Number(usage.prompt_tokens)) ? Number(usage.prompt_tokens) : null;
    const completionTokens = usage && Number.isFinite(Number(usage.completion_tokens)) ? Number(usage.completion_tokens) : null;
    const reasoningRaw = usage
      ? Number(usage.completion_tokens_details?.reasoning_tokens ?? usage.reasoning_tokens)
      : NaN;
    const reasoningTokens = Number.isFinite(reasoningRaw) ? reasoningRaw : undefined;
    let evalCount = tokenCount;
    if (completionTokens != null) evalCount = completionTokens;
    else if (reasoningTokens != null) evalCount = reasoningTokens;
    send(channel, {
      requestId,
      type: 'done',
      stats: {
        evalCount,
        evalDuration: (totalDuration - (firstTokenTime ? firstTokenTime - started : 0)) * 1e6,
        totalDuration: totalDuration * 1e6,
        promptEvalDuration: (firstTokenTime ? firstTokenTime - started : 0) * 1e6,
        ...(promptTokens != null ? { promptEvalCount: promptTokens } : {}),
        ...(reasoningTokens != null ? { reasoningTokens } : {}),
        doneReason: finishReason || undefined
      }
    });
    completed = true;
    return true;
  } catch (err) {
    if (stopReason === 'idle' || stopReason === 'absolute') {
      send(channel, {
        requestId,
        type: 'error',
        error: streamTimeoutMessage(stopReason, absoluteMs),
        retriable: true,
        code: stopReason === 'absolute' ? 'absolute_timeout' : 'idle_timeout'
      });
    } else if (err.name === 'AbortError') send(channel, { requestId, type: 'aborted' });
    else send(channel, { requestId, type: 'error', error: err.message, retriable: true });
    return false;
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    clearTimeout(absTimer);
    streams.delete(requestId);
    if (!completed) {
      try { controller.abort(); } catch { /* ignore */ }
      if (reader) {
        try { await reader.cancel(); } catch { /* ignore */ }
      }
    }
    tryInstallWhenIdle();
  }
}

let keepAliveCache = { value: '30m', at: 0 };
async function currentKeepAlive() {
  if (Date.now() - keepAliveCache.at < 5000) return keepAliveCache.value || '30m';
  try {
    const data = await readSettingsFile();
    const raw = data && typeof data.keepAlive === 'string' ? data.keepAlive.trim() : '';
    keepAliveCache = { value: raw || '30m', at: Date.now() };
  } catch {
    keepAliveCache = { value: keepAliveCache.value || '30m', at: Date.now() };
  }
  return keepAliveCache.value || '30m';
}

ipcMain.handle('ollama:chat', async (e, requestId, url, body, nodeType, apiKey) => {
  const denied = await webNodeUrlDenial(e, url);
  if (denied) {
    send('ollama:chat-event', { requestId, type: 'error', error: denied, retriable: false });
    return false;
  }
  const base = String(url || '').replace(/\/+$/, '');
  if (!body || typeof body !== 'object') body = {};
  const resolvedKey = await resolveApiKeyForRequest(e, url, apiKey);

  if (nodeType === 'openai' || resolvedKey) {
    // Translate Ollama-style messages (optional images[]) to OpenAI multimodal content parts
    const messages = (body.messages || []).map(m => {
      if (!m.images || !m.images.length) return { role: m.role, content: m.content };
      const parts = [];
      if (m.content) parts.push({ type: 'text', text: m.content });
      for (const img of m.images) {
        const url = String(img).startsWith('data:') ? img : `data:image/png;base64,${img}`;
        parts.push({ type: 'image_url', image_url: { url } });
      }
      return { role: m.role, content: parts };
    });
    const wantsJson = body.format === 'json' || body.format === 'json_object';
    const openAiBody = {
      model: body.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      temperature: body.options?.temperature ?? 0.3,
      max_tokens: frontierMaxTokens(body.options?.num_predict)
    };
    if (wantsJson) openAiBody.response_format = { type: 'json_object' };
    return await streamOpenAI(requestId, base, resolvedKey, openAiBody, 'ollama:chat-event');
  }

  let doneSent = false;
  const keepAlive = body.keep_alive != null ? body.keep_alive : await currentKeepAlive();
  const localBody = { ...body, stream: true, keep_alive: keepAlive };
  if (localBody.think === undefined && (localBody.format === 'json' || localBody.format === 'json_object')) {
    localBody.think = false;
  }
  const ok = await streamNdjson(requestId, `${base}/api/chat`, localBody, 'ollama:chat-event', chunk => {
    const content = chunk.message?.content || '';
    const thinking = chunk.message?.thinking || '';
    if (content || thinking) send('ollama:chat-event', { requestId, type: 'chunk', content, thinking });
    if (chunk.done) {
      doneSent = true;
      send('ollama:chat-event', {
        requestId,
        type: 'done',
        stats: {
          evalCount: chunk.eval_count,
          evalDuration: chunk.eval_duration,
          promptEvalCount: chunk.prompt_eval_count,
          promptEvalDuration: chunk.prompt_eval_duration,
          loadDuration: chunk.load_duration,
          totalDuration: chunk.total_duration,
          doneReason: chunk.done_reason
        }
      });
    }
  });
  if (ok && !doneSent) send('ollama:chat-event', { requestId, type: 'done', stats: {} });
});

// ==========================================
// TOKEN/SEC BENCHMARK RUNNER
// ==========================================

ipcMain.handle('ollama:benchmark', async (e, node, model, numCtx) => {
  const denied = await webNodeUrlDenial(e, node?.url);
  if (denied) return { error: denied };
  const url = (node?.url || '').replace(/\/+$/, '');
  const resolvedKey = await resolveApiKeyForRequest(e, node?.url, node?.apiKey, node?.id);
  const isFrontier = node?.type === 'openai' || !!resolvedKey || !!node?.apiKey;
  const ctxNum = Number(numCtx);
  const num_ctx = Number.isFinite(ctxNum) && ctxNum >= 256 ? Math.floor(ctxNum) : 2048;

  if (isFrontier) {
    const started = Date.now();
    try {
      const baseUrl = normalizeFrontierEndpoint(node.url);
      const endpoint = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
      const headers = { 'Content-Type': 'application/json' };
      const key = resolvedKey || node.apiKey || '';
      if (key) {
        headers['Authorization'] = `Bearer ${key}`;
        if (baseUrl.includes('googleapis.com')) headers['x-goog-api-key'] = key;
      }
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Write a concise Python function to calculate fibonacci numbers.' }],
          max_tokens: 192,
          temperature: 0.1,
          stream: true,
          stream_options: { include_usage: true }
        }),
        signal: AbortSignal.timeout(60000)
      });
      if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let ttftMs = 0;
      let usage = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line.startsWith('data:')) continue;
          const dataStr = line.slice(5).trim();
          if (dataStr === '[DONE]') continue;
          try {
            const parsed = JSON.parse(dataStr);
            if (parsed.usage && typeof parsed.usage === 'object') usage = parsed.usage;
            const delta = parsed.choices?.[0]?.delta || {};
            const text = textFromContent(delta.content || '');
            if (text && !ttftMs) ttftMs = Date.now() - started;
          } catch {
            /* skip */
          }
        }
      }
      const totalMs = Date.now() - started;
      const evalTokens = usage && Number.isFinite(Number(usage.completion_tokens)) ? Number(usage.completion_tokens) : 0;
      const promptTokens = usage && Number.isFinite(Number(usage.prompt_tokens)) ? Number(usage.prompt_tokens) : 0;
      if (!usage) return { error: 'Frontier benchmark returned no usage. This is retriable.' };
      const genMs = Math.max(1, totalMs - (ttftMs || 0));
      return {
        model,
        nodeId: node.id,
        evalTokens,
        evalTokPerSec: evalTokens ? Math.round(evalTokens / (genMs / 1000)) : 0,
        promptTokens,
        promptTokPerSec: promptTokens && ttftMs ? Math.round(promptTokens / (ttftMs / 1000)) : 0,
        loadMs: 0,
        totalMs,
        ttftMs
      };
    } catch (err) {
      return { error: err.message };
    }
  }

  // Embedding-only models (bge-m3, nomic-embed-text) benchmark via /api/embed instead of /api/generate
  const isEmbedModel = model.toLowerCase().includes('embed') || 
                       model.toLowerCase().includes('bge-') || 
                       model.toLowerCase().includes('bge:') || 
                       model.toLowerCase().includes('mxbai');

  if (isEmbedModel) {
    const started = Date.now();
    try {
      const resp = await fetch(`${url}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          input: 'function calculateFibonacci(n) { return n <= 1 ? n : calculateFibonacci(n - 1) + calculateFibonacci(n - 2); }'
        }),
        signal: AbortSignal.timeout(60000)
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        let msg = errText;
        try { msg = JSON.parse(errText).error || errText; } catch {}
        throw new Error(`HTTP ${resp.status}: ${msg}`);
      }
      const data = await resp.json();
      const totalMs = Date.now() - started;
      const dim = Array.isArray(data.embeddings?.[0]) ? data.embeddings[0].length : 0;
      return {
        model,
        nodeId: node.id,
        isEmbedding: true,
        embeddingDim: dim,
        evalTokens: 0,
        evalTokPerSec: 0,
        promptTokens: 1,
        promptTokPerSec: 0,
        loadMs: Math.round((data.load_duration || 0) / 1e6),
        totalMs
      };
    } catch (err) {
      return { error: err.message };
    }
  }

  // Local Ollama generative benchmark. Warmup is discarded; the scored run uses the caller's num_ctx.
  try {
    const keep_alive = await currentKeepAlive();
    const prompt = 'Write a quick Python algorithm for calculating prime numbers up to 500 with inline comments.';
    const generate = async (num_predict, timeoutMs) => {
      const resp = await fetch(`${url}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          think: false,
          keep_alive,
          options: { num_predict, num_ctx, temperature: num_predict === 1 ? 0 : 0.1 }
        }),
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        let msg = errText.slice(0, 500);
        try { msg = JSON.parse(errText).error || msg; } catch { /* keep */ }
        throw new Error(`HTTP ${resp.status}: ${msg}`);
      }
      return resp.json();
    };
    await generate(1, 180000);
    const data = await generate(192, 180000);
    const evalTokPerSec = data.eval_duration ? Math.round(data.eval_count / (data.eval_duration / 1e9)) : 0;
    const promptTokPerSec = data.prompt_eval_duration ? Math.round(data.prompt_eval_count / (data.prompt_eval_duration / 1e9)) : 0;
    const loadMs = Math.round((data.load_duration || 0) / 1e6);
    const totalMs = Math.round((data.total_duration || 0) / 1e6);
    return {
      model,
      nodeId: node.id,
      evalTokens: data.eval_count || 0,
      evalTokPerSec,
      promptTokens: data.prompt_eval_count || 0,
      promptTokPerSec,
      loadMs,
      totalMs,
      numCtx: num_ctx
    };
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return { error: 'Benchmark timed out. Cold weight loading or VRAM swapping took too long. This is retriable.' };
    }
    return { error: err.message };
  }
});

ipcMain.handle('ollama:pull', async (e, requestId, url, model) => {
  const denied = webShellDenial(e) || (await webNodeUrlDenial(e, url));
  if (denied) {
    send('ollama:pull-event', { requestId, type: 'error', error: denied });
    return;
  }
  const base = url.replace(/\/+$/, '');
  const ok = await streamNdjson(requestId, `${base}/api/pull`, { model, stream: true }, 'ollama:pull-event', chunk => {
    send('ollama:pull-event', {
      requestId,
      type: 'progress',
      status: chunk.status,
      completed: chunk.completed,
      total: chunk.total
    });
  }, { idleMs: STREAM_IDLE_MS, absoluteMs: 2 * 60 * 60 * 1000 });
  if (ok) send('ollama:pull-event', { requestId, type: 'done' });
});

ipcMain.handle('ollama:abort', (_e, requestId) => {
  const c = streams.get(requestId);
  if (c) c.abort();
  return { success: !!c };
});

ipcMain.handle('ollama:delete', async (e, url, model) => {
  const shellDenied = webShellDenial(e);
  if (shellDenied) return { error: shellDenied };
  const denied = await webNodeUrlDenial(e, url);
  if (denied) return { error: denied };
  try {
    const resp = await fetch(`${url.replace(/\/+$/, '')}/api/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(30000)
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${(await resp.text()).slice(0, 300)}`);
    return { success: true };
  } catch (err) {
    const message = err && (err.name === 'TimeoutError' || err.name === 'AbortError')
      ? 'Deleting the model timed out. This is retriable.'
      : err.message;
    return { error: message };
  }
});

// Load (keep_alive>0) or unload (keep_alive=0) a model without a real generation.
ipcMain.handle('ollama:keepalive', async (e, url, model, keepAlive) => {
  const denied = await webNodeUrlDenial(e, url);
  if (denied) return { error: denied };
  try {
    await fetchJson(`${url.replace(/\/+$/, '')}/api/generate`, {
      method: 'POST',
      timeoutMs: 120000,
      body: { model, keep_alive: keepAlive, prompt: '', stream: false, think: false }
    });
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

/** One-token generate so a swarm wave does not pay a cold load. */
ipcMain.handle('ollama:warm', async (e, url, model, numCtx, keepAlive) => {
  const denied = await webNodeUrlDenial(e, url);
  if (denied) return { error: denied };
  const base = String(url || '').replace(/\/+$/, '');
  if (!base || !model) return { error: 'url and model are required' };
  const ctx = Number(numCtx);
  const ka = keepAlive != null && keepAlive !== '' ? keepAlive : await currentKeepAlive();
  try {
    await fetchJson(`${base}/api/generate`, {
      method: 'POST',
      timeoutMs: 180000,
      body: {
        model,
        prompt: ' ',
        stream: false,
        think: false,
        keep_alive: ka,
        options: {
          num_predict: 1,
          temperature: 0,
          ...(Number.isFinite(ctx) && ctx >= 256 ? { num_ctx: Math.floor(ctx) } : {})
        }
      }
    });
    return { success: true };
  } catch (err) {
    return { error: err.message || 'Warmup failed. This is retriable.' };
  }
});

// Look up a tag on the public Ollama registry: confirms it exists and returns the exact download size.
ipcMain.handle('registry:lookup', async (_e, tag) => {
  try {
    let [name, version] = tag.trim().split(':');
    version = version || 'latest';
    const repo = name.includes('/') ? name : `library/${name}`;
    const resp = await fetch(`https://registry.ollama.ai/v2/${repo}/manifests/${version}`, {
      headers: { Accept: 'application/vnd.docker.distribution.manifest.v2+json' },
      signal: AbortSignal.timeout(8000)
    });
    if (resp.status === 404) return { exists: false };
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const manifest = await resp.json();
    const size = (manifest.layers || []).reduce((s, l) => s + (l.size || 0), 0);
    return { exists: true, sizeBytes: size };
  } catch (err) {
    return { error: err.message };
  }
});

// ==========================================
// LOCAL HARDWARE DETECTION
// ==========================================

function run(cmd, args) {
  return new Promise(resolve => {
    execFile(cmd, args, { windowsHide: true, timeout: 8000 }, (err, stdout) => resolve(err ? '' : stdout.toString()));
  });
}

ipcMain.handle('app:getVersion', () => app.getVersion());

ipcMain.handle('system:detect-hardware', async () => {
  const cpu = (os.cpus()[0]?.model || 'Unknown CPU').replace(/\s+/g, ' ').trim();
  const ramGB = Math.round(os.totalmem() / 1024 ** 3);
  let gpu = '';
  let vramGB = 0;
  const smi = await run('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits']);
  if (smi.trim()) {
    const [name, mem] = smi.trim().split('\n')[0].split(',').map(s => s.trim());
    gpu = name.replace(/^NVIDIA\s+/i, '').replace(/^GeForce\s+/i, '');
    vramGB = Math.round(parseInt(mem, 10) / 1024);
  } else {
    // AMD / Intel Arc / iGPU fallback via WMI when nvidia-smi is absent.
    const video = await run('powershell.exe', [
      '-NoProfile',
      '-Command',
      '(Get-CimInstance Win32_VideoController | Where-Object { $_.Name -and $_.Name -notmatch "Microsoft Basic" } | Select-Object -First 1 Name, AdapterRAM) | ForEach-Object { "$($_.Name)|$($_.AdapterRAM)" }'
    ]);
    if (video.trim()) {
      const [name, ram] = video.trim().split('|').map(s => s.trim());
      gpu = (name || '').replace(/^AMD\s+/i, '');
      const bytes = parseInt(ram, 10);
      if (Number.isFinite(bytes) && bytes > 0) vramGB = Math.max(1, Math.round(bytes / 1024 ** 3));
    }
  }
  // RAM speed -> approximate dual-channel bandwidth: MT/s * 8 bytes * channels
  let ramMTs = 0;
  let dimms = 0;
  const memInfo = await run('powershell.exe', [
    '-NoProfile', '-Command',
    '(Get-CimInstance Win32_PhysicalMemory | Select-Object -ExpandProperty ConfiguredClockSpeed) -join ","'
  ]);
  if (memInfo.trim()) {
    const speeds = memInfo.trim().split(',').map(Number).filter(Boolean);
    dimms = speeds.length;
    ramMTs = Math.max(...speeds, 0);
  }
  const channels = dimms >= 2 ? 2 : 1;
  const ramBandwidthGBs = ramMTs ? Math.round((ramMTs * 8 * channels) / 1000) : 0;
  return { cpu, ramGB, gpu, vramGB, ramMTs, ramBandwidthGBs };
});

// ==========================================
// HELPERS
// ==========================================

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

// ==========================================
// AUTO-UPDATE (NSIS install only — portable is manual)
// ==========================================

/** True when the user launched the single-file portable wrapper. */
function isPortableBuild() {
  return !!(process.env.PORTABLE_EXECUTABLE_FILE || process.env.PORTABLE_EXECUTABLE_DIR);
}

let rendererBusy = false;
let installWhenIdle = false;
/** Set only by the desktop Restart/Update action. Unsigned builds never install on idle alone. */
let userConfirmedInstall = false;
let updateCheckTimer = null;
const updateState = {
  supported: false,
  state: 'idle',
  currentVersion: app.getVersion(),
  version: null,
  percent: 0,
  message: '',
  error: null,
  unsigned: !VERIFY_UPDATE_CODE_SIGNATURE
};

function pushUpdateStatus(partial = {}) {
  Object.assign(updateState, partial);
  send('update:status', { ...updateState });
}

function appIsIdle() {
  return !rendererBusy && streams.size === 0;
}

function tryInstallWhenIdle() {
  if (!installWhenIdle) return;
  if (!VERIFY_UPDATE_CODE_SIGNATURE && !userConfirmedInstall) return;
  if (!appIsIdle()) {
    pushUpdateStatus({
      state: 'waiting-idle',
      message: 'Update ready. Waiting for model calls to finish before restarting.'
    });
    return;
  }
  installWhenIdle = false;
  userConfirmedInstall = false;
  pushUpdateStatus({ state: 'installing', message: 'Restarting to apply the update…' });
  try {
    // isSilent=false, isForceRunAfter=true — relaunch after NSIS finishes
    require('electron-updater').autoUpdater.quitAndInstall(false, true);
  } catch (err) {
    pushUpdateStatus({
      state: 'error',
      error: err?.message || String(err),
      message: 'Could not start the installer.'
    });
  }
}

function setupAutoUpdater() {
  updateState.currentVersion = app.getVersion();

  if (!app.isPackaged) {
    pushUpdateStatus({
      supported: false,
      state: 'unsupported',
      message: 'Updates are only checked in a packaged install (not npm run dev).'
    });
    return;
  }

  if (isPortableBuild()) {
    pushUpdateStatus({
      supported: false,
      state: 'unsupported',
      message: 'Portable builds update by downloading a new exe from GitHub. Use the Setup installer for in-app updates.'
    });
    return;
  }

  let autoUpdater;
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (err) {
    pushUpdateStatus({
      supported: false,
      state: 'error',
      error: err?.message || String(err),
      message: 'Updater module failed to load.'
    });
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  // Releases are currently unsigned; skip the Win code-signature gate and tell the UI.
  if (typeof autoUpdater.verifyUpdateCodeSignature === 'boolean' || 'verifyUpdateCodeSignature' in autoUpdater) {
    autoUpdater.verifyUpdateCodeSignature = VERIFY_UPDATE_CODE_SIGNATURE;
  }

  try {
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: 'HipHopGrinch',
      repo: 'LocalAgents-Studio'
    });
  } catch (err) {
    appendLog('warn', `updater setFeedURL: ${err?.message || err}`);
  }

  autoUpdater.on('checking-for-update', () => {
    pushUpdateStatus({
      supported: true,
      state: 'checking',
      message: 'Checking GitHub for a newer release…',
      error: null
    });
  });

  autoUpdater.on('update-available', info => {
    pushUpdateStatus({
      supported: true,
      state: 'available',
      version: info?.version || null,
      percent: 0,
      message: `Version ${info?.version || '?'} is available.`,
      error: null,
      unsigned: !VERIFY_UPDATE_CODE_SIGNATURE
    });
  });

  autoUpdater.on('update-not-available', () => {
    pushUpdateStatus({
      supported: true,
      state: 'up-to-date',
      version: null,
      percent: 0,
      message: `You are on the latest version (${app.getVersion()}).`,
      error: null
    });
  });

  autoUpdater.on('download-progress', progress => {
    const percent = Math.max(0, Math.min(100, Math.round(progress?.percent || 0)));
    pushUpdateStatus({
      supported: true,
      state: 'downloading',
      percent,
      message: `Downloading update… ${percent}%`,
      error: null
    });
  });

  autoUpdater.on('update-downloaded', info => {
    pushUpdateStatus({
      supported: true,
      state: 'downloaded',
      version: info?.version || updateState.version,
      percent: 100,
      message: VERIFY_UPDATE_CODE_SIGNATURE
        ? `Version ${info?.version || updateState.version || ''} downloaded. Will restart when idle.`
        : `Version ${info?.version || updateState.version || ''} downloaded. Restart to install.`,
      error: null
    });
    if (VERIFY_UPDATE_CODE_SIGNATURE) {
      installWhenIdle = true;
      tryInstallWhenIdle();
    }
  });

  autoUpdater.on('error', err => {
    appendLog('error', `updater: ${err?.message || err}`);
    pushUpdateStatus({
      supported: true,
      state: 'error',
      error: err?.message || String(err),
      message: 'Update check or download failed.'
    });
  });

  pushUpdateStatus({
    supported: true,
    state: 'idle',
    message: `Installed version ${app.getVersion()}.`
  });

  // Quiet check a few seconds after launch; user can also check manually.
  updateCheckTimer = setTimeout(() => {
    autoUpdater.checkForUpdates().catch(err => {
      appendLog('warn', `updater check: ${err?.message || err}`);
    });
  }, 8000);
}

ipcMain.handle('update:getStatus', () => ({ ...updateState }));

ipcMain.handle('update:check', async () => {
  if (!updateState.supported) return { ...updateState };
  try {
    const { autoUpdater } = require('electron-updater');
    await autoUpdater.checkForUpdates();
  } catch (err) {
    pushUpdateStatus({
      state: 'error',
      error: err?.message || String(err),
      message: 'Update check failed.'
    });
  }
  return { ...updateState };
});

ipcMain.handle('update:download', async (e) => {
  if (e?.webConsole) {
    return { ...updateState, error: 'Downloading updates is only available in the Studio desktop app.' };
  }
  if (!updateState.supported) return { ...updateState };
  if (updateState.state === 'downloading' || updateState.state === 'downloaded' || updateState.state === 'waiting-idle') {
    return { ...updateState };
  }
  try {
    pushUpdateStatus({
      state: 'downloading',
      percent: 0,
      message: 'Starting download…',
      error: null
    });
    const { autoUpdater } = require('electron-updater');
    await autoUpdater.downloadUpdate();
  } catch (err) {
    pushUpdateStatus({
      state: 'error',
      error: err?.message || String(err),
      message: 'Download failed.'
    });
  }
  return { ...updateState };
});

ipcMain.handle('update:install', async (e) => {
  if (e?.webConsole) {
    return { ...updateState, error: 'Installing updates is only available in the Studio desktop app.' };
  }
  if (!updateState.supported) return { ...updateState };
  userConfirmedInstall = true;
  installWhenIdle = true;
  if (updateState.state !== 'downloaded' && updateState.state !== 'waiting-idle' && updateState.state !== 'installing') {
    // Download first if needed, then install when idle via update-downloaded.
    try {
      const { autoUpdater } = require('electron-updater');
      if (updateState.state === 'available' || updateState.state === 'up-to-date' || updateState.state === 'idle') {
        pushUpdateStatus({ state: 'downloading', percent: 0, message: 'Starting download…', error: null });
        await autoUpdater.downloadUpdate();
      }
    } catch (err) {
      pushUpdateStatus({
        state: 'error',
        error: err?.message || String(err),
        message: 'Download failed.'
      });
      return { ...updateState };
    }
  }
  tryInstallWhenIdle();
  return { ...updateState };
});

ipcMain.handle('update:setBusy', (e, busy) => {
  if (e?.webConsole) return { busy: false, idle: appIsIdle() };
  rendererBusy = !!busy;
  if (installWhenIdle && !rendererBusy) tryInstallWhenIdle();
  return { busy: rendererBusy, idle: appIsIdle() };
});
