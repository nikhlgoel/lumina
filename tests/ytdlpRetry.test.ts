import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../src/shared/settings';
import { FILE_PREFIX, ITEM_PREFIX } from '../src/core/ytdlpArgs';

// The real runner, with a scripted yt-dlp: no real tool, no profile, no window. What is checked is what the runner DOES with a playlist whose
// items fail in different ways (core/ytdlpFailures has the rules; this proves they are applied): which items are tried again, after what rest,
// how gently, and what the finished job says.
const state = vi.hoisted(() => ({ base: '', settings: null as unknown, script: null as null | ((items: number[], gentle: boolean, spawnNo: number) => { index: number; error?: string; noItemLine?: boolean }[]) }));
const spawned: { args: string[] }[] = [];

vi.mock('../src/main/settings', () => ({ settings: { get: () => state.settings } }));
vi.mock('../src/main/paths', () => ({ archiveFile: (name: string) => path.join(state.base, name), tempDir: () => state.base }));
vi.mock('../src/main/log', () => ({ logger: () => ({ info: () => undefined, warn: () => undefined, debug: () => undefined, error: () => undefined }) }));
vi.mock('../src/main/cookieHealth', () => ({ browserCookiesUnreadable: () => false, markBrowserCookiesUnreadable: () => undefined }));
vi.mock('../src/main/request', () => ({ requestContext: () => ({ headers: {}, userAgent: '', proxy: '', forceIpv4: false, cookies: {} }), usesSavedSignIn: () => false }));
vi.mock('../src/main/services/ytmusic', () => ({ matchTracks: async () => ({ urls: [], unmatched: 0 }) }));
vi.mock('../src/main/lineSpeed', () => ({ activeBindList: () => [], measureLines: async () => [] }));
vi.mock('../src/main/jobs/postprocess', () => ({ postprocess: async () => undefined }));
vi.mock('../src/main/tools', () => ({ tools: { require: () => 'yt-dlp', ffmpegDir: () => '', jsRuntime: () => 'node:node', env: () => ({}), has: () => false } }));
vi.mock('../src/main/process', () => ({
  killTree: () => undefined,
  onLines: (stream: NodeJS.ReadableStream | null, handler: (line: string) => void) => {
    let buffer = '';
    stream?.on('data', (chunk: Buffer) => {
      const parts = (buffer + chunk.toString('utf8')).split(/\r?\n/);
      buffer = parts.pop() ?? '';
      for (const p of parts) if (p) handler(p);
    });
  },
  spawnTool: (_cmd: string, args: string[]) => {
    spawned.push({ args });
    const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; pid: number; exitCode: number | null };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.pid = 0;
    child.exitCode = null;
    const itemsArg = args[args.indexOf('--playlist-items') + 1] ?? '';
    const items = itemsArg.split(',').flatMap((part) => {
      const [a, b] = part.split('-').map(Number);
      return b === undefined ? [a as number] : Array.from({ length: (b as number) - (a as number) + 1 }, (_, i) => (a as number) + i);
    });
    const outcome = state.script?.(items, args.includes('--sleep-interval'), spawned.length) ?? [];
    setImmediate(() => {
      for (const o of outcome) {
        // An item that fails while yt-dlp is still reading it has no item line yet.
        if (!o.noItemLine) child.stdout.write(`${ITEM_PREFIX}${o.index}|10|Song ${o.index}\n`);
        child.stdout.write(o.error ? `ERROR: ${o.error}\n` : `${FILE_PREFIX}${path.join(state.base, 'out', `${String(o.index).padStart(2, '0')} - Song ${o.index}.flac`)}\n`);
      }
      setImmediate(() => child.emit('close', outcome.some((o) => o.error) ? 1 : 0));
    });
    return child;
  },
}));

const id = (n: number) => `vid${String(n).padStart(8, '0')}`;
const THROTTLED = (n: number) => `[youtube] ${id(n)}: Sign in to confirm you’re not a bot. Use --cookies-from-browser`;
const GONE = (n: number) => `[youtube] ${id(n)}: This video is not available`;

let runner: (typeof import('../src/main/jobs/ytdlp'))['ytdlpRunner'];
const flush = async () => { for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r)); };

interface Ended { completed: number; failed: string[]; summary: string | null; files: number; failedItems: number[] | undefined; percents: number[] }
function run(initial: { failedItems?: number[]; outputPaths?: string[] } = {}): { ended: () => Ended; stop: () => void } {
  const job = {
    id: 'job1', url: 'https://music.youtube.com/playlist?list=PLx', title: 'Songs', engine: 'ytdlp', outputPaths: initial.outputPaths ?? [], outputDir: path.join(state.base, 'out'),
    engineState: (initial.failedItems ? { finishedItems: 0, failedItems: initial.failedItems } : {}) as { finishedItems?: number; failedItems?: number[] }, compat: undefined as { tvSafe: boolean; summary: string } | undefined,
    source: { sourceKind: 'playlist', site: 'YouTube Music', entries: Array.from({ length: 10 }, (_, i) => ({ index: i + 1, id: id(i + 1), title: `Song ${i + 1}`, uploader: '', durationSec: 200, url: `https://music.youtube.com/watch?v=${id(i + 1)}`, thumbnail: null })) },
    options: {
      contentType: 'music', format: { kind: 'audio', target: 'flac', bitrateKbps: null }, targetDir: path.join(state.base, 'out'), playlistItems: [],
      englishSubtitles: false, subtitleOutput: [], embedMetadata: true, embedLyrics: false, sponsorBlock: false,
    },
  };
  let completed = 0;
  const failed: string[] = [];
  const percents: number[] = [];
  const ctx = {
    job: () => job as never,
    progress: (p: { percent?: number }) => { if (typeof p.percent === 'number') percents.push(p.percent); },
    patch: (p: Record<string, unknown>) => {
      if (p.outputPaths) job.outputPaths = p.outputPaths as string[];
      if (p.compat) job.compat = p.compat as never;
      if ('engineState' in p) job.engineState = p.engineState as never;
    },
    complete: () => { completed++; },
    fail: (m: string) => { failed.push(m); },
    workDir: path.join(state.base, 'work'),
  };
  fs.mkdirSync(ctx.workDir, { recursive: true });
  const handle = runner(ctx as never);
  return { ended: () => ({ completed, failed, summary: job.compat?.summary ?? null, files: job.outputPaths.length, failedItems: job.engineState.failedItems, percents }), stop: () => void handle.stop('cancel') };
}

beforeAll(async () => {
  state.base = fs.mkdtempSync(path.join(os.tmpdir(), 'lumina-retry-'));
  const s = defaultSettings();
  s.downloads.playlistWorkers = 1;
  s.downloads.accelerate = false;
  s.downloads.skipExisting = false;
  s.storage.otherDir = path.join(state.base, 'out');
  state.settings = s;
  ({ ytdlpRunner: runner } = await import('../src/main/jobs/ytdlp'));
});
afterAll(() => fs.rmSync(state.base, { recursive: true, force: true }));
beforeEach(() => { spawned.length = 0; vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); });
afterEach(() => { vi.useRealTimers(); });

const ok = (items: number[]) => items.map((index) => ({ index }));

describe('a playlist where some items fail while others work', () => {
  it('tries the recoverable ones again after a rest, gently, and tells the truth about what is left', async () => {
    state.script = (items, gentle, spawnNo) => {
      if (spawnNo === 1) {
        const bad: Record<number, string> = { 3: THROTTLED(3), 5: 'aria2c exited with code 1', 7: THROTTLED(7), 9: GONE(9) };
        return items.map((index) => (bad[index] ? { index, error: bad[index] } : { index }));
      }
      expect(gentle, 'a retry pass must be gentle').toBe(true);
      // second pass: 3 and 5 come through, 7 is refused again; third pass: 7 comes through
      return items.map((index) => (spawnNo === 2 && index === 7 ? { index, error: THROTTLED(7) } : { index }));
    };
    const r = run();
    await flush();
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.args).toContain('1-10');
    expect(spawned[0]?.args).not.toContain('--sleep-interval');
    expect(r.ended().completed).toBe(0); // resting, not finished

    await vi.advanceTimersByTimeAsync(90_000);
    await flush();
    expect(spawned).toHaveLength(2);
    expect(spawned[1]?.args[spawned[1].args.indexOf('--playlist-items') + 1]).toBe('3,5,7'); // only the recoverable ones; 9 is gone for good
    expect(spawned[1]?.args).toContain('--sleep-interval');
    expect(r.ended().completed).toBe(0);

    await vi.advanceTimersByTimeAsync(300_000);
    await flush();
    expect(spawned).toHaveLength(3);
    expect(spawned[2]?.args[spawned[2].args.indexOf('--playlist-items') + 1]).toBe('7');

    const end = r.ended();
    expect(end.completed).toBe(1);
    expect(end.failed).toEqual([]);
    expect(end.files).toBe(9); // 10 minus the one that is gone
    expect(end.summary).toContain('1 of 10 could not be downloaded: 1 unavailable (removed, private or blocked)');
    expect(end.summary).toContain('3 items were recovered on a second try');
    expect(end.summary).not.toMatch(/stopped unexpectedly|code 1/i);
  });

  it('stops after a retry that saved nothing, and says the site is limiting this connection', async () => {
    state.script = (items, _gentle, spawnNo) => items.map((index) => (spawnNo === 1 && [4, 6].includes(index)) || spawnNo >= 2 ? { index, error: THROTTLED(index) } : { index });
    const r = run();
    await flush();
    await vi.advanceTimersByTimeAsync(90_000);
    await flush();
    expect(spawned).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(600_000);
    await flush();
    expect(spawned).toHaveLength(2); // no third pass: a rest that did not help will not be helped by another
    const end = r.ended();
    expect(end.completed).toBe(1);
    expect(end.summary).toContain('2 of 10 could not be downloaded: 2 refused while the site was limiting downloads');
    expect(end.summary).toMatch(/press Retry in an hour/i);
  });

  it('does not retry items that are gone for good', async () => {
    state.script = (items) => items.map((index) => (index === 2 || index === 8 ? { index, error: GONE(index) } : { index }));
    const r = run();
    await flush();
    await vi.advanceTimersByTimeAsync(900_000);
    await flush();
    expect(spawned).toHaveLength(1);
    const end = r.ended();
    expect(end.completed).toBe(1);
    expect(end.summary).toContain('2 of 10 could not be downloaded: 2 unavailable');
    expect(end.summary).not.toMatch(/retry/i);
  });

  it('says nothing special when every item downloads', async () => {
    state.script = (items) => ok(items);
    const r = run();
    await flush();
    expect(spawned).toHaveLength(1);
    expect(r.ended()).toMatchObject({ completed: 1, summary: null, files: 10 });
  });

  it('does not start another pass if the person cancels while it is resting', async () => {
    state.script = (items) => items.map((index) => (index === 3 ? { index, error: THROTTLED(3) } : { index }));
    const r = run();
    await flush();
    expect(spawned).toHaveLength(1);
    r.stop();
    await vi.advanceTimersByTimeAsync(900_000);
    await flush();
    expect(spawned).toHaveLength(1);
    expect(r.ended().completed).toBe(0);
  });

  it('keeps the progress bar moving forward through a retry pass instead of jumping back to zero', async () => {
    state.script = (items, _gentle, spawnNo) => items.map((index) => (spawnNo === 1 && [4, 6, 8].includes(index) ? { index, error: THROTTLED(index) } : { index }));
    const r = run();
    await flush();
    await vi.advanceTimersByTimeAsync(90_000);
    await flush();
    const afterFirst = r.ended().percents;
    expect(Math.max(...afterFirst)).toBeGreaterThan(0);
    // every report made during the retry pass is measured against all 10 items: 7 done to start with, so never below 70
    const duringRetry = afterFirst.slice(afterFirst.lastIndexOf(Math.max(...afterFirst)));
    expect(Math.min(...duringRetry)).toBeGreaterThanOrEqual(70);
  });

  it('pins an extraction error with no video id on the item being read, not on the one before it', async () => {
    // Item 3 fails while downloading (the accelerator). Item 4 then fails while yt-dlp is still reading it, so no item line has been printed yet and
    // the message names no id. It used to be pinned on item 3 again, and item 4 was never retried.
    state.script = (items, _gentle, spawnNo) => {
      if (spawnNo === 1) {
        return items.map((index) => {
          if (index === 3) return { index, error: 'aria2c exited with code 1' };
          if (index === 4) return { index, error: 'Unable to download video data: HTTP Error 503', noItemLine: true };
          return { index };
        });
      }
      return ok(items);
    };
    const r = run();
    await flush();
    await vi.advanceTimersByTimeAsync(90_000);
    await flush();
    expect(spawned).toHaveLength(2);
    expect(spawned[1]?.args[spawned[1].args.indexOf('--playlist-items') + 1]).toBe('3,4'); // both, not just item 3
    expect(r.ended().completed).toBe(1);
    expect(r.ended().summary).toContain('All 10 downloaded (2 items needed a second try)');
  });

  it('remembers what a Retry should fetch, and fetches only that, gently, when the finished job is started again', async () => {
    // A rest that saved nothing leaves the items behind; the job finishes saying so, and records which ones.
    state.script = (items, _gentle, spawnNo) => items.map((index) => ([4, 6].includes(index) ? { index, error: THROTTLED(index) } : { index }));
    const first = run();
    await flush();
    await vi.advanceTimersByTimeAsync(90_000);
    await flush();
    expect(first.ended().completed).toBe(1);
    expect(first.ended().failedItems).toEqual([4, 6]);

    spawned.length = 0;
    state.script = (items) => ok(items); // the site has calmed down
    const again = run({ failedItems: [4, 6], outputPaths: Array.from({ length: 8 }, (_, i) => `f${i}.flac`) });
    await flush();
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.args[spawned[0].args.indexOf('--playlist-items') + 1]).toBe('4,6');
    expect(spawned[0]?.args).toContain('--sleep-interval');
    const end = again.ended();
    expect(end.completed).toBe(1);
    expect(end.failedItems).toBeUndefined();
    // The Retry's own saves are counted, and a Retry that saves nothing does not start two more passes by itself (see the next test).
    expect(end.summary).toBe('All 10 downloaded (2 items needed a second try).');
  });

  it('does not start more passes by itself when a pressed Retry saves nothing', async () => {
    state.script = (items) => items.map((index) => ({ index, error: THROTTLED(index) }));
    spawned.length = 0;
    const again = run({ failedItems: [4, 6], outputPaths: Array.from({ length: 8 }, (_, i) => `f${i}.flac`) });
    await flush();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await flush();
    expect(spawned).toHaveLength(1);
    expect(again.ended().failedItems).toEqual([4, 6]);
  });
});
