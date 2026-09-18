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

interface Live {
  pty: IPty;
  session: TerminalSession;
}

const sessions = new Map<string, Live>();
let counter = 0;

type DataListener = (id: string, chunk: string) => void;
type ExitListener = (id: string, exitCode: number) => void;
let onData: DataListener = () => {};
let onExit: ExitListener = () => {};

export function setTerminalListeners(data: DataListener, exit: ExitListener) {
  onData = data;
  onExit = exit;
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

export function startTerminal(shellId?: string): TerminalSession {
  const cwd = workspaceRoot();
  if (!cwd) throw new Error('Open a folder before starting a terminal.');
  if (sessions.size >= MAX_SESSIONS) throw new Error(`That is already ${MAX_SESSIONS} terminals — close one first.`);

  const available = new Set(availableShells().map((s) => s.id));
  const preferred = shellId || settings.get().ide.shell || undefined;
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
      env: process.env as Record<string, string>,
    });
  } catch (err) {
    throw new Error(`${choice.label} could not start: ${err instanceof Error ? err.message : String(err)}`);
  }

  const session: TerminalSession = { id, shellId: choice.id, label: choice.label, cwd };
  sessions.set(id, { pty, session });

  pty.onData((chunk) => onData(id, chunk));
  pty.onExit(({ exitCode }) => {
    sessions.delete(id);
    log.info(`Terminal ${id} (${choice.label}) exited with ${exitCode}`);
    onExit(id, exitCode);
  });

  log.info(`Terminal ${id} started: ${choice.label} in ${cwd}`);
  return session;
}

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
