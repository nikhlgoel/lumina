import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const state = vi.hoisted(() => ({ concurrency: 0, base: '' }));

// The queue needs only these to schedule: no real database, profile or app.
vi.mock('../src/main/db', () => ({ database: () => ({ prepare: () => ({ run: () => ({}), all: () => [], get: () => undefined }) }) }));
vi.mock('../src/main/settings', () => ({
  settings: { get: () => ({ downloads: { concurrency: state.concurrency, autoRetryFailed: false }, general: { resumeQueue: true }, privacy: { keepHistory: true, historyDays: 0 }, storage: { tempDir: '' } }), on: () => undefined },
}));
vi.mock('../src/main/paths', () => ({ tempDir: () => state.base }));
vi.mock('../src/main/log', () => ({ logger: () => ({ info: () => undefined, warn: () => undefined, debug: () => undefined, error: () => undefined }) }));
vi.mock('../src/main/resumeProbe', () => ({ fetchValidators: async () => null }));
vi.mock('../src/main/jobs/moveTorrent', () => ({ moveTorrentEntries: vi.fn() }));

type Queue = (typeof import('../src/main/jobs/queue'))['queue'];
let queue: Queue;
let clock = 1_700_000_000_000;

const starts = new Map<string, number>();
const failFirst = new Set<string>(); // urls whose runner throws at once

const input = (url: string) => ({
  url, title: url, thumbnail: null, uploader: '', engine: 'ytdlp' as const, outputDir: null, source: { sourceKind: 'direct' as const, site: 'test', entries: [] },
  options: { contentType: 'video' as const, format: { kind: 'video' as const, maxHeight: null, codec: 'any' as const, container: 'mp4' as const, maxFps: null, allowHdr: true, tvSafe: false },
    englishSubtitles: false, subtitleOutput: [], embedMetadata: false, embedLyrics: false, sponsorBlock: false, playlistItems: [] },
});

beforeAll(async () => {
  state.base = fs.mkdtempSync(path.join(os.tmpdir(), 'lumina-queue-'));
  vi.spyOn(Date, 'now').mockImplementation(() => (clock += 5)); // distinct creation times, so the order is the order added
  ({ queue } = await import('../src/main/jobs/queue'));
  queue.register('aria2', (ctx) => {
    const url = ctx.job().url;
    starts.set(url, (starts.get(url) ?? 0) + 1);
    return { stop: () => undefined };
  });
  queue.register('ytdlp', (ctx) => {
    const url = ctx.job().url;
    starts.set(url, (starts.get(url) ?? 0) + 1);
    if (failFirst.has(url)) throw new Error('the runner failed at once');
    return { stop: () => undefined };
  });
});

afterAll(() => {
  vi.restoreAllMocks();
  fs.rmSync(state.base, { recursive: true, force: true });
});

describe('starting queued downloads', () => {
  it('starts each job once, even when a runner fails at once and the queue is scheduled again from inside it', () => {
    state.concurrency = 0; // nothing starts while they are added
    failFirst.add('https://x.test/a');
    for (const name of ['a', 'b', 'c', 'd']) queue.add(input(`https://x.test/${name}`));
    expect(queue.list().every((j) => j.status === 'queued')).toBe(true);

    state.concurrency = 3;
    queue.schedule();

    // a fails at once and re-enters schedule(), which starts b, c and d; the outer pass must not start them again.
    expect([...starts.entries()].sort()).toEqual([['https://x.test/a', 1], ['https://x.test/b', 1], ['https://x.test/c', 1], ['https://x.test/d', 1]]);
    expect(queue.list().find((j) => j.url.endsWith('/a'))?.status).toBe('failed');
  });

  it('does not let a folder that cannot be created stop the jobs behind it', () => {
    state.concurrency = 0;
    const bad = queue.add(input('https://x.test/needs-folder'));
    const good = queue.add(input('https://x.test/after-it'));
    const real = fs.mkdirSync;
    const spy = vi.spyOn(fs, 'mkdirSync').mockImplementation(((p: fs.PathLike, o?: fs.MakeDirectoryOptions) => {
      if (String(p).includes(bad.id)) throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
      return real(p, o);
    }) as typeof fs.mkdirSync);

    state.concurrency = 10; // room for these two besides the three the previous test left running
    expect(() => queue.schedule()).not.toThrow();
    spy.mockRestore();

    const failed = queue.get(bad.id)!;
    expect(failed.status).toBe('failed');
    expect(failed.error?.message).toMatch(/working folder/i);
    expect(failed.error?.detail).toMatch(/ENOSPC/);
    expect(starts.get('https://x.test/after-it')).toBe(1);
    expect(queue.get(good.id)!.status).toBe('running');
  });
});

describe('the same download sent twice', () => {
  it('is one job while the first is still going, and two once the first is over', () => {
    state.concurrency = 0;
    const first = queue.add(input('https://x.test/twice'));
    const second = queue.add(input('https://x.test/twice'));
    expect(second.id).toBe(first.id);
    expect(queue.list().filter((j) => j.url.endsWith('/twice'))).toHaveLength(1);

    queue.cancel(first.id);
    const third = queue.add(input('https://x.test/twice'));
    expect(third.id).not.toBe(first.id);
  });
});

describe('telling the window about a new download', () => {
  it('announces a job the moment it is added, even one that has to wait its turn (a batch of 12 once showed as 3)', () => {
    state.concurrency = 0;
    const seen: string[] = [];
    const listener = (job: { id: string }) => seen.push(job.id);
    queue.on('updated', listener);
    const added = ['p1', 'p2', 'p3'].map((n) => queue.add(input(`https://x.test/announce-${n}`)));
    queue.off('updated', listener);
    expect(added.every((j) => j.status === 'queued')).toBe(true);
    expect(seen).toEqual(added.map((j) => j.id));
  });
});

describe('hosts that cannot take many downloads at once', () => {
  const aria = (url: string) => ({ ...input(url), engine: 'aria2' as const });

  it('start one file at a time from Pixeldrain, however many are queued and however much room there is', () => {
    state.concurrency = 0;
    const urls = ['a', 'b', 'c', 'd'].map((n) => `https://pixeldrain.com/api/file/${n}?download`);
    for (const u of urls) queue.add(aria(u));
    state.concurrency = 50;
    queue.schedule();
    expect(urls.filter((u) => starts.get(u) === 1)).toEqual([urls[0]]);
    expect(queue.list().filter((j) => j.url.startsWith('https://pixeldrain.com') && j.status === 'queued')).toHaveLength(3);
  });

  it('start the next one from that host as soon as the one running is over', () => {
    const running = queue.list().find((j) => j.url.startsWith('https://pixeldrain.com') && j.status === 'running');
    expect(running).toBeDefined();
    queue.cancel(running!.id);
    queue.schedule();
    const nowRunning = queue.list().filter((j) => j.url.startsWith('https://pixeldrain.com') && j.status === 'running');
    expect(nowRunning).toHaveLength(1);
  });

  it('leave every other host on the person’s own limit', () => {
    state.concurrency = 0;
    const urls = ['a', 'b', 'c'].map((n) => `https://files.example.org/${n}.bin`);
    for (const u of urls) queue.add(aria(u));
    state.concurrency = 80;
    queue.schedule();
    expect(urls.every((u) => starts.get(u) === 1)).toBe(true);
  });
});
