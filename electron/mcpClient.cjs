const { spawn } = require('child_process');

/**
 * One-shot MCP stdio call. Local command only (no remote URL).
 * Supports official MCP NDJSON framing and LSP Content-Length (scripts/mcp-echo.cjs).
 */

function splitArgs(raw) {
  if (Array.isArray(raw)) return raw.map(String);
  const s = String(raw || '').trim();
  if (!s) return [];
  if (s.startsWith('[')) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      /* fall through */
    }
  }
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(s))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function encodeFrame(obj, framing) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  if (framing === 'content-length') {
    return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8'), body]);
  }
  return Buffer.concat([body, Buffer.from('\n', 'utf8')]);
}

function mcpStdioOnce(command, args, method, params, framing, timeoutMs) {
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
      child.stdin.write(encodeFrame(msg, framing));
    };
    const rpc = (m, p) =>
      new Promise((res, rej) => {
        const id = seq++;
        pending.set(id, { res, rej });
        send({ jsonrpc: '2.0', id, method: m, params: p });
      });
    const dispatch = msg => {
      if (msg.id && pending.has(msg.id)) {
        const waiter = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) waiter.rej(new Error(msg.error.message || 'MCP error'));
        else waiter.res(msg.result);
      }
    };
    const timer = setTimeout(() => finish({ error: 'MCP timed out' }), timeoutMs);
    child.stderr.on('data', d => {
      stderr = (stderr + d.toString()).slice(-2000);
    });
    child.on('error', err => finish({ error: err.message }));
    child.stdout.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length) {
        const head = buf.toString('utf8', 0, Math.min(buf.length, 20)).toLowerCase();
        if (head.startsWith('content-length')) {
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
          try {
            dispatch(JSON.parse(raw));
          } catch {
            /* ignore */
          }
          continue;
        }
        const nl = buf.indexOf('\n');
        if (nl < 0) break;
        const line = buf.slice(0, nl).toString('utf8').trim();
        buf = buf.slice(nl + 1);
        if (!line || line.toLowerCase().startsWith('content-length')) continue;
        try {
          dispatch(JSON.parse(line));
        } catch {
          /* ignore */
        }
      }
    });
    (async () => {
      try {
        await rpc('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'localagents-studio', version: '1.2.24' }
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

/**
 * Try Content-Length first (keeps mcp-echo selftest fast), then NDJSON for official MCP servers.
 */
async function mcpStdio(command, args, method, params) {
  const first = await mcpStdioOnce(command, args, method, params, 'content-length', 4000);
  if (!first.error) return first;
  return mcpStdioOnce(command, args, method, params, 'ndjson', 20000);
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
        args: splitArgs(s.args)
      }));
  } catch {
    return [];
  }
}

module.exports = { mcpStdio, parseMcpServers, splitArgs };
