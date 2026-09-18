import { describe, it, expect } from 'vitest';
import {
  decodeFrames, describeCommand, encodeFrame, parseCommandLine, parseMcpJson, parseToolList,
  parseToolResult, qualifiedToolName, splitToolName, validateServerConfig,
} from '@core/mcp';

describe('validateServerConfig', () => {
  it('accepts a well-formed stdio server and leaves it disabled unless asked', () => {
    const r = validateServerConfig({ id: 'fs', name: 'Filesystem', transport: 'stdio', command: 'npx', args: ['-y', 'pkg'] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config).toMatchObject({ id: 'fs', command: 'npx', args: ['-y', 'pkg'], enabled: false });
  });

  it('never enables a server just because the input said so loosely', () => {
    const truthy = validateServerConfig({ id: 'a', transport: 'stdio', command: 'x', enabled: true });
    const stringy = validateServerConfig({ id: 'a', transport: 'stdio', command: 'x', enabled: 'yes' as never });
    expect(truthy.ok && truthy.config.enabled).toBe(true);
    expect(stringy.ok && stringy.config.enabled).toBe(false);
  });

  it('rejects a bad id', () => {
    expect(validateServerConfig({ id: '', transport: 'stdio', command: 'x' })).toMatchObject({ ok: false });
    expect(validateServerConfig({ id: 'has space', transport: 'stdio', command: 'x' })).toMatchObject({ ok: false });
    expect(validateServerConfig({ id: '-leading', transport: 'stdio', command: 'x' })).toMatchObject({ ok: false });
  });

  it('rejects a stdio server with no command', () => {
    expect(validateServerConfig({ id: 'a', transport: 'stdio', command: '   ' })).toMatchObject({ ok: false });
  });

  it('refuses shell metacharacters, because no shell is used', () => {
    for (const command of ['rm -rf / ; echo', 'a && b', 'x | y', 'cat < f', '`whoami`', '$(id)']) {
      const r = validateServerConfig({ id: 'a', transport: 'stdio', command });
      expect(r.ok, command).toBe(false);
    }
  });

  it('accepts an http server and normalises the URL', () => {
    const r = validateServerConfig({ id: 'remote', transport: 'http', url: 'https://example.invalid/mcp' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.url).toBe('https://example.invalid/mcp');
  });

  it('rejects a non-http scheme or a malformed URL', () => {
    expect(validateServerConfig({ id: 'a', transport: 'http', url: 'file:///etc/passwd' })).toMatchObject({ ok: false });
    expect(validateServerConfig({ id: 'a', transport: 'http', url: 'javascript:alert(1)' })).toMatchObject({ ok: false });
    expect(validateServerConfig({ id: 'a', transport: 'http', url: 'not a url' })).toMatchObject({ ok: false });
  });

  it('drops environment keys that are not valid variable names', () => {
    const r = validateServerConfig({ id: 'a', transport: 'stdio', command: 'x', env: { GOOD: '1', 'bad key': '2', '9bad': '3' } });
    expect(r.ok && Object.keys(r.config.env ?? {})).toEqual(['GOOD']);
  });

  it('defaults an unknown transport to stdio rather than guessing', () => {
    const r = validateServerConfig({ id: 'a', transport: 'carrier-pigeon' as never, command: 'x' });
    expect(r.ok && r.config.transport).toBe('stdio');
  });
});

describe('describeCommand', () => {
  it('shows exactly what will run, quoting arguments with spaces', () => {
    expect(describeCommand({ id: 'a', name: 'a', transport: 'stdio', command: 'npx', args: ['-y', 'my pkg'], enabled: true }))
      .toBe('npx -y "my pkg"');
  });

  it('shows the URL for an http server', () => {
    expect(describeCommand({ id: 'a', name: 'a', transport: 'http', url: 'https://x.invalid/', enabled: true }))
      .toBe('https://x.invalid/');
  });
});

describe('framing', () => {
  it('encodes one newline-delimited JSON frame', () => {
    expect(encodeFrame({ jsonrpc: '2.0', id: 1, method: 'ping' })).toBe('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
  });

  it('decodes complete frames and keeps the partial tail', () => {
    const { messages, rest } = decodeFrames('{"a":1}\n{"b":2}\n{"c":');
    expect(messages).toEqual([{ a: 1 }, { b: 2 }]);
    expect(rest).toBe('{"c":');
  });

  it('skips non-JSON noise instead of throwing — servers do log to stdout', () => {
    const { messages } = decodeFrames('listening on stdio\n{"a":1}\n');
    expect(messages).toEqual([{ a: 1 }]);
  });

  it('handles an empty buffer and a buffer with no complete line', () => {
    expect(decodeFrames('')).toEqual({ messages: [], rest: '' });
    expect(decodeFrames('{"partial"')).toEqual({ messages: [], rest: '{"partial"' });
  });

  it('round-trips through encode', () => {
    const msg = { jsonrpc: '2.0', id: 7, method: 'tools/list' };
    expect(decodeFrames(encodeFrame(msg)).messages).toEqual([msg]);
  });
});

describe('parseToolList', () => {
  it('reads well-formed tools and tags them with their server', () => {
    const tools = parseToolList('fs', { tools: [{ name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } }] });
    expect(tools).toEqual([{ serverId: 'fs', name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } }]);
  });

  it('drops entries with no usable name', () => {
    const tools = parseToolList('fs', { tools: [{ name: '' }, { name: 42 }, null, 'nope', { name: 'ok' }] });
    expect(tools.map((t) => t.name)).toEqual(['ok']);
  });

  it('truncates an enormous description rather than letting it flood the model', () => {
    const tools = parseToolList('fs', { tools: [{ name: 'x', description: 'a'.repeat(50_000) }] });
    expect(tools[0]!.description.length).toBe(2000);
  });

  it('substitutes a default schema when the server sends none', () => {
    expect(parseToolList('fs', { tools: [{ name: 'x' }] })[0]!.inputSchema).toEqual({ type: 'object' });
  });

  it('returns nothing for junk instead of throwing', () => {
    expect(parseToolList('fs', null)).toEqual([]);
    expect(parseToolList('fs', { tools: 'not-an-array' })).toEqual([]);
    expect(parseToolList('fs', {})).toEqual([]);
  });
});

describe('parseToolResult', () => {
  it('joins the text blocks', () => {
    expect(parseToolResult({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }))
      .toEqual({ text: 'a\nb', isError: false });
  });

  it('ignores non-text blocks', () => {
    expect(parseToolResult({ content: [{ type: 'image', data: 'xx' }, { type: 'text', text: 'keep' }] }).text).toBe('keep');
  });

  it('reports the error flag', () => {
    expect(parseToolResult({ content: [{ type: 'text', text: 'boom' }], isError: true }).isError).toBe(true);
  });

  it('survives junk', () => {
    expect(parseToolResult(null)).toEqual({ text: '', isError: false });
    expect(parseToolResult({ content: 'nope' })).toEqual({ text: '', isError: false });
  });
});

describe('qualified tool names', () => {
  it('prefixes with the server so two servers can both offer "search"', () => {
    expect(qualifiedToolName({ serverId: 'fs', name: 'search', description: '', inputSchema: {} })).toBe('fs__search');
  });

  it('splits back apart', () => {
    expect(splitToolName('fs__search')).toEqual({ serverId: 'fs', name: 'search' });
    expect(splitToolName('fs__read__file')).toEqual({ serverId: 'fs', name: 'read__file' });
  });

  it('returns null for something that is not a qualified name', () => {
    expect(splitToolName('search')).toBeNull();
    expect(splitToolName('__search')).toBeNull();
    expect(splitToolName('fs__')).toBeNull();
  });
});

// A lone backslash written via its code point, so these literals stay readable for Windows paths.
const BS = String.fromCharCode(92);

describe('parseCommandLine', () => {
  it('splits on whitespace', () => {
    expect(parseCommandLine('npx -y my-server')).toEqual(['npx', '-y', 'my-server']);
  });

  it('keeps a quoted argument together', () => {
    const path = `C:${BS}Program Files${BS}x`;
    expect(parseCommandLine(`cmd --root "${path}" --flag`)).toEqual(['cmd', '--root', path, '--flag']);
  });

  it('supports single quotes and an empty quoted argument', () => {
    expect(parseCommandLine("cmd 'two words' ''")).toEqual(['cmd', 'two words', '']);
  });

  it('does not expand variables, globs or operators — they stay literal text', () => {
    expect(parseCommandLine('cmd $HOME *.txt')).toEqual(['cmd', '$HOME', '*.txt']);
    expect(parseCommandLine('a && b')).toEqual(['a', '&&', 'b']);
  });

  it('leaves Windows backslashes alone', () => {
    const exe = `C:${BS}tools${BS}srv.exe`;
    expect(parseCommandLine(exe)).toEqual([exe]);
  });

  it('collapses runs of whitespace and handles an empty line', () => {
    expect(parseCommandLine('  a   b  ')).toEqual(['a', 'b']);
    expect(parseCommandLine('   ')).toEqual([]);
  });

  it('closes an unterminated quote at the end rather than throwing', () => {
    expect(parseCommandLine('cmd "unclosed')).toEqual(['cmd', 'unclosed']);
  });
});

describe('parseMcpJson', () => {
  const block = JSON.stringify({
    mcpServers: {
      filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'] },
      remote: { type: 'sse', url: 'https://example.invalid/mcp' },
    },
  });

  it('reads the block people copy out of a README', () => {
    const r = parseMcpJson(block);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.configs.map((c) => c.id)).toEqual(['filesystem', 'remote']);
    expect(r.configs[0]!.args).toEqual(['-y', '@modelcontextprotocol/server-filesystem', '/tmp']);
    expect(r.configs[1]!.transport).toBe('http');
  });

  it('imports everything disabled, even when the JSON says otherwise', () => {
    const r = parseMcpJson(JSON.stringify({ mcpServers: { a: { command: 'x', enabled: true } } }));
    expect(r.ok && r.configs[0]!.enabled).toBe(false);
  });

  it('accepts a bare map with no wrapper', () => {
    expect(parseMcpJson(JSON.stringify({ a: { command: 'x' } })).ok).toBe(true);
  });

  it('still refuses a shell-flavoured command on import', () => {
    const r = parseMcpJson(JSON.stringify({ mcpServers: { bad: { command: 'rm -rf / ; echo' } } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('bad:');
  });

  it('reports bad input instead of throwing', () => {
    expect(parseMcpJson('not json')).toMatchObject({ ok: false });
    expect(parseMcpJson('[]')).toMatchObject({ ok: false });
    expect(parseMcpJson('null')).toMatchObject({ ok: false });
  });
});
