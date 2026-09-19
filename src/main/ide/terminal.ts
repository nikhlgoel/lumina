// The integrated terminal: real pseudo-terminals, one per tab in the IDE.
//
// This is the one part of Lumina that deliberately runs whatever the user types — that is what a
// terminal is, and pretending otherwise would make it useless. What it does NOT do is take
// instructions from anywhere except the person at the keyboard:
//
//   * A session starts only when the user opens a terminal, never from a file, a job or a server.
//   * The shell itself comes from the vetted list in @core/ide — Lumina spawns `powershell.exe` or
//     `/bin/bash`, not an arbitrary string someone supplied.
//   * The working directory is the open workspace. With no workspace open there is no terminal.
//   * Output is bytes on the way to xterm. Nothing in this file parses it for commands.
//
// @lydell/node-pty is used rather than the original node-pty because it ships Node-API prebuilds:
// verified on 2026-09-18 to load inside Electron 44 and run a real shell with no rebuild step.
import { spawn as ptySpawn, type IPty } from '@lydell/node-pty';
import { existsSync } from 'node:fs';
import { pickShell, shellCandidates, type ShellChoice } from '../../core/ide';
import { detectUrls, type DetectedUrl } from '../../core/tasks';
import { bundledBinDir, updatedBinDir } from '../paths';
import { workspaceRoot } from './workspace';
import { settings } from '../settings';
import { logger } from '../log';

const log = logger('term');

/** Hard ceiling on concurrent shells, so a runaway caller can't fork-bomb by opening tabs. */
const MAX_SESSIONS = 8;

export interface TerminalSession {
  id: string;
  shellId: string;
  label: string;
  cwd: string;
}

export interface TerminalPorts {
  id: string;
  urls: DetectedUrl[];
}

interface Live {
  pty: IPty;
  session: TerminalSession;
  /** Server URLs seen in this session's output, so the Ports list can offer them. */
  urls: DetectedUrl[];
}

const sessions = new Map<string, Live>();
let counter = 0;

type DataListener = (id: string, chunk: string) => void;
type ExitListener = (id: string, exitCode: number) => void;
type PortsListener = (ports: TerminalPorts) => void;
let onData: DataListener = () => {};
let onExit: ExitListener = () => {};
let onPorts: PortsListener = () => {};

export function setTerminalListeners(data: DataListener, exit: ExitListener, ports: PortsListener = () => {}) {
  onData = data;
  onExit = exit;
  onPorts = ports;
}

/**
 * Lumina already ships ffmpeg, yt-dlp, aria2c and whisper-cli. Putting them on the terminal's PATH
 * means a project opened here can use them with no install and no version drift. They are APPENDED,
 * never prepended: a tool the user installed themselves must keep winning.
 */
function envWithBundledTools(extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = { ...process.env as Record<string, string>, ...(extra ?? {}) };
  const sep = process.platform === 'win32' ? ';' : ':';
  // Windows environment keys are case-insensitive but the object's are not, so find the real one.
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
  const dirs = [bundledBinDir(), updatedBinDir()].filter(Boolean);
  env[pathKey] = [env[pathKey] ?? '', ...dirs].filter(Boolean).join(sep);
  return env;
}

/** Which shells actually exist on this machine — the terminal's "+" menu is built from this. */
export function availableShells(): ShellChoice[] {
  return shellCandidates(process.platform).filter((s) => {
    // An absolute path has to be there; a bare name is resolved by the OS, so we let it through and
    // let the spawn fail loudly rather than guessing at PATH here.
    if (/[/\\]/.test(s.command)) return existsSync(s.command);
    return true;
  });
}

export function listTerminals(): TerminalSession[] {
  return [...sessions.values()].map((l) => l.session);
}

export interface StartOptions {
  shellId?: string;
  /** Typed into the shell once it is up, exactly as if the user had typed it. */
  command?: string;
  /** What the tab is called. Defaults to the shell's name. */
  label?: string;
  /**
   * Skip WSL and use a native shell.
   *
   * Running a project task matters here: the lockfile, `node_modules/.bin` and the toolchain belong
   * to the host OS, so `npm run dev` inside WSL either cannot find npm at all or runs a different
   * one against a `/mnt/...` path. A terminal the user opens themselves still honours their choice.
   */
  native?: boolean;
}

export function startTerminal(options: StartOptions = {}): TerminalSession {
  const { shellId, command, label, native } = options;
  const cwd = workspaceRoot();
  if (!cwd) throw new Error('Open a folder before starting a terminal.');
  if (sessions.size >= MAX_SESSIONS) throw new Error(`That is already ${MAX_SESSIONS} terminals — close one first.`);

  const usable = availableShells().filter((s) => !(native && s.id === 'wsl'));
  const available = new Set(usable.map((s) => s.id));
  const stored = settings.get().ide.shell;
  const preferred = shellId || (native && stored === 'wsl' ? undefined : stored) || undefined;
  const choice = pickShell(process.platform, available, preferred);
  if (!choice) throw new Error('No usable shell was found on this computer.');

  const id = `t${++counter}`;
  let pty: IPty;
  try {
    pty = ptySpawn(choice.command, choice.args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: envWithBundledTools(),
    });
  } catch (err) {
    throw new Error(`${choice.label} could not start: ${err instanceof Error ? err.message : String(err)}`);
  }

  const session: TerminalSession = { id, shellId: choice.id, label: label || choice.label, cwd };
  const live: Live = { pty, session, urls: [] };
  sessions.set(id, live);

  pty.onData((chunk) => {
    onData(id, chunk);
    // Watch for a dev server announcing itself, so the Ports list can offer to open it.
    const found = detectUrls(chunk);
    if (found.length === 0) return;
    let added = false;
    for (const url of found) {
      if (live.urls.some((u) => u.url === url.url)) continue;
      live.urls.push(url);
      added = true;
    }
    if (live.urls.length > 20) live.urls = live.urls.slice(live.urls.length - 20);
    if (added) onPorts({ id, urls: [...live.urls] });
  });
  pty.onExit(({ exitCode }) => {
    sessions.delete(id);
    onPorts({ id, urls: [] });
    log.info(`Terminal ${id} (${choice.label}) exited with ${exitCode}`);
    onExit(id, exitCode);
  });

  if (command) {
    // A tiny delay: conpty drops input written before the shell has finished starting.
    setTimeout(() => {
      if (sessions.get(id)?.pty.write) sessions.get(id)!.pty.write(`${command}` + String.fromCharCode(13));
    }, 400);
  }

  log.info(`Terminal ${id} started: ${choice.label} in ${cwd}${command ? ` running "${command}"` : ''}`);
  return session;
}

/** Every server URL currently known, per session. */
export const listPorts = (): TerminalPorts[] =>
  [...sessions.values()].filter((l) => l.urls.length > 0).map((l) => ({ id: l.session.id, urls: [...l.urls] }));

/** Keystrokes from the user's terminal tab. Passed through byte for byte — never interpreted. */
export function writeTerminal(id: string, data: string) {
  sessions.get(id)?.pty.write(data);
}

export function resizeTerminal(id: string, cols: number, rows: number) {
  const live = sessions.get(id);
  if (!live) return;
  // A zero or absurd size makes conpty throw, and the renderer can briefly report one mid-layout.
  const c = Math.max(2, Math.min(500, Math.floor(cols) || 80));
  const r = Math.max(1, Math.min(200, Math.floor(rows) || 24));
  try {
    live.pty.resize(c, r);
  } catch (err) {
    log.debug(`Resize of ${id} ignored: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function stopTerminal(id: string) {
  const live = sessions.get(id);
  if (!live) return;
  sessions.delete(id);
  try {
    live.pty.kill();
  } catch {
    // Already gone; onExit has done the bookkeeping.
  }
}

/** Kill every shell — called on quit so closing Lumina never leaves an orphan process behind. */
export function shutdownTerminals() {
  for (const id of [...sessions.keys()]) stopTerminal(id);
}
