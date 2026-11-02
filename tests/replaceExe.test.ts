import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { replaceExecutable } from '../src/main/replaceExe';

const PING = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'PING.EXE');
const children: ChildProcess[] = [];
const dirs: string[] = [];

afterEach(async () => {
  // A killed process still holds its file for a moment; the folder can only go once it has really exited.
  for (const c of children.splice(0)) {
    if (c.exitCode === null) await new Promise<void>((resolve) => { c.once('exit', () => resolve()); c.kill(); });
  }
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const sandbox = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumina-exe-'));
  dirs.push(dir);
  return dir;
};

describe('replacing an executable that may be running', () => {
  it('overwrites a program that is not running', () => {
    const dir = sandbox();
    const dest = path.join(dir, 'tool.bin');
    fs.writeFileSync(dest, 'old');
    fs.writeFileSync(`${dest}.new`, 'new');
    replaceExecutable(`${dest}.new`, dest);
    expect(fs.readFileSync(dest, 'utf8')).toBe('new');
    expect(fs.existsSync(`${dest}.new`)).toBe(false);
  });

  it('cleans up the half-written file and rethrows when the failure is not a locked file', () => {
    const dir = sandbox();
    const dest = path.join(dir, 'missing-folder', 'tool.bin');
    fs.writeFileSync(path.join(dir, 'tool.bin.new'), 'new');
    expect(() => replaceExecutable(path.join(dir, 'tool.bin.new'), dest)).toThrow();
    expect(fs.existsSync(path.join(dir, 'tool.bin.new'))).toBe(false);
  });

  // The real case from the owner's log. Needs Windows: only there is a running .exe locked against being overwritten.
  it.runIf(process.platform === 'win32' && fs.existsSync(PING))('replaces a program that is running, and leaves it running', async () => {
    const dir = sandbox();
    const dest = path.join(dir, 'tool.exe');
    fs.copyFileSync(PING, dest);
    fs.copyFileSync(PING, `${dest}.new`);
    const running = spawn(dest, ['-n', '30', '127.0.0.1'], { stdio: 'ignore', windowsHide: true });
    children.push(running);
    await new Promise((r) => setTimeout(r, 600));
    expect(running.exitCode).toBeNull(); // it really is running

    // What the update did before: refused.
    expect(() => fs.renameSync(`${dest}.new`, dest)).toThrow(/EPERM|EBUSY|EACCES/);

    replaceExecutable(`${dest}.new`, dest);
    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.existsSync(`${dest}.new`)).toBe(false);
    expect(running.exitCode).toBeNull(); // the download that was using it is not disturbed
  });
});
