const { spawn } = require('child_process');

/**
 * One-shot MCP stdio call. Local command only (no remote URL).
 * Framing is Content-Length, then JSON-RPC initialize + tools/list or tools/call.
 */
function mcpStdio(command, args, method, params) {
  return new Promise(resolve => {
    let child;
    try {
      child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (err) {
      resolve({ error: err.message || String(err) });
      return;
    }
    let buf = Buffer.alloc(0);
    let stderr = '';
    const pending = new Map();
    let seq = 1;
    let settled = false;
    const finish = payload => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        /* gone */
      }
      resolve(payload);
    };
    const send = msg => {
      const body = Buffer.from(JSON.stringify(msg), 'utf8');
      child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
      child.stdin.write(body);
    };
    const rpc = (m, p) =>
      new Promise((res, rej) => {
        const id = seq++;
        pending.set(id, { res, rej });
        send({ jsonrpc: '2.0', id, method: m, params: p });
      });
    const timer = setTimeout(() => finish({ error: 'MCP timed out' }), 20000);
    child.stderr.on('data', d => {
      stderr = (stderr + d.toString()).slice(-2000);
    });
    child.on('error', err => finish({ error: err.message }));
    child.stdout.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      while (true) {
        const headerEnd = buf.indexOf('\r\n\r\n');
        if (headerEnd < 0) break;
        const header = buf.slice(0, headerEnd).toString('utf8');
        const m = /Content-Length:\s*(\d+)/i.exec(header);
        if (!m) {
          buf = buf.slice(headerEnd + 4);
          continue;
        }
        const len = Number(m[1]);
        const start = headerEnd + 4;
        if (buf.length < start + len) break;
        const raw = buf.slice(start, start + len).toString('utf8');
        buf = buf.slice(start + len);
        let msg;
        try {
          msg = JSON.parse(raw);
        } catch {
          continue;
        }
        if (msg.id && pending.has(msg.id)) {
          const waiter = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.error) waiter.rej(new Error(msg.error.message || 'MCP error'));
          else waiter.res(msg.result);
        }
      }
    });
    (async () => {
      try {
        await rpc('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'localagents-studio', version: '1.2.19' }
        });
        send({ jsonrpc: '2.0', method: 'notifications/initialized' });
        const result = await rpc(method, params || {});
        finish({ result });
      } catch (err) {
        finish({ error: err.message || stderr || 'MCP failed' });
      }
    })();
  });
}

function parseMcpServers(raw) {
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const list = Array.isArray(parsed) ? parsed : parsed.servers || [];
    return list
      .filter(s => s && s.command && !/^https?:/i.test(String(s.command)))
      .map(s => ({
        name: String(s.name || 'mcp'),
        command: String(s.command),
        args: Array.isArray(s.args) ? s.args.map(String) : String(s.args || '').split(/\s+/).filter(Boolean)
      }));
  } catch {
    return [];
  }
}

module.exports = { mcpStdio, parseMcpServers };
