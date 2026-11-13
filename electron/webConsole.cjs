/**
 * Opt-in web console hosted inside the Electron main process.
 * Serves the Vite `dist/` UI and bridges ElectronAPI over authenticated WebSockets.
 *
 * Default bind is 127.0.0.1. LAN (0.0.0.0) requires lanEnabled.
 * When both PEM paths are set and readable, the listener is HTTPS/WSS.
 * The session token is sent in the first WebSocket message, not the query string.
 */
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const DEFAULT_PORT = 3847;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const AUTH_TIMEOUT_MS = 5000;
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const SECURITY_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'"
].join('; ');

/**
 * Channels the web UI actually calls (hostApi.ts / preload.cjs).
 * Anything else is rejected even after login.
 */
const WEB_RPC_ALLOW = new Set([
  'settings:load',
  'settings:save',
  'settings:path',
  'settings:openFolder',
  'settings:exportNodes',
  'settings:importNodes',
  'logs:write',
  'logs:readTail',
  'logs:path',
  'logs:openFolder',
  'logs:reportToGitHub',
  'workspace:default',
  'workspace:resolve-path',
  'workspace:projectsRoot',
  'workspace:listProjects',
  'workspace:createProject',
  'project:loadChats',
  'project:saveChats',
  'fs:read-dir',
  'fs:read-file',
  'fs:write-file',
  'fs:create-file',
  'fs:create-folder',
  'fs:delete',
  'fs:reveal',
  'tools:exec',
  'workspace:typecheck',
  'workspace:installDeps',
  'workspace:hasPackageJson',
  'web:search',
  'mcp:call',
  'image:generate',
  'terminal:execute',
  'git:run',
  'terminal:kill',
  'terminal:getBuffer',
  'terminal:clearBuffer',
  'ollama:status',
  'ollama:chat',
  'ollama:benchmark',
  'ollama:pull',
  'ollama:abort',
  'ollama:delete',
  'ollama:keepalive',
  'ollama:warm',
  'ollama:show',
  'registry:lookup',
  'app:getVersion',
  'system:detect-hardware',
  'update:getStatus',
  'update:check',
  'webConsole:getStatus',
  'session:get',
  'session:publish'
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.webp': 'image/webp'
};

/** @type {import('http').Server | import('https').Server | null} */
let server = null;
/** @type {WebSocketServer | null} */
let wss = null;
/** @type {Map<string, { expires: number }>} */
const sessions = new Map();
/** @type {Map<string, { count: number; lockedUntil: number }>} */
const loginAttempts = new Map();
/** @type {Set<import('ws').WebSocket>} */
const clients = new Set();

/** @type {{ invokeRpc: (channel: string, args: any[]) => Promise<any>, getDistDir: () => string, getViteDevUrl: () => string | null, appendLog?: (level: string, msg: string) => void, onClientConnected?: () => void, onClientCountChanged?: (count: number) => void } | null} */
let deps = null;

/** @type {{ enabled: boolean, port: number, passwordHash?: string, passwordSalt?: string, lanEnabled: boolean, allowShell: boolean, tlsCertPath: string, tlsKeyPath: string, tls: boolean, tlsError: string, bindHost: string }} */
let config = {
  enabled: false,
  port: DEFAULT_PORT,
  lanEnabled: false,
  allowShell: false,
  tlsCertPath: '',
  tlsKeyPath: '',
  tls: false,
  tlsError: '',
  lanError: '',
  bindHost: '127.0.0.1'
};

function log(level, msg) {
  if (deps?.appendLog) deps.appendLog(level, `[webConsole] ${msg}`);
  else console[level === 'error' ? 'error' : 'log'](`[webConsole] ${msg}`);
}

function scryptAsync(password, salt, keylen) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password), salt, keylen, SCRYPT_OPTS, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

async function hashPassword(password, saltBuf) {
  const key = await scryptAsync(password, saltBuf, 32);
  return key.toString('base64');
}

async function verifyPassword(password, hashB64, saltB64) {
  if (!password || !hashB64 || !saltB64) return false;
  try {
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = await scryptAsync(password, salt, expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

async function createPasswordRecord(password) {
  const pwd = String(password || '');
  if (pwd.length < 8) {
    return { error: 'Password must be at least 8 characters' };
  }
  const salt = crypto.randomBytes(16);
  return {
    passwordSalt: salt.toString('base64'),
    passwordHash: await hashPassword(pwd, salt)
  };
}

function issueSession() {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(token, { expires: Date.now() + SESSION_TTL_MS });
  return token;
}

function sessionValid(token) {
  if (!token) return false;
  const s = sessions.get(token);
  if (!s) return false;
  if (Date.now() > s.expires) {
    sessions.delete(token);
    return false;
  }
  s.expires = Date.now() + SESSION_TTL_MS;
  return true;
}

function revokeSession(token) {
  if (token) sessions.delete(token);
}

function allowShell() {
  return !!config.allowShell;
}

/**
 * @returns {string|null} error message when the web client may not call this method
 */
function webRpcDenial(channel, args) {
  const name = String(channel || '');
  if (!WEB_RPC_ALLOW.has(name)) return `Method not available on the web console: ${name}`;
  const shellDenied = !config.allowShell;
  if (!shellDenied) return null;
  if (
    name === 'terminal:execute' ||
    name === 'terminal:kill' ||
    name === 'terminal:getBuffer' ||
    name === 'terminal:clearBuffer' ||
    name === 'git:run' ||
    name === 'mcp:call' ||
    name === 'workspace:installDeps' ||
    name === 'fs:delete' ||
    name === 'ollama:delete' ||
    name === 'ollama:pull' ||
    name === 'web:search'
  ) {
    return 'Shell and delete tools are disabled for the web console';
  }
  if (name === 'tools:exec') {
    const toolName = Array.isArray(args) ? args[1] : '';
    if (toolName === 'run_command' || toolName === 'read_terminal') {
      return 'Shell and delete tools are disabled for the web console';
    }
  }
  return null;
}

function listLanAddresses() {
  const nets = os.networkInterfaces();
  const out = [];
  for (const name of Object.keys(nets || {})) {
    for (const net of nets[name] || []) {
      if (net.family !== 'IPv4' && net.family !== 4) continue;
      if (net.internal) continue;
      out.push(net.address);
    }
  }
  return out;
}

function scheme() {
  return config.tls ? 'https' : 'http';
}

/** Candidate URLs for the configured port (shown even before listen succeeds). */
function candidateUrls(port = config.port || DEFAULT_PORT) {
  const p = Number(port) > 0 ? Math.floor(Number(port)) : DEFAULT_PORT;
  const proto = scheme();
  const urls = [`${proto}://127.0.0.1:${p}`];
  const lanReachable = config.lanEnabled && config.bindHost === '0.0.0.0' && config.tls;
  if (lanReachable) {
    for (const ip of listLanAddresses()) urls.push(`${proto}://${ip}:${p}`);
  }
  return urls;
}

/**
 * LAN without TLS material stays on loopback and reports an error.
 * Empty cert paths are not a successful TLS load.
 */
function resolveListenPlan({ lanEnabled, tlsLoaded, tlsError } = {}) {
  if (lanEnabled && !tlsLoaded) {
    const error = tlsError
      ? `Refusing LAN bind without readable TLS certificates: ${tlsError}`
      : 'Refusing LAN bind without TLS. The console stays on this PC (127.0.0.1) until a certificate and private key are set.';
    return { bindHost: '127.0.0.1', tls: false, error, lanError: error };
  }
  return {
    bindHost: lanEnabled ? '0.0.0.0' : '127.0.0.1',
    tls: !!tlsLoaded,
    error: '',
    lanError: ''
  };
}

function listeningUrls() {
  if (!server || !config.enabled || !server.listening) return [];
  return candidateUrls(config.port);
}

function getStatus() {
  return {
    enabled: !!config.enabled,
    port: config.port || DEFAULT_PORT,
    listening: !!(server && server.listening),
    hasPassword: !!(config.passwordHash && config.passwordSalt),
    urls: listeningUrls(),
    /** Always filled so the Hardware UI can show what to open after Enable. */
    candidateUrls: candidateUrls(config.port),
    lanAddresses: listLanAddresses(),
    clientCount: clients.size,
    lanEnabled: !!config.lanEnabled,
    allowShell: !!config.allowShell,
    tls: !!config.tls,
    bindHost: config.bindHost || '127.0.0.1',
    tlsError: config.tlsError || '',
    lanError: config.lanError || ''
  };
}

function securityHeaders(extra = {}) {
  return {
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': SECURITY_CSP,
    ...extra
  };
}

function parseBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(
    status,
    securityHeaders({
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store'
    })
  );
  res.end(body);
}

async function proxyVite(req, res, viteUrl) {
  try {
    const target = new URL(req.url || '/', viteUrl);
    const base = new URL(viteUrl);
    target.protocol = base.protocol;
    target.host = base.host;
    const upstream = await fetch(target.href, {
      method: req.method,
      headers: { ...(req.headers.host ? { host: base.host } : {}) },
      signal: AbortSignal.timeout(20000)
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    const headers = securityHeaders();
    upstream.headers.forEach((v, k) => {
      if (k === 'transfer-encoding' || k === 'content-security-policy' || k === 'x-frame-options') return;
      headers[k] = v;
    });
    res.writeHead(upstream.status, headers);
    res.end(buf);
  } catch (err) {
    sendJson(res, 502, { error: `Vite proxy failed: ${err.message}` });
  }
}

async function serveStatic(req, res) {
  const distDir = deps.getDistDir();
  const viteUrl = deps.getViteDevUrl?.() || null;
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  if (viteUrl && (!fs.existsSync(distDir) || !fs.existsSync(path.join(distDir, 'index.html')))) {
    return proxyVite(req, res, viteUrl);
  }

  const safe = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const distRoot = path.resolve(distDir);
  let filePath = path.resolve(path.join(distRoot, safe));
  if (filePath !== distRoot && !filePath.startsWith(distRoot + path.sep)) {
    res.writeHead(403, securityHeaders());
    return res.end('Forbidden');
  }

  try {
    let st = await fsp.stat(filePath).catch(() => null);
    if (!st || !st.isFile()) {
      filePath = path.join(distDir, 'index.html');
      st = await fsp.stat(filePath);
    }
    const ext = path.extname(filePath).toLowerCase();
    const data = await fsp.readFile(filePath);
    res.writeHead(
      200,
      securityHeaders({
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600'
      })
    );
    res.end(data);
  } catch {
    if (viteUrl) return proxyVite(req, res, viteUrl);
    res.writeHead(404, securityHeaders());
    res.end('Not found — build the UI (npm run build) or run the Vite dev server.');
  }
}

async function handleApi(req, res) {
  const url = new URL(req.url || '/', 'http://127.0.0.1');

  if (req.method === 'GET' && url.pathname === '/api/status') {
    return sendJson(res, 200, {
      enabled: getStatus().listening,
      hasPassword: getStatus().hasPassword,
      tls: !!config.tls,
      lanEnabled: !!config.lanEnabled,
      version: 'web-console'
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/login') {
    try {
      const body = await parseBody(req, 64_000);
      const password = String(body.password || '');
      if (!config.enabled || !server) {
        return sendJson(res, 503, { error: 'Web console is not running' });
      }
      const ip = String(req.socket?.remoteAddress || 'unknown');
      const now = Date.now();
      let attempt = loginAttempts.get(ip);
      if (!attempt) {
        attempt = { count: 0, lockedUntil: 0 };
        loginAttempts.set(ip, attempt);
      }
      if (attempt.lockedUntil > now) {
        const waitSec = Math.ceil((attempt.lockedUntil - now) / 1000);
        return sendJson(res, 429, { error: `Too many attempts. Retry in ${waitSec}s` });
      }
      attempt.count += 1;
      if (attempt.count >= 5) {
        const lockMs = Math.min(60_000 * 2 ** Math.min(attempt.count - 5, 4), 15 * 60_000);
        attempt.lockedUntil = now + lockMs;
      }
      const ok = await verifyPassword(password, config.passwordHash, config.passwordSalt);
      if (!ok) {
        return sendJson(res, 401, { error: 'Invalid password' });
      }
      loginAttempts.delete(ip);
      const token = issueSession();
      return sendJson(res, 200, { token, urls: listeningUrls() });
    } catch (err) {
      return sendJson(res, 400, { error: err.message || 'Login failed' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/logout') {
    try {
      const body = await parseBody(req, 64_000);
      revokeSession(body.token);
      return sendJson(res, 200, { success: true });
    } catch {
      return sendJson(res, 200, { success: true });
    }
  }

  sendJson(res, 404, { error: 'Not found' });
}

function handleHttp(req, res) {
  const url = req.url || '/';
  if (url.startsWith('/api/')) {
    handleApi(req, res).catch(err => {
      log('error', err.message);
      sendJson(res, 500, { error: 'Internal error' });
    });
    return;
  }
  serveStatic(req, res).catch(err => {
    log('error', err.message);
    res.writeHead(500, securityHeaders());
    res.end('Internal error');
  });
}

function originAllowed(req) {
  const origin = req && req.headers ? req.headers.origin : '';
  const hostHeader = req && req.headers ? req.headers.host : '';
  if (!origin || !hostHeader) return false;
  let parsed;
  try {
    parsed = new URL(String(origin));
  } catch {
    return false;
  }
  const expectedProto = config.tls ? 'https:' : 'http:';
  if (parsed.protocol !== expectedProto) return false;
  if (parsed.host.toLowerCase() !== String(hostHeader).toLowerCase()) return false;
  return true;
}

function attachWebSocket() {
  wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: 12 * 1024 * 1024,
    verifyClient: info => originAllowed(info.req)
  });
  wss.on('connection', (socket, req) => {
    if (!originAllowed(req)) {
      socket.close(4403, 'Origin rejected');
      return;
    }
    socket.__authed = false;
    const authTimer = setTimeout(() => {
      if (!socket.__authed) {
        try {
          socket.close(4401, 'Auth timeout');
        } catch {
          /* ignore */
        }
      }
    }, AUTH_TIMEOUT_MS);

    socket.on('message', raw => {
      if (!socket.__authed) {
        let msg;
        try {
          msg = JSON.parse(String(raw));
        } catch {
          socket.close(4401, 'Unauthorized');
          return;
        }
        if (msg && msg.type === 'auth' && sessionValid(msg.token)) {
          socket.__authed = true;
          socket.__token = String(msg.token);
          clearTimeout(authTimer);
          clients.add(socket);
          notifyClientCount();
          try {
            socket.send(JSON.stringify({ type: 'hello', status: getStatus() }));
          } catch {
            /* ignore */
          }
          if (typeof deps?.onClientConnected === 'function') {
            try {
              deps.onClientConnected();
            } catch {
              /* ignore */
            }
          }
          return;
        }
        socket.close(4401, 'Unauthorized');
        return;
      }
      handleWsMessage(socket, raw).catch(err => {
        try {
          socket.send(JSON.stringify({ type: 'error', error: err.message || String(err) }));
        } catch {
          /* ignore */
        }
      });
    });

    socket.on('close', () => {
      clearTimeout(authTimer);
      if (clients.delete(socket)) notifyClientCount();
    });
  });
}

async function handleWsMessage(socket, raw) {
  let msg;
  try {
    msg = JSON.parse(String(raw));
  } catch {
    return;
  }
  if (!socket.__authed || !sessionValid(socket.__token)) {
    socket.close(4401, 'Unauthorized');
    return;
  }

  if (msg.type === 'ping') {
    socket.send(JSON.stringify({ type: 'pong', t: Date.now() }));
    return;
  }

  if (msg.type === 'auth') return;
  if (msg.type !== 'rpc' || msg.id == null) return;
  const channel = String(msg.method || '');
  const args = Array.isArray(msg.args) ? msg.args : [];
  const denial = webRpcDenial(channel, args);
  if (denial) {
    socket.send(JSON.stringify({ type: 'rpc-result', id: msg.id, error: denial }));
    return;
  }

  try {
    if (!deps?.invokeRpc) throw new Error('RPC not ready');
    const result = await deps.invokeRpc(channel, args);
    socket.send(JSON.stringify({ type: 'rpc-result', id: msg.id, result }));
  } catch (err) {
    socket.send(
      JSON.stringify({
        type: 'rpc-result',
        id: msg.id,
        error: err && err.message ? err.message : String(err)
      })
    );
  }
}

/** Authenticated clients only; the desktop uses this to decide whether to publish the chat mirror. */
function clientCount() {
  return clients.size;
}

function notifyClientCount() {
  if (typeof deps?.onClientCountChanged !== 'function') return;
  try {
    deps.onClientCountChanged(clients.size);
  } catch {
    /* ignore */
  }
}

// A stalled browser must not make the main process buffer every snapshot for it.
const SNAPSHOT_SKIP_BUFFERED_BYTES = 4 * 1024 * 1024;
const SLOW_CLIENT_CLOSE_BUFFERED_BYTES = 64 * 1024 * 1024;

function broadcast(channel, payload) {
  if (!clients.size) return;
  const packet = JSON.stringify({ type: 'event', channel, payload });
  for (const socket of clients) {
    if (socket.readyState === 1 && socket.__authed) {
      const buffered = Number(socket.bufferedAmount) || 0;
      // Snapshots are superseded by the next one; dropping a stale one is safe. Stream chunks are not.
      if (channel === 'session:changed' && buffered > SNAPSHOT_SKIP_BUFFERED_BYTES) continue;
      if (buffered > SLOW_CLIENT_CLOSE_BUFFERED_BYTES) {
        try {
          socket.close(1013, 'Client too slow');
        } catch {
          /* ignore */
        }
        continue;
      }
      try {
        socket.send(packet);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * @param {{ clearSessions?: boolean }} [opts]
 * clearSessions=false keeps login tokens across a port-bind retry / same-password restart.
 */
function stopServer(opts = {}) {
  const clearSessions = opts.clearSessions !== false;
  for (const socket of clients) {
    try {
      socket.close(1001, 'Console stopped');
    } catch {
      /* ignore */
    }
  }
  const hadClients = clients.size > 0;
  clients.clear();
  if (hadClients) notifyClientCount();
  if (clearSessions) sessions.clear();
  if (wss) {
    try {
      wss.close();
    } catch {
      /* ignore */
    }
    wss = null;
  }
  if (server) {
    try {
      server.close();
    } catch {
      /* ignore */
    }
    server = null;
  }
}

function loadTlsMaterial() {
  const certPath = String(config.tlsCertPath || '').trim();
  const keyPath = String(config.tlsKeyPath || '').trim();
  if (!certPath && !keyPath) return { enabled: false };
  if (!certPath || !keyPath) {
    return { enabled: false, error: 'Set both a TLS certificate and a private key' };
  }
  try {
    const cert = fs.readFileSync(certPath);
    const key = fs.readFileSync(keyPath);
    if (!cert.length || !key.length) throw new Error('empty PEM');
    return { enabled: true, cert, key };
  } catch (err) {
    return { enabled: false, error: err.message || 'TLS certificate or key is not readable' };
  }
}

function startServer(opts = {}) {
  stopServer({ clearSessions: opts.clearSessions !== false });
  if (!config.enabled) return Promise.resolve({ success: true, listening: false });
  if (!config.passwordHash || !config.passwordSalt) {
    log('warn', 'Web console enabled but no password set — not listening');
    return Promise.resolve({ success: false, error: 'Set a web console password before enabling' });
  }
  const port = Number(config.port) > 0 ? Math.floor(Number(config.port)) : DEFAULT_PORT;
  config.port = port;

  const tlsMat = loadTlsMaterial();
  const plan = resolveListenPlan({
    lanEnabled: !!config.lanEnabled,
    tlsLoaded: !!tlsMat.enabled,
    tlsError: tlsMat.error || ''
  });
  config.tls = !!plan.tls && !!tlsMat.enabled;
  config.bindHost = plan.bindHost;
  config.lanError = plan.lanError || '';
  config.tlsError = plan.lanError || tlsMat.error || '';
  if (plan.lanError) {
    log('error', plan.lanError);
  }

  server = tlsMat.enabled
    ? https.createServer({ cert: tlsMat.cert, key: tlsMat.key }, handleHttp)
    : http.createServer(handleHttp);
  attachWebSocket();

  return new Promise(resolve => {
    server.once('error', err => {
      log('error', `listen failed: ${err.message}`);
      stopServer({ clearSessions: false });
      resolve({ success: false, error: err.message });
    });
    server.listen(port, config.bindHost, () => {
      log('info', `listening on ${config.bindHost}:${port} (${scheme()})`);
      resolve({ success: true, listening: true, ...getStatus() });
    });
  });
}

/**
 * Apply settings.webConsole and restart the server when bind, port, TLS, or password change.
 * @param {object} next partial webConsole settings from AppSettings
 */
async function applyConfig(next = {}) {
  const prevPort = config.port;
  const prevEnabled = config.enabled;
  const prevHash = config.passwordHash || '';
  const prevSalt = config.passwordSalt || '';
  const prevLan = !!config.lanEnabled;
  const prevCert = config.tlsCertPath || '';
  const prevKey = config.tlsKeyPath || '';
  const prevShell = !!config.allowShell;

  const nextEnabled = !!next.enabled;
  const nextPort = Number(next.port) > 0 ? Math.floor(Number(next.port)) : DEFAULT_PORT;
  const nextHash =
    typeof next.passwordHash === 'string' && next.passwordHash ? next.passwordHash : config.passwordHash;
  const nextSalt =
    typeof next.passwordSalt === 'string' && next.passwordSalt ? next.passwordSalt : config.passwordSalt;
  const nextLan = !!next.lanEnabled;
  const nextShell = !!next.allowShell;
  const nextCert = typeof next.tlsCertPath === 'string' ? next.tlsCertPath : config.tlsCertPath || '';
  const nextKey = typeof next.tlsKeyPath === 'string' ? next.tlsKeyPath : config.tlsKeyPath || '';

  const passwordChanged = (nextHash || '') !== prevHash || (nextSalt || '') !== prevSalt;
  const bindChanged = prevLan !== nextLan || prevCert !== nextCert || prevKey !== nextKey;

  config = {
    ...config,
    enabled: nextEnabled,
    port: nextPort,
    passwordHash: nextHash,
    passwordSalt: nextSalt,
    lanEnabled: nextLan,
    allowShell: nextShell,
    tlsCertPath: nextCert,
    tlsKeyPath: nextKey
  };

  if (!config.enabled) {
    if (prevEnabled) log('info', 'disabled — stopping listener');
    stopServer({ clearSessions: true });
    return getStatus();
  }

  const needRestart =
    !server ||
    !server.listening ||
    prevPort !== config.port ||
    !prevEnabled ||
    passwordChanged ||
    bindChanged;

  if (!needRestart) {
    if (prevShell !== nextShell) log('info', `allowShell=${nextShell}`);
    return getStatus();
  }

  log(
    'info',
    `restart listener (port ${config.port}, lan=${nextLan}, tls=${nextCert && nextKey ? 'requested' : 'off'}, passwordChanged=${passwordChanged})`
  );
  const started = await startServer({ clearSessions: passwordChanged || !prevEnabled });
  const status = getStatus();
  if (started && started.error) return { ...status, error: started.error };
  if (status.lanError) return { ...status, error: status.lanError };
  return status;
}

async function setPassword(password) {
  const rec = await createPasswordRecord(password);
  if (rec.error) return rec;
  config.passwordHash = rec.passwordHash;
  config.passwordSalt = rec.passwordSalt;
  return { success: true, ...rec };
}

function clearPassword() {
  config.passwordHash = undefined;
  config.passwordSalt = undefined;
  sessions.clear();
  return { success: true };
}

function init(options) {
  deps = { ...(deps || {}), ...(options || {}) };
}

/** Register/replace hooks after init (e.g. live-session seed when a browser connects). */
function setHooks(hooks = {}) {
  deps = { ...(deps || {}), ...hooks };
}

/** Settings object safe to return to any client (no password hash). */
function publicConfig() {
  return {
    enabled: !!config.enabled,
    port: config.port || DEFAULT_PORT,
    lanEnabled: !!config.lanEnabled,
    allowShell: !!config.allowShell,
    tlsCertPath: config.tlsCertPath || '',
    tlsKeyPath: config.tlsKeyPath || ''
  };
}

module.exports = {
  DEFAULT_PORT,
  WEB_RPC_ALLOW,
  init,
  setHooks,
  applyConfig,
  setPassword,
  createPasswordRecord,
  clearPassword,
  getStatus,
  clientCount,
  broadcast,
  stopServer,
  startServer,
  listLanAddresses,
  listeningUrls,
  allowShell,
  webRpcDenial,
  resolveListenPlan,
  publicConfig
};
