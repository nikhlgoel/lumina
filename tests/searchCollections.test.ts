import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { biggerArt, parseMusicCollections, queueFromEntries } from '@core/searchResults';

const BULLET = '•';

/** A cut-down YouTube Music search answer (the shape was taken from a real one): albums carry their playlist id behind the play button, playlists their browse id. */
const shelf = (items: unknown[]) => ({ contents: { tabbedSearchResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [{ musicShelfRenderer: { contents: items } }] } } } }] } } });
const run = (text: string) => ({ runs: [{ text }] });
const cols = (title: string, meta: string) => [{ musicResponsiveListItemFlexColumnRenderer: { text: run(title) } }, { musicResponsiveListItemFlexColumnRenderer: { text: run(meta) } }];
const album = (over: Record<string, unknown> = {}) => ({
  musicResponsiveListItemRenderer: {
    flexColumns: cols('Random Access Memories', `Album ${BULLET} Daft Punk ${BULLET} 2013`),
    navigationEndpoint: { browseEndpoint: { browseId: 'MPREb_K8qWMWVqXGi' } },
    overlay: { musicItemThumbnailOverlayRenderer: { content: { musicPlayButtonRenderer: { playNavigationEndpoint: { watchPlaylistEndpoint: { playlistId: 'OLAK5uy_kNhM2yaBTOVwrcZJepB1C9P3-n5_Sfy5c' } } } } } },
    thumbnail: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: 'https://lh3.googleusercontent.com/a=w60-h60-l90-rj', width: 60 }, { url: 'https://lh3.googleusercontent.com/a=w544-h544-l90-rj', width: 544 }] } } },
    ...over,
  },
});
const playlist = (title: string, meta: string, id: string) => ({
  musicResponsiveListItemRenderer: { flexColumns: cols(title, meta), navigationEndpoint: { browseEndpoint: { browseId: `VL${id}` } } },
});

describe('reading albums from a YouTube Music search', () => {
  it('turns an album into a result with its artist, year, type, picture, and the playlist address a download or a play needs', () => {
    const [hit] = parseMusicCollections(shelf([album()]), 'album');
    expect(hit).toMatchObject({
      source: 'ytmusic', kind: 'album', title: 'Random Access Memories', subtitle: 'Daft Punk', year: '2013', albumType: 'Album',
      url: 'https://music.youtube.com/playlist?list=OLAK5uy_kNhM2yaBTOVwrcZJepB1C9P3-n5_Sfy5c', thumbnail: 'https://lh3.googleusercontent.com/a=w544-h544-l90-rj',
    });
  });

  it('reads a single or an EP, and several artists, without taking the year for a name', () => {
    const [one] = parseMusicCollections(shelf([album({ flexColumns: cols('Title', `Single ${BULLET} Artist A, Artist B ${BULLET} 2020`) })]), 'album');
    expect(one).toMatchObject({ albumType: 'Single', subtitle: 'Artist A, Artist B', year: '2020' });
  });

  it('leaves out entries with no usable address or title, and repeats', () => {
    const noAddress = album({ overlay: undefined, navigationEndpoint: undefined });
    const untitled = album({ flexColumns: [] });
    expect(parseMusicCollections(shelf([noAddress, untitled, album(), album()]), 'album')).toHaveLength(1);
  });
});

describe('reading playlists from a YouTube Music search', () => {
  it('reads a curated playlist (with its song count) and one someone made (with its author, not its view count)', () => {
    const hits = parseMusicCollections(shelf([
      playlist('Presenting Daft Punk', `YouTube Music ${BULLET} 35 songs`, 'RDCLAK5uy_n20FRYQXNt1p1wS55Nj2r14IouO5weaYU'),
      playlist('daft punk', `Someone ${BULLET} 33 views`, 'PLGfGJFH5ltY8abc'),
    ]), 'playlist');
    expect(hits[0]).toMatchObject({ kind: 'playlist', title: 'Presenting Daft Punk', subtitle: 'YouTube Music', trackCount: 35, url: 'https://music.youtube.com/playlist?list=RDCLAK5uy_n20FRYQXNt1p1wS55Nj2r14IouO5weaYU' });
    expect(hits[1]).toMatchObject({ subtitle: 'Someone', trackCount: null, url: 'https://music.youtube.com/playlist?list=PLGfGJFH5ltY8abc' });
  });

  it('stops at the limit and gives nothing, without throwing, for an answer of another shape', () => {
    const many = Array.from({ length: 30 }, (_, i) => playlist(`P${i}`, 'Someone', `PL${String(i).padStart(12, '0')}`));
    expect(parseMusicCollections(shelf(many), 'playlist', 5)).toHaveLength(5);
    for (const odd of [null, undefined, 3, 'x', [], {}, { contents: 4 }]) expect(parseMusicCollections(odd, 'album')).toEqual([]);
  });

  it('never throws for any JSON at all', () => {
    fc.assert(fc.property(fc.jsonValue(), (v) => { expect(Array.isArray(parseMusicCollections(v, 'album'))).toBe(true); }), { numRuns: 400 });
  });
});

describe('the picture size', () => {
  it('asks Google for a bigger picture and leaves other addresses alone', () => {
    expect(biggerArt('https://lh3.googleusercontent.com/x=w60-h60-l90-rj', 400)).toBe('https://lh3.googleusercontent.com/x=w400-h400-l90-rj');
    expect(biggerArt('https://i.ytimg.com/vi/abc/mqdefault.jpg')).toBe('https://i.ytimg.com/vi/abc/mqdefault.jpg');
    expect(biggerArt(null)).toBeNull();
    expect(biggerArt(undefined)).toBeNull();
  });
});

describe('an album as a play queue', () => {
  const entry = (i: number, url: string) => ({ index: i, id: `id${i}`, title: `Track ${i}`, uploader: 'Daft Punk', durationSec: 200 + i, url, thumbnail: `https://img/${i}.jpg` });

  it('lists each track with its details and the link its stream will be worked out from, and has no stream yet', () => {
    const items = queueFromEntries([entry(1, 'https://music.youtube.com/watch?v=aaaaaaaaaaa'), entry(2, 'https://music.youtube.com/watch?v=bbbbbbbbbbb')], 'Random Access Memories');
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: 'audio', title: 'Track 1', artist: 'Daft Punk', album: 'Random Access Memories', durationSec: 201, src: '', lazyUrl: 'https://music.youtube.com/watch?v=aaaaaaaaaaa', artworkUrl: 'https://img/1.jpg' });
    expect(new Set(items.map((i) => i.id)).size).toBe(2);
  });

  it('leaves out entries with no link', () => {
    expect(queueFromEntries([entry(1, ''), entry(2, 'https://x/y')], null)).toHaveLength(1);
  });
});
