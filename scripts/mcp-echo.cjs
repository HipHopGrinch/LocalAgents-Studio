/** Tiny MCP stdio server for the self-test. Speaks Content-Length JSON-RPC. */
const chunks = [];
process.stdin.on('data', d => {
  chunks.push(d);
  pump();
});

function pump() {
  let buf = Buffer.concat(chunks);
  chunks.length = 0;
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
    handle(JSON.parse(raw));
  }
  if (buf.length) chunks.push(buf);
}

function send(msg) {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

function handle(msg) {
  if (!msg.id) return;
  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'echo', version: '0' } }
    });
    return;
  }
  if (msg.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'echo' }] } });
    return;
  }
  if (msg.method === 'tools/call') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: { content: [{ type: 'text', text: `echo:${msg.params?.name || ''}` }] }
    });
  }
}
