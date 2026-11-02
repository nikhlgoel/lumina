import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const state = vi.hoisted(() => ({ base: '' }));

// The real queue and the real hand-off, with the app around them mocked: no profile, database or window.
vi.mock('electron', () => ({ app: { getPath: () => state.base, getVersion: () => '0.0.0-test', isPackaged: false } }));
vi.mock('../src/main/db', () => ({ database: () => ({ prepare: () => ({ run: () => ({}), all: () => [], get: () => undefined }) }) }));
vi.mock('../src/main/settings', () => ({
  settings: {
    get: () => ({
      downloads: { concurrency: 5, autoRetryFailed: false }, general: { resumeQueue: true }, privacy: { keepHistory: true, historyDays: 0 },
      storage: { tempDir: '' }, extension: { saveDir: state.base },
    }),
    on: () => undefined,
  },
}));
vi.mock('../src/main/paths', () => ({ tempDir: () => state.base }));
vi.mock('../src/main/log', () => ({ logger: () => ({ info: () => undefined, warn: () => undefined, debug: () => undefined, error: () => undefined }) }));
vi.mock('../src/main/resumeProbe', () => ({ fetchValidators: async () => null }));
vi.mock('../src/main/jobs/moveTorrent', () => ({ moveTorrentEntries: vi.fn() }));

type Queue = (typeof import('../src/main/jobs/queue'))['queue'];
type Handoff = typeof import('../src/main/bridge/handoff');
let queue: Queue;
let handoff: Handoff;

const capture = (url: string) => ({ url, kind: 'file' as const, filename: 'Archive.part1.rar', request: { headers: {}, cookies: [] } });
const never = new AbortController().signal;

beforeAll(async () => {
  state.base = fs.mkdtempSync(path.join(os.tmpdir(), 'lumina-handoff-'));
  ({ queue } = await import('../src/main/jobs/queue'));
  handoff = await import('../src/main/bridge/handoff');
  // An engine that has data flowing at once, so a hand-off is accepted.
  queue.register('aria2', (ctx) => {
    ctx.progress({ downloadedBytes: 1000, totalBytes: 5000, percent: 20 }, 'running');
    return { stop: () => undefined };
  });
});

afterAll(() => fs.rmSync(state.base, { recursive: true, force: true }));

describe('a browser download handed over twice', () => {
  it('is accepted, and is one job, while the first is still going', async () => {
    const first = await handoff.takeOverDownload(capture('https://files.example.net/a/Archive.part1.rar'), never);
    expect(first.accepted).toBe(true);
    const second = await handoff.takeOverDownload(capture('https://files.example.net/a/Archive.part1.rar'), never);
    expect(second).toMatchObject({ accepted: true, jobId: first.jobId });
    expect(queue.list().filter((j) => j.url.endsWith('/a/Archive.part1.rar'))).toHaveLength(1);
  });

  it('never removes a download the person paused: it is handed back to the browser instead', async () => {
    const first = await handoff.takeOverDownload(capture('https://files.example.net/b/Archive.part1.rar'), never);
    expect(first.accepted).toBe(true);
    queue.pause(first.jobId!);
    expect(queue.get(first.jobId!)!.status).toBe('paused');

    const again = await handoff.takeOverDownload(capture('https://files.example.net/b/Archive.part1.rar'), never);
    expect(again.accepted).toBe(false);
    expect(again.reason).toMatch(/already in Lumina/i);
    // The paused job, and with it any partial file it owns, is exactly as it was.
    expect(queue.get(first.jobId!)?.status).toBe('paused');
    expect(queue.list().filter((j) => j.url.endsWith('/b/Archive.part1.rar'))).toHaveLength(1);
  });

  it('is a new job again once the first one has finished', async () => {
    const first = await handoff.takeOverDownload(capture('https://files.example.net/c/Archive.part1.rar'), never);
    queue.cancel(first.jobId!);
    const again = await handoff.takeOverDownload(capture('https://files.example.net/c/Archive.part1.rar'), never);
    expect(again.accepted).toBe(true);
    expect(again.jobId).not.toBe(first.jobId);
  });
});
