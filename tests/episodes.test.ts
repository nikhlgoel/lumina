import { beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
// A classic browser script: importing it only defines globalThis.__luminaEpisodes.
import '../extension/episodes.js';

interface Ep { number: number; season: number; title: string; url: string; current: boolean; unavailable: boolean }
interface Found { show: string; episodes: Ep[]; synthetic: boolean }
interface Finder {
  group: (c: { href: string; text?: string; unavailable?: boolean }[], pageUrl: string, title?: string) => Found | null;
  synthesize: (rows: { text: string; unavailable?: boolean }[], pageUrl: string, title?: string) => Found | null;
  cleanTitle: (label: string, n: number) => string;
  showName: (title: string, host: string) => string;
  hasEpisodeSlot: (href: string) => boolean;
}
let f: Finder;
beforeAll(() => { f = (globalThis as unknown as { __luminaEpisodes: Finder }).__luminaEpisodes; });

const PAGE = 'https://streamex.hn/watch/tv/258764?s=1&e=3&server=vidy';
const row = (n: number, text = `Ep ${n} Episode ${n}`, base = 'https://streamex.hn/watch/tv/258764?s=1&e=') => ({ href: `${base}${n}&server=vidy`, text });
const noise = [
  { href: 'https://streamex.hn/', text: 'Home' },
  { href: 'https://streamex.hn/search', text: 'Search' },
  { href: 'https://streamex.hn/tv', text: 'TV Shows' },
  { href: 'https://streamex.hn/watch/tv/301?s=1&e=1', text: 'Another show' },
];

describe('finding the episode list on a series page', () => {
  it('reads the sidebar list, in order, marking the one being watched', () => {
    const found = f.group([...noise, ...[5, 1, 2, 4, 3, 6].map((n) => row(n))], PAGE, 'The Divorce Insurance | StreameX')!;
    expect(found.show).toBe('The Divorce Insurance');
    expect(found.episodes.map((e) => e.number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(found.episodes.filter((e) => e.current).map((e) => e.number)).toEqual([3]);
    expect(found.episodes[0]).toMatchObject({ season: 1, title: '', url: 'https://streamex.hn/watch/tv/258764?s=1&e=1&server=vidy' });
    expect(found.synthetic).toBe(false);
  });

  it('takes the label of the episode row when a server button links to the very same address', () => {
    const button = { href: 'https://streamex.hn/watch/tv/258764?s=1&e=3&server=vidy', text: 'vidy' };
    const found = f.group([button, ...[1, 2, 3, 4].map((n) => row(n))], PAGE)!;
    expect(found.episodes.find((e) => e.number === 3)!.title).toBe('');
    expect(found.episodes).toHaveLength(4);
  });

  it('keeps the whole list when later episodes have no title yet, and keeps real titles', () => {
    const found = f.group([row(1, 'Ep 1 The Beginning'), row(2, 'Ep 2'), row(3, '3. Rain')], PAGE)!;
    expect(found.episodes.map((e) => e.title)).toEqual(['The Beginning', '', 'Rain']);
  });

  it('reads an address that spells the episode in its path', () => {
    const base = 'https://shows.example/the-show/episode-';
    const found = f.group([1, 2, 3, 4].map((n) => ({ href: `${base}${n}`, text: `Episode ${n}` })), `${base}2`)!;
    expect(found.episodes.map((e) => e.number)).toEqual([1, 2, 3, 4]);
    expect(found.episodes.find((e) => e.current)?.number).toBe(2);
    expect(f.group([1, 2, 3].map((n) => ({ href: `https://x.example/watch/s1e${n}`, text: '' })), 'https://x.example/watch/s1e1')?.episodes).toHaveLength(3);
  });

  it('numbers by season when a page lists several, without mixing them up', () => {
    const rows = [[1, 1], [1, 2], [1, 3], [2, 1], [2, 2]].map(([s, e]) => ({ href: `https://a.example/w/9?s=${s}&e=${e}`, text: `Episode ${e}` }));
    const found = f.group(rows, 'https://a.example/w/9?s=2&e=1')!;
    expect(found.episodes.map((e) => `${e.season}x${e.number}`)).toEqual(['1x1', '1x2', '1x3', '2x1', '2x2']);
    expect(found.episodes.filter((e) => e.current).map((e) => `${e.season}x${e.number}`)).toEqual(['2x1']);
  });

  it('notes the rows a page itself marks as not ready, and still lists them', () => {
    const found = f.group([row(1), row(2), { ...row(3, 'Ep 3 Coming soon') }, { ...row(4), unavailable: true }], PAGE)!;
    expect(found.episodes.map((e) => e.unavailable)).toEqual([false, false, true, true]);
  });

  it('is not fooled by pages of results, lists of ids, or the same page in several servers', () => {
    const pages = [1, 2, 3, 4, 5].map((n) => ({ href: `https://x.example/browse?page=${n}`, text: String(n) }));
    expect(f.group(pages, 'https://x.example/browse?page=1')).toBeNull();
    const ids = [258764, 258765, 258766].map((n) => ({ href: `https://x.example/watch/tv/${n}`, text: `Show ${n}` }));
    expect(f.group(ids, 'https://x.example/watch/tv/258764')).toBeNull();
    const servers = ['vidy', 'bingr', 'core', 'zoryva'].map((s) => ({ href: `https://streamex.hn/watch/tv/258764?s=1&e=3&server=${s}`, text: s }));
    expect(f.group(servers, PAGE)).toBeNull();
    expect(f.group([row(1)], PAGE)).toBeNull();
  });

  it('says nothing for a page with no list', () => {
    expect(f.group(noise, 'https://streamex.hn/')).toBeNull();
    expect(f.group([], PAGE)).toBeNull();
  });

  it('takes the list the page is on when there are two (recommendations beside it)', () => {
    const other = [1, 2, 3, 4, 5, 6, 7].map((n) => row(n, `Ep ${n}`, 'https://streamex.hn/watch/tv/999?s=1&e='));
    const found = f.group([...other, ...[1, 2, 3].map((n) => row(n))], PAGE)!;
    expect(found.episodes).toHaveLength(3);
    expect(found.episodes[0]!.url).toContain('/258764');
  });

  it('never throws, and never returns a list of fewer than two', () => {
    const link = fc.record({ href: fc.oneof(fc.webUrl(), fc.string({ maxLength: 60 })), text: fc.string({ maxLength: 40 }) });
    fc.assert(fc.property(fc.array(link, { maxLength: 80 }), fc.webUrl(), (links, page) => {
      const out = f.group(links, page, 'x | y');
      if (out) expect(out.episodes.length).toBeGreaterThanOrEqual(2);
    }), { numRuns: 300 });
  });
});

describe('rows that are not links', () => {
  it('builds each address from the one being read, when it counts episodes', () => {
    const found = f.synthesize([1, 2, 3, 4].map((n) => ({ text: `Ep ${n}` })), PAGE, 'The Divorce Insurance | StreameX')!;
    expect(found.synthetic).toBe(true);
    expect(found.episodes.map((e) => e.url)).toEqual([1, 2, 3, 4].map((n) => `https://streamex.hn/watch/tv/258764?s=1&e=${n}&server=vidy`));
    expect(found.episodes.find((e) => e.current)?.number).toBe(3);
  });

  it('gives up when the address says nothing about episodes, or there are too few rows', () => {
    expect(f.synthesize([1, 2, 3].map((n) => ({ text: `Ep ${n}` })), 'https://x.example/watch/abc')).toBeNull();
    expect(f.synthesize([{ text: 'Ep 1' }, { text: 'Ep 2' }], PAGE)).toBeNull();
  });
});

describe('names', () => {
  it('drops the repeated number from a row label', () => {
    expect(f.cleanTitle('Ep 3 ▶ Episode 3', 3)).toBe('');
    expect(f.cleanTitle('Episode 12: The Long Night', 12)).toBe('The Long Night');
    expect(f.cleanTitle('7 - Rain', 7)).toBe('Rain');
    expect(f.cleanTitle('Ep 3', 3)).toBe('');
  });

  it('names the show without the site', () => {
    expect(f.showName('The Divorce Insurance | StreameX', 'www.streamex.hn')).toBe('The Divorce Insurance');
    expect(f.showName('Watch Mary Berry Love - S1 E2 - Example.tv', 'example.tv')).toBe('Mary Berry Love');
    expect(f.showName('', 'streamex.hn')).toBe('streamex.hn');
  });
});

describe('which pages can have rows that are not links', () => {
  it('only a page whose own address counts episodes', () => {
    expect(f.hasEpisodeSlot('https://streamex.hn/watch/tv/258764?s=1&e=3&server=vidy')).toBe(true);
    expect(f.hasEpisodeSlot('https://shows.example/the-show/episode-4')).toBe(true);
    expect(f.hasEpisodeSlot('https://x.example/watch/s2e7')).toBe(true);
    expect(f.hasEpisodeSlot('https://x.example/browse?page=2')).toBe(false);
    expect(f.hasEpisodeSlot('https://x.example/post/123456')).toBe(false);
    expect(f.hasEpisodeSlot('https://x.example/')).toBe(false);
    expect(f.hasEpisodeSlot('not an address')).toBe(false);
  });
});
