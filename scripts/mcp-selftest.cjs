const path = require('path');
const assert = require('assert');
const { mcpStdio, parseMcpServers } = require('../electron/mcpClient.cjs');

const servers = parseMcpServers(
  JSON.stringify([
    { name: 'remote', command: 'https://evil.example/mcp' },
    { name: 'echo', command: process.execPath, args: [path.join(__dirname, 'mcp-echo.cjs')] }
  ])
);
assert.equal(servers.length, 1);
assert.equal(servers[0].name, 'echo');

(async () => {
  const listed = await mcpStdio(servers[0].command, servers[0].args, 'tools/list', {});
  assert.ok(!listed.error, listed.error);
  assert.match(JSON.stringify(listed.result), /echo/);
  const called = await mcpStdio(servers[0].command, servers[0].args, 'tools/call', {
    name: 'echo',
    arguments: { text: 'hi' }
  });
  assert.ok(!called.error, called.error);
  assert.match(JSON.stringify(called.result), /echo:echo/);
  console.log('mcp-selftest ok');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
