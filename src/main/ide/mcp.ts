// The MCP client: starts the servers the user configured, asks what tools they offer, and calls
// them on request. Parsing and validation are pure in src/core/mcp.ts; this file owns the processes
// and sockets.
//
// Security posture — this spawns real programs, so the rules are strict and deliberate:
//   * Nothing is auto-discovered and nothing starts on its own. A server runs only when a person
//     has both added it and switched it on.
//   * Commands are spawned directly with an argv array and `shell: false`. No string is ever handed
//     to a shell, so quoting and metacharacters cannot turn into extra commands.
//   * A server's output is DATA. Tool names, descriptions and results are never treated as
//     instructions by Lumina, and a tool is only ever called because the user (or a model acting on
//     their explicit request) asked for that specific tool.
//   * Every request is bounded by a timeout, and a server that dies is reported, not retried forever.
import { spawn, type ChildProcess } from 'node:child_process';
import {
  decodeFrames, encodeFrame, parseToolList, parseToolResult, validateServerConfig,
  type McpServerConfig, type McpTool,
} from '../../core/mcp';
import { settings } from '../settings';
import { logger } from '../log';

const log = logger('mcp');

const REQUEST_TIMEOUT_MS = 30_000;
const PROTOCOL_VERSION = '2024-11-05';

import type { McpServerState } from '../../shared/types';

export type { McpServerState };

interface Live {
  child: ChildProcess | null;
  buffer: string;
  nextId: number;
  pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>;
  state: McpServerState;
}

const servers = new Map<string, Live>();

type Listener = (states: McpServerState[]) => void;
const listeners = new Set<Listener>();

export function onMcpChanged(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const publicState = (): McpServerState[] => [...servers.values()].map((s) => s.state);
const notify = () => { for (const fn of listeners) fn(publicState()); };

/* ---------- config persistence ---------- */

const stored = (): McpServerConfig[] => settings.get().ide.mcpServers as McpServerConfig[];

const persist = (list: McpServerConfig[]) => settings.update({ ide: { mcpServers: list } });

/** Rebuild the in-memory map from settings, starting or stopping servers to match. */
export function syncServers(): McpServerState[] {
  const configs = stored();
  const seen = new Set<string>();

  for (const config of configs) {
    seen.add(config.id);
    const live = servers.get(config.id);
    if (!live) {
      servers.set(config.id, {
        child: null, buffer: '', nextId: 1, pending: new Map(),
        state: { config, status: 'stopped', tools: [], error: null },
      });
    } else {
      live.state.config = config;
    }
  }
  // Drop anything no longer configured.
  for (const id of [...servers.keys()]) {
    if (!seen.has(id)) {
      stopServer(id);
      servers.delete(id);
    }
  }

  for (const live of servers.values()) {
    if (live.state.config.enabled && live.state.status === 'stopped') void startServer(live.state.config.id);
    if (!live.state.config.enabled && live.state.status !== 'stopped') stopServer(live.state.config.id);
  }
  notify();
  return publicState();
}

export const listServers = (): McpServerState[] => publicState();

export function saveServer(raw: Partial<McpServerConfig>): McpServerState[] {
  const result = validateServerConfig(raw);
  if (!result.ok) throw new Error(result.reason);
  const list = stored().filter((s) => s.id !== result.config.id);
  persist([...list, result.config]);
  log.info(`Saved MCP server "${result.config.id}" (${result.config.transport})`);
  return syncServers();
}

export function removeServer(id: string): McpServerState[] {
  persist(stored().filter((s) => s.id !== id));
  log.info(`Removed MCP server "${id}"`);
  return syncServers();
}

/** Turning a server on is what actually starts the process, so it's a separate, explicit action. */
export function setServerEnabled(id: string, enabled: boolean): McpServerState[] {
  persist(stored().map((s) => (s.id === id ? { ...s, enabled } : s)));
  log.info(`MCP server "${id}" ${enabled ? 'enabled' : 'disabled'}`);
  return syncServers();
}

/* ---------- transport ---------- */

function handleMessage(live: Live, message: unknown) {
  if (!message || typeof message !== 'object') return;
  const m = message as { id?: unknown; result?: unknown; error?: { message?: unknown } };
  if (typeof m.id !== 'number') return; // a notification; nothing waiting on it
  const waiting = live.pending.get(m.id);
  if (!waiting) return;
  clearTimeout(waiting.timer);
  live.pending.delete(m.id);
  if (m.error) waiting.reject(new Error(String(m.error.message ?? 'The server returned an error.')));
  else waiting.resolve(m.result);
}

function request(live: Live, method: string, params?: unknown): Promise<unknown> {
  if (live.state.config.transport === 'http') return httpRequest(live, method, params);
  const child = live.child;
  if (!child?.stdin?.writable) return Promise.reject(new Error('That server is not running.'));
  const id = live.nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      live.pending.delete(id);
      reject(new Error(`The server did not answer "${method}" in time.`));
    }, REQUEST_TIMEOUT_MS);
    live.pending.set(id, { resolve, reject, timer });
    child.stdin!.write(encodeFrame({ jsonrpc: '2.0', id, method, params }));
  });
}

async function httpRequest(live: Live, method: string, params?: unknown): Promise<unknown> {
  const url = live.state.config.url;
  if (!url) throw new Error('That server has no URL.');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: live.nextId++, method, params }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`The server replied ${res.status}.`);
  const body = (await res.json()) as { result?: unknown; error?: { message?: unknown } };
  if (body.error) throw new Error(String(body.error.message ?? 'The server returned an error.'));
  return body.result;
}

/** Start one server and complete the MCP handshake, then cache the tools it offers. */
export async function startServer(id: string): Promise<McpServerState | null> {
  const live = servers.get(id);
  if (!live || live.state.status === 'starting' || live.state.status === 'ready') return live?.state ?? null;
  const config = live.state.config;

  live.state.status = 'starting';
  live.state.error = null;
  notify();

  try {
    if (config.transport === 'stdio') {
      // shell: false is the point — argv is passed through verbatim, never re-parsed by a shell.
      const child = spawn(config.command!, config.args ?? [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        env: { ...process.env, ...(config.env ?? {}) },
        windowsHide: true,
      });
      live.child = child;
      live.buffer = '';

      child.stdout?.on('data', (chunk: Buffer) => {
        const { messages, rest } = decodeFrames(live.buffer + chunk.toString('utf8'));
        live.buffer = rest;
        for (const m of messages) handleMessage(live, m);
      });
      // Servers routinely use stderr for logging; record it but never act on it.
      child.stderr?.on('data', (chunk: Buffer) => log.debug(`[${id}] ${chunk.toString('utf8').trim().slice(0, 500)}`));
      child.on('error', (err) => fail(live, err.message));
      child.on('exit', (code) => {
        if (live.state.status !== 'stopped') fail(live, `The server stopped (exit ${code ?? 'unknown'}).`);
      });
    }

    await request(live, 'initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'Lumina', version: '3.0.0-alpha.0' },
    });
    if (config.transport === 'stdio' && live.child?.stdin?.writable) {
      live.child.stdin.write(encodeFrame({ jsonrpc: '2.0', method: 'notifications/initialized' }));
    }

    live.state.tools = parseToolList(id, await request(live, 'tools/list'));
    live.state.status = 'ready';
    log.info(`MCP server "${id}" ready with ${live.state.tools.length} tool(s)`);
  } catch (err) {
    fail(live, err instanceof Error ? err.message : String(err));
  }
  notify();
  return live.state;
}

function fail(live: Live, reason: string) {
  live.state.status = 'error';
  live.state.error = reason;
  live.state.tools = [];
  for (const [, waiting] of live.pending) {
    clearTimeout(waiting.timer);
    waiting.reject(new Error(reason));
  }
  live.pending.clear();
  log.warn(`MCP server "${live.state.config.id}" failed: ${reason}`);
  notify();
}

export function stopServer(id: string) {
  const live = servers.get(id);
  if (!live) return;
  live.state.status = 'stopped';
  live.state.tools = [];
  live.state.error = null;
  for (const [, waiting] of live.pending) {
    clearTimeout(waiting.timer);
    waiting.reject(new Error('The server was stopped.'));
  }
  live.pending.clear();
  live.child?.kill();
  live.child = null;
  notify();
}

/** Every tool across every ready server — what an assistant would be offered. */
export const allTools = (): McpTool[] => publicState().flatMap((s) => (s.status === 'ready' ? s.tools : []));

/**
 * Call one tool. The caller must name an existing tool on a ready server; the arguments are passed
 * through untouched, and the result comes back as text that callers must treat as untrusted data.
 */
export async function callTool(serverId: string, name: string, args: unknown): Promise<{ text: string; isError: boolean }> {
  const live = servers.get(serverId);
  if (!live) throw new Error('No such server.');
  if (live.state.status !== 'ready') throw new Error('That server is not running.');
  if (!live.state.tools.some((t) => t.name === name)) throw new Error('That server does not offer that tool.');
  log.info(`Calling ${serverId}/${name}`);
  return parseToolResult(await request(live, 'tools/call', { name, arguments: args ?? {} }));
}

/** Start whatever the user left enabled, once, at launch. */
export function initMcp() {
  syncServers();
}

/** Stop every child process — called when the app quits so nothing is orphaned. */
export function shutdownMcp() {
  for (const id of servers.keys()) stopServer(id);
}
