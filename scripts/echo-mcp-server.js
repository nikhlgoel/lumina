// A minimal, real MCP server over stdio. Exists purely so Lumina's client can be proven against
// something that actually speaks the protocol rather than synthetic test frames.
const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');

let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    handle(msg);
  }
});

function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return send({ jsonrpc: '2.0', id, result: {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'echo-test', version: '1.0.0' },
    } });
  }
  if (method === 'notifications/initialized') return;
  if (method === 'tools/list') {
    return send({ jsonrpc: '2.0', id, result: { tools: [
      { name: 'echo', description: 'Echo back whatever text you pass.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
      { name: 'clock', description: 'Return the server time as an ISO string.', inputSchema: { type: 'object' } },
    ] } });
  }
  if (method === 'tools/call') {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    if (name === 'echo') return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: String(args.text ?? '') }] } });
    if (name === 'clock') return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: new Date().toISOString() }] } });
    return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'no such tool' }], isError: true } });
  }
  if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } });
}

process.stderr.write('echo-test MCP server listening on stdio\n');
