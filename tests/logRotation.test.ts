import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumina-logtest-'));
vi.mock('../src/main/paths', () => ({ logsDir: () => dir }));

import { logger } from '../src/main/log';

describe('the log while the app keeps running', () => {
  beforeAll(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });
  afterAll(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rotates at 5 MB instead of growing for ever, and loses no line doing it', async () => {
    const log = logger('test');
    const lines = 70_000;
    const filler = 'x'.repeat(90);
    // In batches, as the app logs (over time): Node opens the file after the first tick, so a single 7 MB burst in one
    // tick would be written before the file even exists on disk.
    for (let i = 0; i < lines; i++) {
      log.info(`line ${i} ${filler}`);
      if (i % 2000 === 1999) await new Promise((r) => setTimeout(r, 20));
    }
    await new Promise((r) => setTimeout(r, 300));

    const old = path.join(dir, 'lumina.1.log');
    const now = path.join(dir, 'lumina.log');
    expect(fs.existsSync(old), 'the full log was moved aside').toBe(true);
    expect(fs.statSync(now).size, 'the new log started small').toBeLessThan(5 * 1024 * 1024);

    const count = (f: string) => fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.includes('[test] line ')).length;
    expect(count(old) + count(now), 'every line was written to one file or the other').toBe(lines);
  });
});
