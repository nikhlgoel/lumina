import fs from 'node:fs';
import path from 'node:path';
import { logsDir } from './paths';

type Level = 'debug' | 'info' | 'warn' | 'error';
let verbose = false;
let stream: fs.WriteStream | null = null;

function out(): fs.WriteStream {
  if (stream) return stream;
  const file = path.join(logsDir(), 'lumina.log');
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > 5 * 1024 * 1024) {
      fs.renameSync(file, path.join(logsDir(), 'lumina.1.log'));
    }
  } catch {
    // rotation is best-effort
  }
  stream = fs.createWriteStream(file, { flags: 'a' });
  return stream;
}

function write(level: Level, scope: string, message: string, detail?: unknown) {
  if (level === 'debug' && !verbose) return;
  const extra = detail instanceof Error ? ` ${detail.stack ?? detail.message}` : detail !== undefined ? ` ${safeJson(detail)}` : '';
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}${extra}\n`;
  out().write(line);
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
