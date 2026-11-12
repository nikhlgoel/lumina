import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  searchSongs: vi.fn(),
  runTool: vi.fn(),
}));

vi.mock('../src/main/services/ytmusic', () => ({ searchSongs: mocks.searchSongs }));
vi.mock('../src/main/process', () => ({ runTool: mocks.runTool }));
vi.mock('../src/main/tools', () => ({ tools: { require: () => 'yt-dlp', env: () => ({}) } }));
vi.mock('../src/main/log', () => ({ logger: () => ({ info: () => undefined, warn: () => undefined, debug: () => undefined, error: () => undefined }) }));

import { clearSearchMemory, searchMulti, searchSongsPart, searchVideosPart } from '../src/main/search';

const id = (n: number) => `v${String(n).padStart(10, '0')}`;
const renderer = (n: number) => ({
  videoRenderer: {
    videoId: id(n), title: { runs: [{ text: `Video ${n}` }] }, lengthText: { simpleText: '3:00' }, viewCountText: { simpleText: '1,500,000 views' },
    publishedTimeText: { simpleText: '2 years ago' }, ownerText: { runs: [{ text: `Channel ${n}` }] }, thumbnail: { thumbnails: [{ url: `https://i.ytimg.com/vi/${id(n)}/hq720.jpg`, width: 720 }] },
  },
});
const answer = (count: number, from = 1) => ({ contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: Array.from({ length: count }, (_, i) => renderer(from + i)) } }] } } } } });
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const flat = (n: number) => JSON.stringify({ entries: Array.from({ length: n }, (_, i) => ({ id: id(100 + i), title: `Slow ${i}`, uploader: `Up ${i}`, duration: 61, view_count: 2_300_000, channel_is_verified: i === 0 })) });

beforeEach(() => {
  clearSearchMemory();
  fetchMock.mockReset();
  mocks.searchSongs.mockReset();
  mocks.runTool.mockReset();
  delete process.env.LUMINA_SEARCH_NO_FAST;
});

describe('searching for videos', () => {
  it('asks YouTube’s own search first, and does not start yt-dlp when that answers', async () => {
    fetchMock.mockResolvedValue(ok(answer(5)));
    const part = await searchVideosPart('animal', 12);
    expect(part.failed).toBe(false);
    expect(part.hits).toHaveLength(5);
    expect(part.hits[0]).toMatchObject({ title: 'Video 1', subtitle: 'Channel 1', views: '1.5M views', published: '2 years ago', durationSec: 180 });
    expect(mocks.runTool).not.toHaveBeenCalled();
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string) as { query: string; params: string };
    expect(body).toMatchObject({ query: 'animal', params: 'EgIQAQ%3D%3D' }); // videos only
  });

  it('falls back to yt-dlp when the quick road fails or has no videos in its answer', async () => {
    mocks.runTool.mockResolvedValue({ code: 0, stdout: flat(4), stderr: '' });
    for (const quick of [() => Promise.reject(new Error('offline')), () => Promise.resolve({ ok: false, status: 429, json: async () => ({}) }), () => Promise.resolve(ok({ contents: {} }))]) {
      clearSearchMemory();
      fetchMock.mockImplementationOnce(quick);
      const part = await searchVideosPart('animal', 12);
      expect(part.failed).toBe(false);
      expect(part.hits[0]).toMatchObject({ title: 'Slow 0', subtitle: 'Up 0', views: '2.3M views', verified: true, durationSec: 61 });
    }
    expect(mocks.runTool).toHaveBeenCalledTimes(3);
  });

  it('goes straight to yt-dlp for more than one page of results, up to forty', async () => {
    mocks.runTool.mockResolvedValue({ code: 0, stdout: flat(30), stderr: '' });
    const part = await searchVideosPart('animal', 999);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.runTool.mock.calls[0]![1]).toContain('ytsearch40:animal');
    expect(part.hits).toHaveLength(30);
  });

  it('says it failed, and does not remember that, when neither road works', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    mocks.runTool.mockResolvedValue({ code: 1, stdout: '', stderr: 'no network' });
    expect(await searchVideosPart('animal')).toEqual({ hits: [], failed: true, more: false });
    fetchMock.mockResolvedValue(ok(answer(3)));
    const again = await searchVideosPart('animal');
    expect(again.failed).toBe(false); // asked again, since the failure was not kept
    expect(again.hits).toHaveLength(3);
  });

  it('keeps an answer for later: the same search in other capitals or spacing does not ask again', async () => {
    fetchMock.mockResolvedValue(ok(answer(3)));
    await searchVideosPart('Animal  Crossing');
    await searchVideosPart(' animal crossing ');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await searchVideosPart('animal crossing', 20); // a different size is a different question
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shares one request between searches made at the same moment', async () => {
    let release: (v: unknown) => void = () => undefined;
    fetchMock.mockReturnValue(new Promise((r) => { release = r; }));
    const first = searchVideosPart('animal');
    const second = searchVideosPart('animal');
    release(ok(answer(2)));
    expect((await first).hits).toHaveLength(2);
    expect((await second).hits).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('can be told to skip the quick road (for testing the fallback in the real app)', async () => {
    process.env.LUMINA_SEARCH_NO_FAST = '1';
    mocks.runTool.mockResolvedValue({ code: 0, stdout: flat(2), stderr: '' });
    await searchVideosPart('animal');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers an empty search with nothing, without asking anyone', async () => {
    expect(await searchVideosPart('   ')).toEqual({ hits: [], failed: false, more: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says more may be available when the answer filled what was asked for', async () => {
    fetchMock.mockResolvedValue(ok(answer(12)));
    expect((await searchVideosPart('a', 12)).more).toBe(true);
    clearSearchMemory();
    fetchMock.mockResolvedValue(ok(answer(7)));
    expect((await searchVideosPart('a', 12)).more).toBe(false);
  });
});

const song = (n: number) => ({ videoId: id(n), title: `Song ${n}`, artists: `Artist ${n}`, album: n % 2 ? `Album ${n}` : null, durationSec: 200 + n, thumbnail: n === 1 ? 'https://lh3.googleusercontent.com/x=w400-h400-l90-rj' : null });

describe('searching for songs', () => {
  it('returns the songs with artist, album, length and a picture, and says when there are more', async () => {
    mocks.searchSongs.mockResolvedValue(Array.from({ length: 15 }, (_, i) => song(i + 1)));
    const part = await searchSongsPart('animal', 10);
    expect(part.hits).toHaveLength(10);
    expect(part.more).toBe(true);
    expect(part.hits[0]).toMatchObject({ kind: 'audio', source: 'ytmusic', title: 'Song 1', subtitle: 'Artist 1', album: 'Album 1', durationSec: 201, thumbnail: 'https://lh3.googleusercontent.com/x=w400-h400-l90-rj' });
    expect(part.hits[1]!.thumbnail).toBe(`https://i.ytimg.com/vi/${id(2)}/mqdefault.jpg`); // no album picture: the video's own
    expect(part.hits[0]!.url).toBe(`https://music.youtube.com/watch?v=${id(1)}`);
  });

  it('says it failed, and does not remember that, when YouTube Music cannot be reached', async () => {
    mocks.searchSongs.mockRejectedValueOnce(new Error('offline'));
    expect(await searchSongsPart('animal')).toEqual({ hits: [], failed: true, more: false });
    mocks.searchSongs.mockResolvedValueOnce([song(1)]);
    expect((await searchSongsPart('animal')).hits).toHaveLength(1);
  });

  it('does not ask twice for the same search', async () => {
    mocks.searchSongs.mockResolvedValue([song(1)]);
    await searchSongsPart('animal');
    await searchSongsPart('ANIMAL ');
    expect(mocks.searchSongs).toHaveBeenCalledTimes(1);
  });
});

describe('both together', () => {
  it('does not list a track as a video when it is already a song, and survives one source failing', async () => {
    mocks.searchSongs.mockResolvedValue([song(1)]);
    fetchMock.mockResolvedValue(ok(answer(3))); // Video 1 has the same id as Song 1
    const both = await searchMulti('animal');
    expect(both.songs).toHaveLength(1);
    expect(both.videos.map((v) => v.title)).toEqual(['Video 2', 'Video 3']);

    clearSearchMemory();
    mocks.searchSongs.mockRejectedValue(new Error('offline'));
    const half = await searchMulti('animal');
    expect(half.songs).toEqual([]);
    expect(half.videos).toHaveLength(3);
  });
});
