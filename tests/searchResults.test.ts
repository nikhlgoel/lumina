import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { TtlCache, clockToSeconds, compactViews, formatCount, parseVideoSearch, searchKey, visibleHits, withoutDuplicates } from '@core/searchResults';
import type { SearchHit } from '@shared/types';

/** The shape of YouTube's own search answer, cut down to what matters (taken from a real one). */
const video = (over: Record<string, unknown> = {}) => ({
  videoRenderer: {
    videoId: 'LYGvsTUJFM8',
    title: { runs: [{ text: 'ANIMAL WILDLIFE DISCOVERY | ' }, { text: '60FPS 4K ULTRA HD' }] },
    lengthText: { simpleText: '30:31' },
    viewCountText: { simpleText: '5,808,378 views' },
    publishedTimeText: { simpleText: '8 months ago' },
    ownerText: { runs: [{ text: 'Scenic Scenes' }] },
    ownerBadges: [{ metadataBadgeRenderer: { style: 'BADGE_STYLE_TYPE_VERIFIED' } }],
    thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/vi/LYGvsTUJFM8/hq720.jpg?big', width: 720 }, { url: 'https://i.ytimg.com/vi/LYGvsTUJFM8/hq720.jpg?small', width: 360 }] },
    ...over,
  },
});
const answer = (items: unknown[]) => ({ contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: items } }] } } } } });

describe('reading YouTube’s search answer', () => {
  it('turns a video into a result with its title, channel, length, views, age and biggest picture', () => {
    const [hit] = parseVideoSearch(answer([video()]));
    expect(hit).toMatchObject({
      source: 'youtube', kind: 'video', url: 'https://www.youtube.com/watch?v=LYGvsTUJFM8', title: 'ANIMAL WILDLIFE DISCOVERY | 60FPS 4K ULTRA HD',
      subtitle: 'Scenic Scenes', durationSec: 1831, views: '5.8M views', published: '8 months ago', verified: true, thumbnail: 'https://i.ytimg.com/vi/LYGvsTUJFM8/hq720.jpg?big',
    });
  });

  it('leaves out what is not a video, repeats, and entries without a usable id or title', () => {
    const hits = parseVideoSearch(answer([{ adSlotRenderer: {} }, { channelRenderer: {} }, video(), video(), video({ videoId: 'short' }), video({ videoId: 'abcdefghijk', title: { runs: [] } }), video({ videoId: 'bbbbbbbbbbb' })]));
    expect(hits.map((h) => h.url.slice(-11))).toEqual(['LYGvsTUJFM8', 'bbbbbbbbbbb']);
  });

  it('keeps a result when a detail is missing (a live stream has no length, a new video no age)', () => {
    const [hit] = parseVideoSearch(answer([video({ lengthText: undefined, viewCountText: { simpleText: '1,204 watching' }, publishedTimeText: undefined, ownerBadges: undefined, thumbnail: undefined })]));
    expect(hit).toMatchObject({ durationSec: null, views: '1.2K watching', published: null, verified: false });
    expect(hit!.thumbnail).toBe('https://i.ytimg.com/vi/LYGvsTUJFM8/mqdefault.jpg');
  });

  it('stops at the limit', () => {
    const many = Array.from({ length: 30 }, (_, i) => video({ videoId: `v${String(i).padStart(10, '0')}` }));
    expect(parseVideoSearch(answer(many), 7)).toHaveLength(7);
  });

  it('gives nothing, and does not throw, for an answer of another shape', () => {
    for (const odd of [null, undefined, 5, 'x', [], {}, { contents: 1 }, { contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [null, 3, { itemSectionRenderer: { contents: [null, 'a'] } }] } } } } }]) {
      expect(parseVideoSearch(odd)).toEqual([]);
    }
  });

  it('never throws for any JSON at all', () => {
    fc.assert(fc.property(fc.jsonValue(), (v) => { expect(Array.isArray(parseVideoSearch(v))).toBe(true); }), { numRuns: 500 });
  });
});

describe('wording counts and times', () => {
  it('never prints a number of thousands or millions as 1000 of the unit below', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 5_000_000_000 }), (n) => {
      expect(/^(\d{1,3}|\d(\.\d)?[KMB]|\d{2,3}[KMB])$/.test(formatCount(n))).toBe(true);
      expect(formatCount(n)).not.toMatch(/^1000[KM]$/);
    }), { numRuns: 1000 });
  });

  it('shortens counts the way people read them', () => {
    expect([0, 7, 999, 1_000, 1_234, 9_950, 12_345, 999_999, 1_000_000, 5_808_378, 120_400_000, 3_400_000_000].map(formatCount))
      .toEqual(['0', '7', '999', '1K', '1.2K', '10K', '12K', '1M', '1M', '5.8M', '120M', '3.4B']);
  });

  it('words a view count from a number or from the source’s text', () => {
    expect(compactViews(5_808_378)).toBe('5.8M views');
    expect(compactViews(1)).toBe('1 view');
    expect(compactViews('5,808,378 views')).toBe('5.8M views');
    expect(compactViews('1 view')).toBe('1 view');
    expect(compactViews('1,204 watching')).toBe('1.2K watching');
    expect(compactViews('No views')).toBe('No views');
    expect(compactViews('2.1M views')).toBe('2.1M views');
  });

  it('says nothing for what is not a count', () => {
    for (const bad of [null, undefined, '', '   ', 'views', NaN, -3]) expect(compactViews(bad as string | number | null | undefined)).toBeNull();
  });

  it('never prints NaN, Infinity or undefined', () => {
    fc.assert(fc.property(fc.oneof(fc.string(), fc.double(), fc.integer()), (v) => {
      const out = compactViews(v);
      if (out !== null) expect(/NaN|Infinity|undefined/.test(out)).toBe(false);
    }), { numRuns: 1000 });
  });

  it('reads clock times', () => {
    expect([clockToSeconds('0:45'), clockToSeconds('5:11'), clockToSeconds('1:02:03'), clockToSeconds('LIVE'), clockToSeconds(''), clockToSeconds(undefined), clockToSeconds('1:2')]).toEqual([45, 311, 3723, null, null, null, null]);
  });
});

const hit = (id: string, kind: SearchHit['kind'] = 'video'): SearchHit => ({ source: kind === 'audio' ? 'ytmusic' : 'youtube', kind, url: `https://www.youtube.com/watch?v=${id}`, title: id, subtitle: '', durationSec: null, thumbnail: null });

describe('a track that is already a song is not also a video', () => {
  it('drops the video with the same id, whichever site the song link names', () => {
    const song = { ...hit('aaaaaaaaaaa', 'audio'), url: 'https://music.youtube.com/watch?v=aaaaaaaaaaa' };
    expect(withoutDuplicates([song], [hit('aaaaaaaaaaa'), hit('bbbbbbbbbbb')]).map((h) => h.title)).toEqual(['bbbbbbbbbbb']);
    expect(withoutDuplicates([], [hit('ccccccccccc')])).toHaveLength(1);
  });
});

describe('remembering recent searches', () => {
  it('returns what was stored until it is too old', () => {
    let t = 0;
    const cache = new TtlCache<string>(10, 1_000, () => t);
    cache.set('a', 'one');
    t = 999;
    expect(cache.get('a')).toBe('one');
    t = 1_001;
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('forgets the one used longest ago when it is full, and using an entry keeps it', () => {
    const cache = new TtlCache<number>(2, 1_000_000);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1); // a is now the most recently used
    cache.set('c', 3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
  });

  it('keeps one entry per key and never grows past its limit', () => {
    fc.assert(fc.property(fc.array(fc.tuple(fc.constantFrom('a', 'b', 'c', 'd', 'e'), fc.integer()), { maxLength: 60 }), (ops) => {
      const cache = new TtlCache<number>(3, 1_000_000);
      for (const [k, v] of ops) { cache.set(k, v); expect(cache.size).toBeLessThanOrEqual(3); }
    }), { numRuns: 300 });
  });

  it('treats the same search typed differently as one', () => {
    expect(searchKey('songs', '  Animal   Crossing ', 12)).toBe(searchKey('songs', 'animal crossing', 12));
    expect(searchKey('songs', 'a', 12)).not.toBe(searchKey('videos', 'a', 12));
    expect(searchKey('songs', 'a', 12)).not.toBe(searchKey('songs', 'a', 24));
  });
});

describe('how many rows a section shows', () => {
  it('shows the first few, says how many are hidden, and shows everything once expanded', () => {
    const hits = Array.from({ length: 12 }, (_, i) => i);
    expect(visibleHits(hits, false, 5)).toEqual({ shown: [0, 1, 2, 3, 4], hidden: 7 });
    expect(visibleHits(hits, true, 5)).toEqual({ shown: hits, hidden: 0 });
    expect(visibleHits([1, 2], false, 5)).toEqual({ shown: [1, 2], hidden: 0 });
    expect(visibleHits([], false, 5)).toEqual({ shown: [], hidden: 0 });
    expect(visibleHits(hits, false, 0).shown).toHaveLength(1);
  });
});
