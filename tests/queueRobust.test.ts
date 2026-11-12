import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Job } from '@shared/types';

const state = vi.hoisted(() => ({ concurrency: 1, base: '', rows: [] as { data: string }[], autoRetry: false }));

vi.mock('../src/main/db', () => ({ database: () => ({ prepare: () => ({ run: () => ({}), all: () => state.rows, get: () => undefined }) }) }));
vi.mock('../src/main/settings', () => ({
  settings: { get: () => ({ downloads: { concurrency: state.concurrency, autoRetryFailed: state.autoRetry }, general: { resumeQueue: true }, privacy: { keepHistory: true, historyDays: 0 }, storage: { tempDir: '' }, network: {} }), on: () => undefined },
}));
vi.mock('../src/main/paths', () => ({ tempDir: () => state.base }));
vi.mock('../src/main/log', () => ({ logger: () => ({ info: () => undefined, warn: () => undefined, debug: () => undefined, error: () => undefined }) }));
vi.mock('../src/main/resumeProbe', () => ({ fetchValidators: async () => null }));
vi.mock('../src/main/jobs/moveTorrent', () => ({ moveTorrentEntries: vi.fn() }));

type Queue = (typeof import('../src/main/jobs/queue'))['queue'];
let queue: Queue;
let clock = 1_700_000_000_000;
const contexts = new Map<string, { complete: () => void; fail: (m: string) => void }>();
const started: string[] = [];
const everyContext: { url: string; complete: () => void; fail: (m: string) => void }[] = [];

const input = (url: string) => ({
  url, title: url, thumbnail: null, uploader: '', engine: 'ytdlp' as const, outputDir: null, source: { sourceKind: 'direct' as const, site: 'test', entries: [] },
  options: { contentType: 'video' as const, format: { kind: 'video' as const, maxHeight: null, codec: 'any' as const, container: 'mp4' as const, maxFps: null, allowHdr: true, tvSafe: false },
    englishSubtitles: false, subtitleOutput: [], embedMetadata: false, embedLyrics: false, sponsorBlock: false, playlistItems: [] },
});

beforeAll(async () => {
  state.base = fs.mkdtempSync(path.join(os.tmpdir(), 'lumina-queue-robust-'));
  vi.spyOn(Date, 'now').mockImplementation(() => (clock += 5));
  ({ queue } = await import('../src/main/jobs/queue'));
  queue.register('ytdlp', (ctx) => {
    const url = ctx.job().url;
    started.push(url);
    contexts.set(url, { complete: () => ctx.complete(), fail: (m) => ctx.fail(m) });
    everyContext.push({ url, complete: () => ctx.complete(), fail: (m) => ctx.fail(m) });
    return { stop: () => undefined };
  });
});

afterAll(() => {
  vi.restoreAllMocks();
  fs.rmSync(state.base, { recursive: true, force: true });
});

describe('a listener that throws when a download ends', () => {
  it('does not stop the next waiting download from starting', () => {
    const boom = () => { throw new Error('a notification handler broke'); };
    queue.on('completed', boom);
    queue.add(input('https://x.test/first'));
    queue.add(input('https://x.test/second'));
    expect(started).toEqual(['https://x.test/first']); // one at a time
    expect(() => contexts.get('https://x.test/first')!.complete()).not.toThrow();
    queue.off('completed', boom);
    expect(queue.list().find((j) => j.url.endsWith('/first'))!.status).toBe('completed');
    expect(started).toContain('https://x.test/second');
  });

  it('does not stop it when the listener throws for a failure either', () => {
    const boom = () => { throw new Error('a failure handler broke'); };
    queue.on('failed', boom);
    queue.add(input('https://x.test/third')); // waits behind the one that is running
    const running = queue.list().find((j) => j.status === 'running')!;
    expect(started).not.toContain('https://x.test/third');
    contexts.get(running.url)!.fail('network down');
    queue.off('failed', boom);
    expect(queue.get(running.id)!.status).toBe('failed');
    expect(started).toContain('https://x.test/third');
  });
});

describe('downloads saved while waiting for a timer', () => {
  it('are put back in the queue at start-up instead of saying "waiting" for ever', () => {
    const waiting = { id: 'w1', createdAt: 1, updatedAt: 1, engine: 'ytdlp', url: 'https://x.test/waiting', title: 'w', status: 'failed', error: { message: 'Connection lost' }, progress: { activity: 'waiting', stage: 'Waiting for the network' }, options: input('x').options, engineState: {}, outputPaths: [], source: { sourceKind: 'direct', site: 't', entries: [] } };
    const retrying = { ...waiting, id: 'w2', url: 'https://x.test/retrying', progress: { activity: null, stage: 'Retrying in 2 min' } };
    const failed = { ...waiting, id: 'w3', url: 'https://x.test/failed', progress: { activity: null, stage: 'Failed' } };
    state.rows = [waiting, retrying, failed].map((j) => ({ data: JSON.stringify(j) }));
    state.concurrency = 0;
    queue.load();
    const byId = (id: string) => queue.get(id) as Job;
    expect(byId('w1').status).toBe('queued');
    expect(byId('w1').error).toBeNull();
    expect(byId('w2').status).toBe('queued');
    expect(byId('w3').status).toBe('failed'); // an ordinary failure stays one
  });
});

describe('a run that was paused and started again', () => {
  it('cannot finish or fail the new run when it says something late', () => {
    state.concurrency = 5;
    const job = queue.add(input('https://x.test/pause-resume'));
    const runsOfIt = () => everyContext.filter((c) => c.url === job.url);
    expect(runsOfIt()).toHaveLength(1);
    queue.pause(job.id);
    queue.resume(job.id);
    expect(runsOfIt()).toHaveLength(2); // a second run began
    runsOfIt()[0]!.complete(); // the first run, winding down, reports in late
    expect(queue.get(job.id)!.status).toBe('running');
    runsOfIt()[0]!.fail('the old run broke');
    expect(queue.get(job.id)!.status).toBe('running');
    runsOfIt()[1]!.complete(); // the second one is the one that counts
    expect(queue.get(job.id)!.status).toBe('completed');
  });
});

describe('cancelling a download that is waiting for the network', () => {
  it('ends it as Cancelled instead of leaving it on the row looking failed', () => {
    state.concurrency = 5;
    state.autoRetry = true;
    const job = queue.add(input('https://x.test/offline'));
    contexts.get('https://x.test/offline')!.fail('Connection lost: getaddrinfo ENOTFOUND x.test');
    state.autoRetry = false;
    const waiting = queue.get(job.id)!;
    expect(waiting.status).toBe('failed');
    expect(waiting.progress.activity).toBe('waiting'); // it is waiting for the network, "failed" underneath
    queue.cancel(job.id);
    const after = queue.get(job.id)!;
    expect(after.status).toBe('cancelled');
    expect(after.progress.stage).toBe('Cancelled');
    expect(after.progress.activity).toBeNull();
    expect(after.error).toBeNull();
    expect(queue.willRetry(job.id)).toBe(false); // and nothing will start it again
  });

  it('still ignores a cancel for a download that really failed', () => {
    const job = queue.add(input('https://x.test/really-failed'));
    contexts.get('https://x.test/really-failed')!.fail('The file is damaged: its contents do not match its type.');
    expect(queue.get(job.id)!.status).toBe('failed');
    queue.cancel(job.id);
    expect(queue.get(job.id)!.status).toBe('failed');
  });
});
