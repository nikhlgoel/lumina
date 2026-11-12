import { describe, expect, it } from 'vitest';
// @ts-expect-error - a plain browser script with no type declarations
import { pickVideo, probeEpisode, probeEpisodes, scoreVideo } from '../extension/probe.js';

type Item = { url: string; kind: 'stream' | 'media'; sizeBytes?: number | null; time?: number };
const stream = (url: string, time = 1): Item => ({ url, kind: 'stream', time });
const media = (url: string, sizeBytes: number, time = 1): Item => ({ url, kind: 'media', sizeBytes, time });

/** A fake browser: each "tab" shows what `script` says at each moment, on a clock the test controls. */
function fakeBrowser(script: (url: string, ms: number, nudges: number) => Item[]) {
  let clock = 0;
  const tabs = new Map<number, { url: string; opened: number; nudges: number }>();
  const closed: number[] = [];
  let nextId = 1;
  const deps = {
    open: async (url: string) => { const id = nextId++; tabs.set(id, { url, opened: clock, nudges: 0 }); return id; },
    close: async (id: number) => { closed.push(id); },
    found: async (id: number) => { const t = tabs.get(id)!; return script(t.url, clock - t.opened, t.nudges); },
    nudge: async (id: number) => { tabs.get(id)!.nudges++; },
    sleep: async (ms: number) => { clock += ms; },
    now: () => clock,
  };
  return { deps, closed, opened: () => nextId - 1 };
}

describe('choosing the video among what a page requested', () => {
  it('takes a stream over a file, a main playlist over a part, and the bigger file of two', () => {
    expect(pickVideo([media('https://c.example/a.mp4', 5e6), stream('https://c.example/x/index.m3u8')])?.url).toContain('index.m3u8');
    expect(pickVideo([stream('https://c.example/chunk.m3u8', 1), stream('https://c.example/master.m3u8', 2)])?.url).toContain('master.m3u8');
    expect(pickVideo([media('https://c.example/small.mp4', 6e5), media('https://c.example/big.mp4', 9e8)])?.url).toContain('big.mp4');
  });

  it('leaves out adverts and finds nothing in a page with none', () => {
    expect(pickVideo([stream('https://pubads.doubleclick.net/x/index.m3u8'), media('https://c.example/ads/preroll/a.mp4', 2e6)])).toBeNull();
    expect(scoreVideo({ url: 'not a url', kind: 'stream' })).toBeNull();
    expect(pickVideo([])).toBeNull();
    expect(pickVideo(undefined)).toBeNull();
  });
});

describe('opening one episode', () => {
  it('returns the video once it has turned up, and always closes the tab', async () => {
    const b = fakeBrowser((_url, ms) => (ms >= 1000 ? [stream('https://c.example/e1/master.m3u8')] : []));
    const found = await probeEpisode('https://s.example/e1', b.deps);
    expect(found?.url).toBe('https://c.example/e1/master.m3u8');
    expect(b.closed).toEqual([1]);
  });

  it('nudges the player when nothing starts by itself, and finds what the nudge starts', async () => {
    const b = fakeBrowser((_u, _ms, nudges) => (nudges >= 1 ? [stream('https://c.example/p/index.m3u8')] : []));
    const found = await probeEpisode('https://s.example/e2', b.deps);
    expect(found?.url).toContain('index.m3u8');
  });

  it('gives up with nothing for an episode that has no video, and closes the tab', async () => {
    const b = fakeBrowser(() => []);
    const found = await probeEpisode('https://s.example/empty', b.deps, { timeoutMs: 6000 });
    expect(found).toBeNull();
    expect(b.closed).toEqual([1]);
  });

  it('closes the tab even when the browser fails while it waits', async () => {
    const b = fakeBrowser(() => []);
    b.deps.found = async () => { throw new Error('tab crashed'); };
    await expect(probeEpisode('https://s.example/x', b.deps)).rejects.toThrow('tab crashed');
    expect(b.closed).toEqual([1]);
  });

  it('prefers the page\'s own stream over an advert that appeared first', async () => {
    const b = fakeBrowser((_u, ms) => [
      ...(ms >= 500 ? [stream('https://pubads.doubleclick.net/ad/index.m3u8', 1)] : []),
      ...(ms >= 1000 ? [stream('https://c.example/real/master.m3u8', 2)] : []),
    ]);
    expect((await probeEpisode('https://s.example/e', b.deps))?.url).toContain('real/master');
  });
});

describe('checking a whole list', () => {
  const eps = (n: number) => Array.from({ length: n }, (_, i) => ({ url: `https://s.example/e${i + 1}` }));
  // Episodes 1-6 have a video; 7-12 are empty, as on a series that is still being added to.
  const has = (url: string) => Number(url.split('/e')[1]) <= 6;

  it('tells the episodes with a video from the empty ones, all of them, in order', async () => {
    const b = fakeBrowser((url, ms) => (has(url) && ms >= 800 ? [stream(`${url}/master.m3u8`)] : []));
    const updates: [number, string][] = [];
    const results = await probeEpisodes(eps(12), b.deps, { concurrency: 3, timeoutMs: 6000, onUpdate: (i: number, s: { status: string }) => updates.push([i, s.status]) });
    expect(results.map((r: { status: string }) => r.status)).toEqual([...Array(6).fill('found'), ...Array(6).fill('none')]);
    expect(b.opened()).toBe(12);
    expect(b.closed).toHaveLength(12);
    expect(updates.filter(([, s]) => s === 'checking')).toHaveLength(12);
  });

  it('does not open an episode whose answer is already known, such as the one being watched', async () => {
    const b = fakeBrowser(() => []);
    const results = await probeEpisodes(eps(3), b.deps, { known: { 1: { url: 'https://c.example/known' } }, timeoutMs: 2000 });
    expect(results[1]).toEqual({ status: 'found', video: { url: 'https://c.example/known' } });
    expect(b.opened()).toBe(2);
  });

  it('reports a page that could not be opened as an error and carries on with the rest', async () => {
    const b = fakeBrowser(() => []);
    const real = b.deps.open;
    b.deps.open = async (url: string) => { if (url.endsWith('/e2')) throw new Error('blocked'); return real(url); };
    const results = await probeEpisodes(eps(3), b.deps, { timeoutMs: 2000 });
    expect(results.map((r: { status: string }) => r.status)).toEqual(['none', 'error', 'none']);
    expect(results[1].reason).toBe('blocked');
  });

  it('stops when asked, leaving the rest unchecked', async () => {
    const b = fakeBrowser(() => []);
    let stop = false;
    const results = await probeEpisodes(eps(8), b.deps, { concurrency: 1, timeoutMs: 1000, onUpdate: (_i: number, s: { status: string }) => { if (s.status === 'none') stop = true; }, shouldStop: () => stop });
    expect(results.filter((r: unknown) => r !== null)).toHaveLength(1);
  });

  it('never has more tabs open than it was told to', async () => {
    let open = 0;
    let peak = 0;
    const b = fakeBrowser(() => []);
    const realOpen = b.deps.open;
    const realClose = b.deps.close;
    b.deps.open = async (u: string) => { open++; peak = Math.max(peak, open); return realOpen(u); };
    b.deps.close = async (id: number) => { open--; return realClose(id); };
    await probeEpisodes(eps(10), b.deps, { concurrency: 2, timeoutMs: 1500 });
    expect(peak).toBeLessThanOrEqual(2);
  });
});
