import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ searchMusicRaw: vi.fn() }));

vi.mock('../src/main/services/ytmusic', () => ({ searchSongs: vi.fn(), searchMusicRaw: mocks.searchMusicRaw, MUSIC_FILTERS: { albums: 'ALB', featured: 'FEAT', community: 'COMM' } }));
vi.mock('../src/main/process', () => ({ runTool: vi.fn() }));
vi.mock('../src/main/tools', () => ({ tools: { require: () => 'yt-dlp', env: () => ({}) } }));
vi.mock('../src/main/log', () => ({ logger: () => ({ info: () => undefined, warn: () => undefined, debug: () => undefined, error: () => undefined }) }));

import { clearSearchMemory, searchAlbumsPart, searchPlaylistsPart } from '../src/main/search';

const BULLET = '•';
const shelfOf = (items: { title: string; meta: string; id: string; play?: string }[]) => ({
  contents: { tabbedSearchResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [{ musicShelfRenderer: { contents: items.map((i) => ({
    musicResponsiveListItemRenderer: {
      flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: i.title }] } } }, { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: i.meta }] } } }],
      navigationEndpoint: { browseEndpoint: { browseId: i.id } },
      ...(i.play ? { overlay: { musicItemThumbnailOverlayRenderer: { content: { musicPlayButtonRenderer: { playNavigationEndpoint: { watchPlaylistEndpoint: { playlistId: i.play } } } } } } } : {}),
    },
  })) } }] } } } }] } },
});

beforeEach(() => {
  clearSearchMemory();
  mocks.searchMusicRaw.mockReset();
});

describe('searching for albums and playlists', () => {
  it('asks YouTube Music for albums with the albums filter and returns them with their year and playlist address', async () => {
    mocks.searchMusicRaw.mockResolvedValue(shelfOf([{ title: 'Discovery', meta: `Album ${BULLET} Daft Punk ${BULLET} 2001`, id: 'MPREb_abcdefghij', play: 'OLAK5uy_discoveryxxxxxx' }]));
    const part = await searchAlbumsPart('daft punk');
    expect(mocks.searchMusicRaw).toHaveBeenCalledWith('daft punk', 'ALB');
    expect(part.failed).toBe(false);
    expect(part.hits[0]).toMatchObject({ kind: 'album', title: 'Discovery', year: '2001', url: 'https://music.youtube.com/playlist?list=OLAK5uy_discoveryxxxxxx' });
  });

  it('lists the curated playlists before the ones people made, without repeats', async () => {
    mocks.searchMusicRaw.mockImplementation(async (_q: string, filter: string) => (filter === 'FEAT'
      ? shelfOf([{ title: 'Official mix', meta: `YouTube Music ${BULLET} 40 songs`, id: 'VLRDCLAKofficialxxxx' }])
      : shelfOf([{ title: 'Official mix', meta: `Someone ${BULLET} 5 views`, id: 'VLRDCLAKofficialxxxx' }, { title: 'My mix', meta: `Someone ${BULLET} 5 views`, id: 'VLPLmymixxxxxxxx' }])));
    const part = await searchPlaylistsPart('daft punk');
    expect(part.hits.map((h) => h.title)).toEqual(['Official mix', 'My mix']);
    expect(part.hits[0]!.trackCount).toBe(40);
  });

  it('still answers when only one of the two playlist kinds can be reached, and fails only when neither can', async () => {
    mocks.searchMusicRaw.mockImplementation(async (_q: string, filter: string) => {
      if (filter === 'FEAT') throw new Error('offline');
      return shelfOf([{ title: 'Only mine', meta: 'Someone', id: 'VLPLonlymine1234' }]);
    });
    expect((await searchPlaylistsPart('a')).hits).toHaveLength(1);
    clearSearchMemory();
    mocks.searchMusicRaw.mockReset();
    mocks.searchMusicRaw.mockRejectedValue(new Error('offline'));
    expect(await searchPlaylistsPart('a')).toEqual({ hits: [], failed: true, more: false });
    expect(await searchAlbumsPart('a')).toEqual({ hits: [], failed: true, more: false });
  });

  it('remembers an answer, whatever the capitals or spacing', async () => {
    mocks.searchMusicRaw.mockResolvedValue(shelfOf([{ title: 'X', meta: `Album ${BULLET} Y ${BULLET} 2000`, id: 'MPREb_xxxxxxxxxx', play: 'OLAK5uy_xxxxxxxxxxxx' }]));
    await searchAlbumsPart('same');
    await searchAlbumsPart('  SAME ');
    expect(mocks.searchMusicRaw).toHaveBeenCalledTimes(1);
  });

  it('answers an empty search with nothing, without asking anyone', async () => {
    expect(await searchAlbumsPart('  ')).toEqual({ hits: [], failed: false, more: false });
    expect(mocks.searchMusicRaw).not.toHaveBeenCalled();
  });
});
