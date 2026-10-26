import fs from 'node:fs';
import path from 'node:path';
import { logsDir } from './paths';

type Level = 'debug' | 'info' | 'warn' | 'error';
let verbose = false;
let stream: fs.WriteStream | null = null;

const MAX_LOG_BYTES = 5 * 1024 * 1024;
let written = 0;

const logFile = () => path.join(logsDir(), 'lumina.log');

/** Move the current log aside (keeping one older copy). Best-effort: a log that cannot rotate must never stop the app. */
function rotate() {
  try {
    fs.renameSync(logFile(), path.join(logsDir(), 'lumina.1.log'));
  } catch {
    // rotation is best-effort
  }
}

function out(): fs.WriteStream {
  if (stream) return stream;
  const file = logFile();
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_LOG_BYTES) rotate();
  } catch {
    // rotation is best-effort
  }
  stream = fs.createWriteStream(file, { flags: 'a' });
  // A stream error (disk full, file locked) must not become an uncaught exception from inside the logger.
  stream.on('error', () => {
    stream = null;
  });
  written = 0;
  return stream;
}

/**
 * Write one line, and rotate while running, not only at start-up: a tray app left open for weeks would otherwise
 * grow one file without limit. Node opens files on Windows with delete-sharing, so the full file can be renamed while
 * its stream is still open: the stream finishes writing what it was given (into the renamed file) and the next line
 * opens a fresh `lumina.log`. Nothing is held back, so nothing can be lost between the two.
 */
function emit(line: string) {
  const s = out();
  s.write(line);
  written += line.length;
  if (written <= MAX_LOG_BYTES) return;
  stream = null;
  written = 0;
  s.end();
  rotate();
}

function write(level: Level, scope: string, message: string, detail?: unknown) {
  if (level === 'debug' && !verbose) return;
  const extra = detail instanceof Error ? ` ${detail.stack ?? detail.message}` : detail !== undefined ? ` ${safeJson(detail)}` : '';
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}${extra}\n`;
  emit(line);
  if (!process.env.VITE_DEV_SERVER_URL && level === 'debug') return;
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.info)(line.trimEnd());
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v).slice(0, 2000);
  } catch {
    return String(v);
  }
}

export const setVerboseLogging = (on: boolean) => {
  verbose = on;
};

export function logger(scope: string) {
  return {
    debug: (m: string, d?: unknown) => write('debug', scope, m, d),
    info: (m: string, d?: unknown) => write('info', scope, m, d),
    warn: (m: string, d?: unknown) => write('warn', scope, m, d),
    error: (m: string, d?: unknown) => write('error', scope, m, d),
  };
}
