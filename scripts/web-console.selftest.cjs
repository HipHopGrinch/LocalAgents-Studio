/**
 * Web console allowlist and LAN-without-TLS bind plan.
 * Run: node scripts/web-console.selftest.cjs
 */
const assert = require('assert');
const { WEB_RPC_ALLOW, webRpcDenial, resolveListenPlan } = require('../electron/webConsole.cjs');

assert.equal(WEB_RPC_ALLOW.has('webConsole:update'), false);
assert.equal(WEB_RPC_ALLOW.has('webConsole:setPassword'), false);
assert.equal(WEB_RPC_ALLOW.has('update:setBusy'), false);
assert.equal(WEB_RPC_ALLOW.has('update:download'), false);
assert.equal(WEB_RPC_ALLOW.has('update:install'), false);
assert.equal(WEB_RPC_ALLOW.has('update:getStatus'), true);
assert.equal(WEB_RPC_ALLOW.has('update:check'), true);
assert.equal(WEB_RPC_ALLOW.has('ollama:status'), true);

assert.match(webRpcDenial('webConsole:update', []), /not available/i);
assert.match(webRpcDenial('webConsole:setPassword', ['secret']), /not available/i);
assert.match(webRpcDenial('update:setBusy', [false]), /not available/i);
assert.match(webRpcDenial('update:install', []), /not available/i);
assert.match(webRpcDenial('terminal:getBuffer', []), /disabled/i);
assert.match(webRpcDenial('terminal:kill', []), /disabled/i);
assert.match(webRpcDenial('terminal:clearBuffer', []), /disabled/i);
assert.match(webRpcDenial('ollama:pull', []), /disabled/i);
assert.match(webRpcDenial('ollama:delete', []), /disabled/i);
assert.match(webRpcDenial('web:search', ['http://127.0.0.1:8080', 'q']), /disabled/i);
assert.match(webRpcDenial('tools:exec', ['C:\\proj', 'read_terminal', {}]), /disabled/i);
assert.match(webRpcDenial('tools:exec', ['C:\\proj', 'run_command', {}]), /disabled/i);
assert.equal(webRpcDenial('tools:exec', ['C:\\proj', 'read_file', {}]), null);
assert.equal(webRpcDenial('ollama:status', []), null);
assert.equal(webRpcDenial('ollama:chat', []), null);

const missing = resolveListenPlan({ lanEnabled: true, tlsLoaded: false, tlsError: '' });
assert.equal(missing.bindHost, '127.0.0.1');
assert.equal(missing.tls, false);
assert.match(missing.lanError, /127\.0\.0\.1/);
assert.match(missing.error, /TLS/);

const bad = resolveListenPlan({ lanEnabled: true, tlsLoaded: false, tlsError: 'empty PEM' });
assert.equal(bad.bindHost, '127.0.0.1');
assert.match(bad.error, /empty PEM/);

const lan = resolveListenPlan({ lanEnabled: true, tlsLoaded: true, tlsError: '' });
assert.equal(lan.bindHost, '0.0.0.0');
assert.equal(lan.tls, true);
assert.equal(lan.lanError, '');

const local = resolveListenPlan({ lanEnabled: false, tlsLoaded: false, tlsError: '' });
assert.equal(local.bindHost, '127.0.0.1');
assert.equal(local.error, '');

// Parallel wrong-password logins must hit the lockout (B-19).
(async () => {
  const http = require('http');
  const net = require('net');
  const webConsole = require('../electron/webConsole.cjs');
  const port = await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const p = probe.address().port;
      probe.close(() => resolve(p));
    });
  });
  webConsole.init({ getDistDir: () => __dirname, getViteDevUrl: () => null });
  const rec = await webConsole.createPasswordRecord('correct-horse-battery');
  const status = await webConsole.applyConfig({
    enabled: true,
    port,
    passwordHash: rec.passwordHash,
    passwordSalt: rec.passwordSalt
  });
  assert.ok(!status.error, status.error);
  const login = password =>
    new Promise((resolve, reject) => {
      const body = JSON.stringify({ password });
      const req = http.request(
        { host: '127.0.0.1', port, path: '/api/login', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
        res => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        }
      );
      req.once('error', reject);
      req.end(body);
    });
  try {
    const codes = await Promise.all(Array.from({ length: 12 }, () => login('wrong-password')));
    assert.equal(codes.filter(c => c === 401).length, 5, `expected 5 failures before the lock, got ${codes}`);
    assert.equal(codes.filter(c => c === 429).length, 7, `expected 7 locked, got ${codes}`);
    assert.equal(await login('correct-horse-battery'), 429);
  } finally {
    webConsole.stopServer();
  }
  console.log('web-console-selftest ok');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
