import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from 'node:child_process';

/** Kill a process and everything it started (yt-dlp → ffmpeg, aria2c children). */
export function killTree(child: ChildProcess | null | undefined): void {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
}

export function spawnTool(cmd: string, args: string[], options: SpawnOptions = {}): ChildProcess {
  return spawn(cmd, args, {
    windowsHide: true,
    // A separate process group lets killTree stop children on macOS/Linux.
    detached: process.platform !== 'win32',
    ...options,
  });
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Run a command to completion and collect output, with a timeout. */
export function runTool(cmd: string, args: string[], options: SpawnOptions & { timeoutMs?: number; maxBuffer?: number } = {}): Promise<RunResult> {
  const { timeoutMs = 120_000, maxBuffer = 64 * 1024 * 1024, ...spawnOptions } = options;
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawnTool(cmd, args, spawnOptions);
    } catch (err) {
      reject(err);
      return;
    }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      killTree(child);
      reject(new Error(`${cmd} timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.stdout?.on('data', (c: Buffer) => {
      if (stdout.length < maxBuffer) stdout += c.toString('utf8');
    });
    child.stderr?.on('data', (c: Buffer) => {
      if (stderr.length < 1024 * 1024) stderr += c.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/** Split a stream into lines, handling both \n and \r (progress bars). */
export function onLines(stream: NodeJS.ReadableStream | null | undefined, handler: (line: string) => void): void {
  if (!stream) return;
  let buffer = '';
  stream.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    const parts = buffer.split(/\r?\n|\r/);
    buffer = parts.pop() ?? '';
    for (const p of parts) if (p) handler(p);
  });
  stream.on('end', () => {
    if (buffer) handler(buffer);
    buffer = '';
  });
}
