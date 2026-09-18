// Model Context Protocol, the pure half: config validation, JSON-RPC framing, and parsing what a
// server reports. No spawning, no sockets — that lives in src/main/ide/mcp.ts, so everything here
// is unit-tested.
//
// Security posture, because this is the part that decides what Lumina will run:
//   * A server is a real process (or a real HTTP endpoint) the user asked for. Nothing is ever
//     discovered, auto-added or auto-enabled — `enabled` defaults to false and only a person flips it.
//   * validateServerConfig is deliberately strict: a stdio server needs a command, an http server
//     needs an https/http URL, and neither is accepted half-specified.
//   * Everything a server sends back — tool names, descriptions, results — is DATA, never
//     instructions. Descriptions are truncated and never interpreted as commands by this module.

export type McpTransport = 'stdio' | 'http';

export interface McpServerConfig {
  id: string;
  name: string;
  transport: McpTransport;
  /** stdio: the executable to run. */
  command?: string;
  args?: string[];
  /** Extra environment for a stdio server. Values are opaque to us. */
  env?: Record<string, string>;
  /** http: the endpoint. */
  url?: string;
  /** Off until a person turns it on. */
  enabled: boolean;
}

export type ValidationResult = { ok: true; config: McpServerConfig } | { ok: false; reason: string };

const ID_RE = /^[a-z0-9][a-z0-9-_]{0,48}$/i;

/** Strict by design: a half-specified server is rejected rather than silently doing nothing. */
export function validateServerConfig(raw: Partial<McpServerConfig>): ValidationResult {
  const id = (raw.id ?? '').trim();
  if (!ID_RE.test(id)) return { ok: false, reason: 'Give the server a short id (letters, numbers, - or _).' };

  const name = (raw.name ?? '').trim().slice(0, 80) || id;
  const transport: McpTransport = raw.transport === 'http' ? 'http' : 'stdio';

  if (transport === 'stdio') {
    const command = (raw.command ?? '').trim();
    if (!command) return { ok: false, reason: 'A stdio server needs a command to run.' };
    // A command with shell metacharacters suggests someone expects a shell; we never use one,
    // so say so rather than silently running something that won't behave as written.
    if (/[;&|><`$(){}]/.test(command)) {
      return { ok: false, reason: 'The command is run directly, not through a shell — remove shell characters and use arguments instead.' };
    }
    const args = (raw.args ?? []).map((a) => String(a)).filter((a) => a.length > 0).slice(0, 64);
    const env = Object.fromEntries(
      Object.entries(raw.env ?? {}).filter(([k]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k)).slice(0, 64),
    );
    return { ok: true, config: { id, name, transport, command, args, env, enabled: raw.enabled === true } };
  }

  const url = (raw.url ?? '').trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'That isn’t a valid URL.' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, reason: 'Only http and https endpoints are supported.' };
  }
  return { ok: true, config: { id, name, transport, url: parsed.toString(), enabled: raw.enabled === true } };
}

/** Exactly what will be executed, for the confirmation the user sees before enabling a server. */
export function describeCommand(config: McpServerConfig): string {
  if (config.transport === 'http') return config.url ?? '';
  const quoted = (config.args ?? []).map((a) => (/\s/.test(a) ? `"${a}"` : a));
  return [config.command ?? '', ...quoted].join(' ').trim();
}

/**
 * Split a typed command line into argv the way a person expects, WITHOUT shell semantics.
 *
 * This exists because the natural thing to paste is one line — `npx -y some-server --root C:\x` —
 * but Lumina spawns with `shell: false`. So we do the one part of shell parsing that is safe
 * (respect quotes, split on whitespace) and none of the parts that are not: no variable expansion,
 * no globbing, no operators, no command substitution. A backslash is left alone, because on Windows
 * it is a path separator far more often than an escape.
 */
export function parseCommandLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let started = false;

  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; started = true; continue; }
    if (/\s/.test(ch)) {
      if (started) { out.push(current); current = ''; started = false; }
      continue;
    }
    current += ch;
    started = true;
  }
  if (started) out.push(current);
  return out;
}

/**
 * Read the `mcpServers` block people copy out of a server's README.
 *
 * Every entry is put through validateServerConfig, so nothing skips the usual checks, and every
 * entry comes back DISABLED regardless of what the pasted JSON claimed — importing a file must
 * never start a process on its own.
 */
export function parseMcpJson(text: string): { ok: true; configs: McpServerConfig[] } | { ok: false; reason: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'That isn’t valid JSON.' };
  }
  if (!data || typeof data !== 'object') return { ok: false, reason: 'Expected a JSON object.' };

  const root = data as Record<string, unknown>;
  const block = (root.mcpServers ?? root.servers ?? root) as Record<string, unknown>;
  if (!block || typeof block !== 'object') return { ok: false, reason: 'No “mcpServers” block found.' };

  const configs: McpServerConfig[] = [];
  const rejected: string[] = [];
  for (const [id, value] of Object.entries(block)) {
    if (!value || typeof value !== 'object') continue;
    const entry = value as Record<string, unknown>;
    // Claude Desktop and friends write `type`; we call it `transport`. Either is accepted.
    const kind = String(entry.transport ?? entry.type ?? (entry.url ? 'http' : 'stdio'));
    const result = validateServerConfig({
      id,
      name: typeof entry.name === 'string' ? entry.name : id,
      transport: kind === 'http' || kind === 'sse' || kind === 'streamable-http' ? 'http' : 'stdio',
      command: typeof entry.command === 'string' ? entry.command : undefined,
      args: Array.isArray(entry.args) ? entry.args.map(String) : undefined,
      env: entry.env && typeof entry.env === 'object' ? (entry.env as Record<string, string>) : undefined,
      url: typeof entry.url === 'string' ? entry.url : undefined,
      enabled: false,
    });
    if (result.ok) configs.push(result.config);
    else rejected.push(`${id}: ${result.reason}`);
  }
  if (configs.length === 0) {
    return { ok: false, reason: rejected[0] ?? 'No servers found in that JSON.' };
  }
  return { ok: true, configs };
}

/* ---------- JSON-RPC over stdio ---------- */

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

/** MCP stdio frames are newline-delimited JSON. */
export const encodeFrame = (message: unknown): string => `${JSON.stringify(message)}\n`;

/**
 * Pull complete frames out of a growing buffer, returning the parsed messages and whatever tail is
 * still incomplete. Unparseable lines are skipped rather than throwing — a misbehaving server
 * must not be able to kill the client by writing one bad line.
 */
export function decodeFrames(buffer: string): { messages: unknown[]; rest: string } {
  const messages: unknown[] = [];
  const parts = buffer.split('\n');
  // The last element is either '' (buffer ended on a newline) or a partial line.
  const rest = parts.pop() ?? '';
  for (const line of parts) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      messages.push(JSON.parse(trimmed));
    } catch {
      // Not JSON — servers sometimes log to stdout. Ignore it.
    }
  }
  return { messages, rest };
}

/* ---------- what a server reports ---------- */

export interface McpTool {
  name: string;
  description: string;
  /** JSON Schema for the arguments, passed to the model as-is. */
  inputSchema: Record<string, unknown>;
  /** Which configured server it came from, so a call can be routed back. */
  serverId: string;
}

const MAX_DESCRIPTION = 2000;

/**
 * Read a `tools/list` result. Everything is remote data, so each field is checked and a malformed
 * entry is dropped rather than trusted. Descriptions are truncated — they reach a model's context,
 * and an enormous one is either a mistake or an attempt to crowd out the real instructions.
 */
export function parseToolList(serverId: string, result: unknown): McpTool[] {
  if (!result || typeof result !== 'object') return [];
  const list = (result as { tools?: unknown }).tools;
  if (!Array.isArray(list)) return [];
  const out: McpTool[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const t = raw as { name?: unknown; description?: unknown; inputSchema?: unknown };
    if (typeof t.name !== 'string' || !t.name.trim()) continue;
    out.push({
      serverId,
      name: t.name.trim().slice(0, 120),
      description: typeof t.description === 'string' ? t.description.slice(0, MAX_DESCRIPTION) : '',
      inputSchema: t.inputSchema && typeof t.inputSchema === 'object' ? (t.inputSchema as Record<string, unknown>) : { type: 'object' },
    });
  }
  return out;
}

/**
 * Flatten a `tools/call` result into text. MCP returns content blocks; we keep the text ones.
 * The result is untrusted output from someone else's process — callers must treat it as data.
 */
export function parseToolResult(result: unknown): { text: string; isError: boolean } {
  if (!result || typeof result !== 'object') return { text: '', isError: false };
  const r = result as { content?: unknown; isError?: unknown };
  const isError = r.isError === true;
  if (!Array.isArray(r.content)) return { text: '', isError };
  const text = r.content
    .map((block) => {
      if (!block || typeof block !== 'object') return '';
      const b = block as { type?: unknown; text?: unknown };
      return b.type === 'text' && typeof b.text === 'string' ? b.text : '';
    })
    .filter(Boolean)
    .join('\n')
    .slice(0, 100_000);
  return { text, isError };
}

/** A tool's fully-qualified name, so two servers offering "search" don't collide. */
export const qualifiedToolName = (tool: McpTool) => `${tool.serverId}__${tool.name}`;

/** Split a qualified name back apart; returns null when it isn't one. */
export function splitToolName(qualified: string): { serverId: string; name: string } | null {
  const at = qualified.indexOf('__');
  if (at <= 0 || at >= qualified.length - 2) return null;
  return { serverId: qualified.slice(0, at), name: qualified.slice(at + 2) };
}
