const { spawn, execFile } = require('child_process');

/**
 * One-shot MCP stdio call. Local command only (no remote URL).
 * Supports official MCP NDJSON framing and LSP Content-Length (scripts/mcp-echo.cjs).
 */

const MAX_FRAME_BYTES = 1024 * 1024;
const tracked = new Set();

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

function killTree(child) {
  if (!child || child.pid == null) return Promise.resolve();
  if (process.platform === 'win32') {
    return new Promise(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const timer = setTimeout(finish, 2000);
      try {
        execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {
          clearTimeout(timer);
          finish();
        });
      } catch {
        clearTimeout(timer);
        try {
          child.kill();
        } catch {
          /* gone */
        }
        finish();
      }
    });
  }
  try {
    child.kill('SIGKILL');
  } catch {
    /* gone */
  }
  return Promise.resolve();
}

function killTracked() {
  const jobs = [];
  for (const child of tracked) jobs.push(killTree(child));
  tracked.clear();
  return Promise.all(jobs);
}

function track(child) {
  if (!child) return child;
  tracked.add(child);
  const drop = () => tracked.delete(child);
  child.once('exit', drop);
  child.once('error', drop);
  return child;
}

function mcpStdioOnce(command, args, method, params, framing, timeoutMs) {
  return new Promise(resolve => {
    let child;
    try {
      child = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false
      });
      track(child);
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
      killTree(child);
      resolve(payload);
    };
    const send = msg => {
      try {
        child.stdin.write(encodeFrame(msg, framing));
      } catch {
        /* closed */
      }
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
      if (buf.length + chunk.length > MAX_FRAME_BYTES) {
        finish({ error: 'MCP frame exceeded 1 MB' });
        return;
      }
      buf = Buffer.concat([buf, chunk]);
      while (buf.length) {
        const head = buf.toString('utf8', 0, Math.min(buf.length, 20)).toLowerCase();
        if (head.startsWith('content-length')) {
          const headerEnd = buf.indexOf('\r\n\r\n');
          if (headerEnd < 0) {
            if (buf.length > 64 * 1024) finish({ error: 'MCP frame exceeded 1 MB' });
            break;
          }
          const header = buf.slice(0, headerEnd).toString('utf8');
          const m = /Content-Length:\s*(\d+)/i.exec(header);
          if (!m) {
            buf = buf.slice(headerEnd + 4);
            continue;
          }
          const len = Number(m[1]);
          if (!Number.isFinite(len) || len < 0 || len > MAX_FRAME_BYTES) {
            finish({ error: 'MCP frame exceeded 1 MB' });
            return;
          }
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
        if (nl < 0) {
          if (buf.length > MAX_FRAME_BYTES) finish({ error: 'MCP frame exceeded 1 MB' });
          break;
        }
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
          clientInfo: { name: 'localagents-studio', version: '1.2.26' }
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

module.exports = { mcpStdio, parseMcpServers, splitArgs, killTracked, killTree };
