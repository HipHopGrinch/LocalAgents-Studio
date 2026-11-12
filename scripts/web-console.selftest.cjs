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

console.log('web-console-selftest ok');
