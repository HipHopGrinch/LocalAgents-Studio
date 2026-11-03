/**
 * Opt-in LAN web console hosted inside the Electron main process.
 * Serves the Vite `dist/` UI and bridges ElectronAPI over authenticated WebSockets.
 */
const http = require('http');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const DEFAULT_PORT = 3847;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

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

/** @type {import('http').Server | null} */
let server = null;
/** @type {WebSocketServer | null} */
let wss = null;
/** @type {Map<string, { expires: number }>} */
const sessions = new Map();
/** @type {Set<import('ws').WebSocket>} */
const clients = new Set();

/** @type {{ invokeRpc: (channel: string, args: any[]) => Promise<any>, getDistDir: () => string, getViteDevUrl: () => string | null, appendLog?: (level: string, msg: string) => void } | null} */
let deps = null;

/** @type {{ enabled: boolean, port: number, passwordHash?: string, passwordSalt?: string }} */
let config = { enabled: false, port: DEFAULT_PORT };

function log(level, msg) {
  if (deps?.appendLog) deps.appendLog(level, `[webConsole] ${msg}`);
  else console[level === 'error' ? 'error' : 'log'](`[webConsole] ${msg}`);
}

function hashPassword(password, saltBuf) {
  return crypto.scryptSync(String(password), saltBuf, 32, SCRYPT_OPTS).toString('base64');
}

function verifyPassword(password, hashB64, saltB64) {
  if (!password || !hashB64 || !saltB64) return false;
  try {
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(String(password), salt, expected.length, SCRYPT_OPTS);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function createPasswordRecord(password) {
  const salt = crypto.randomBytes(16);
  return {
    passwordSalt: salt.toString('base64'),
    passwordHash: hashPassword(password, salt)
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

function listeningUrls() {
  if (!server || !config.enabled) return [];
  const port = config.port || DEFAULT_PORT;
  const urls = [`http://127.0.0.1:${port}`];
  for (const ip of listLanAddresses()) urls.push(`http://${ip}:${port}`);
  return urls;
}

function getStatus() {
  return {
    enabled: !!config.enabled,
    port: config.port || DEFAULT_PORT,
    listening: !!(server && server.listening),
    hasPassword: !!(config.passwordHash && config.passwordSalt),
    urls: listeningUrls(),
    lanAddresses: listLanAddresses(),
    clientCount: clients.size
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
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
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
      headers: { ...(req.headers.host ? { host: base.host } : {}) }
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    const headers = {};
    upstream.headers.forEach((v, k) => {
      if (k === 'transfer-encoding') return;
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
  let filePath = path.join(distDir, safe);
  if (!filePath.startsWith(distDir)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  try {
    let st = await fsp.stat(filePath).catch(() => null);
    if (!st || !st.isFile()) {
      // SPA fallback
      filePath = path.join(distDir, 'index.html');
      st = await fsp.stat(filePath);
    }
    const ext = path.extname(filePath).toLowerCase();
    const data = await fsp.readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600'
    });
    res.end(data);
  } catch {
    if (viteUrl) return proxyVite(req, res, viteUrl);
    res.writeHead(404);
    res.end('Not found — build the UI (npm run build) or run the Vite dev server.');
  }
}

async function handleApi(req, res) {
  const url = new URL(req.url || '/', 'http://127.0.0.1');

  if (req.method === 'GET' && url.pathname === '/api/status') {
    return sendJson(res, 200, {
      enabled: getStatus().listening,
      hasPassword: getStatus().hasPassword,
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
      if (!verifyPassword(password, config.passwordHash, config.passwordSalt)) {
        return sendJson(res, 401, { error: 'Invalid password' });
      }
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
    res.writeHead(500);
    res.end('Internal error');
  });
}

function extractToken(req) {
  try {
    const u = new URL(req.url || '/', 'http://127.0.0.1');
    const q = u.searchParams.get('token');
    if (q) return q;
  } catch {
    /* ignore */
  }
  const auth = req.headers['authorization'];
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return '';
}

function attachWebSocket() {
  wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (socket, req) => {
    const token = extractToken(req);
    if (!sessionValid(token)) {
      socket.close(4401, 'Unauthorized');
      return;
    }
    socket.__token = token;
    clients.add(socket);
    socket.send(JSON.stringify({ type: 'hello', status: getStatus() }));
    if (typeof deps?.onClientConnected === 'function') {
      try {
        deps.onClientConnected();
      } catch {
        /* ignore */
      }
    }

    socket.on('message', raw => {
      handleWsMessage(socket, raw).catch(err => {
        try {
          socket.send(JSON.stringify({ type: 'error', error: err.message || String(err) }));
        } catch {
          /* ignore */
        }
      });
    });

    socket.on('close', () => {
      clients.delete(socket);
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
  if (!sessionValid(socket.__token)) {
    socket.close(4401, 'Unauthorized');
    return;
  }

  if (msg.type === 'ping') {
    socket.send(JSON.stringify({ type: 'pong', t: Date.now() }));
    return;
  }

  if (msg.type !== 'rpc' || msg.id == null) return;
  const channel = String(msg.method || '');
  const args = Array.isArray(msg.args) ? msg.args : [];

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

function broadcast(channel, payload) {
  if (!clients.size) return;
  const packet = JSON.stringify({ type: 'event', channel, payload });
  for (const socket of clients) {
    if (socket.readyState === 1) {
      try {
        socket.send(packet);
      } catch {
        /* ignore */
      }
    }
  }
}

function stopServer() {
  for (const socket of clients) {
    try {
      socket.close(1001, 'Console stopped');
    } catch {
      /* ignore */
    }
  }
  clients.clear();
  sessions.clear();
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

function startServer() {
  stopServer();
  if (!config.enabled) return { success: true, listening: false };
  if (!config.passwordHash || !config.passwordSalt) {
    log('warn', 'Web console enabled but no password set — not listening');
    return { success: false, error: 'Set a web console password before enabling' };
  }
  const port = Number(config.port) > 0 ? Math.floor(Number(config.port)) : DEFAULT_PORT;
  config.port = port;

  server = http.createServer(handleHttp);
  attachWebSocket();

  return new Promise(resolve => {
    server.once('error', err => {
      log('error', `listen failed: ${err.message}`);
      stopServer();
      resolve({ success: false, error: err.message });
    });
    server.listen(port, '0.0.0.0', () => {
      log('info', `listening on 0.0.0.0:${port}`);
      resolve({ success: true, listening: true, ...getStatus() });
    });
  });
}

/**
 * Apply settings.webConsole and restart the server if needed.
 * @param {object} next partial webConsole settings from AppSettings
 */
async function applyConfig(next = {}) {
  const prevPort = config.port;
  const prevEnabled = config.enabled;
  config = {
    enabled: !!next.enabled,
    port: Number(next.port) > 0 ? Math.floor(Number(next.port)) : DEFAULT_PORT,
    passwordHash: next.passwordHash || config.passwordHash,
    passwordSalt: next.passwordSalt || config.passwordSalt
  };
  if (next.passwordHash) config.passwordHash = next.passwordHash;
  if (next.passwordSalt) config.passwordSalt = next.passwordSalt;

  if (!config.enabled) {
    stopServer();
    return getStatus();
  }
  const needRestart =
    !server ||
    !server.listening ||
    prevPort !== config.port ||
    !prevEnabled ||
    next.passwordHash;
  if (needRestart) {
    await startServer();
  }
  return getStatus();
}

function setPassword(password) {
  const pwd = String(password || '');
  if (pwd.length < 4) {
    return { error: 'Password must be at least 4 characters' };
  }
  const rec = createPasswordRecord(pwd);
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

module.exports = {
  DEFAULT_PORT,
  init,
  setHooks,
  applyConfig,
  setPassword,
  clearPassword,
  createPasswordRecord,
  getStatus,
  broadcast,
  stopServer,
  startServer,
  listLanAddresses,
  listeningUrls
};
