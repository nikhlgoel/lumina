import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { alreadyHave, baseNames, episodeFileBase, orderedEpisodes, safeName, seriesFolders } from '@core/episodes';

describe('episode file names', () => {
  it('names an episode after the show, season and number, with its title when there is one', () => {
    expect(episodeFileBase('The Divorce Insurance', 1, 3)).toBe('The Divorce Insurance - S01E03');
    expect(episodeFileBase('The Divorce Insurance', 1, 3, 'Rain')).toBe('The Divorce Insurance - S01E03 - Rain');
    expect(episodeFileBase('Long Show', 2, 120)).toBe('Long Show - S02E120');
  });

  it('leaves out a title that only repeats the number', () => {
    expect(episodeFileBase('Show', 1, 3, 'Episode 3')).toBe('Show - S01E03');
    expect(episodeFileBase('Show', 1, 3, 'Ep 3')).toBe('Show - S01E03');
    expect(episodeFileBase('Show', 1, 3, 'Episode 30')).toBe('Show - S01E03 - Episode 30');
  });

  it('removes what a Windows file name cannot hold, and cannot be empty or a device name', () => {
    expect(safeName('What? A "Show": part/2 *')).toBe('What A Show part 2');
    expect(safeName('  ..Name.. ')).toBe('Name');
    expect(safeName('con')).toBe('con_');
    expect(safeName('')).toBe('');
    expect(episodeFileBase('???', 1, 1)).toBe('Series - S01E01');
  });

  it('never makes a name with a path in it, whatever the page called the show', () => {
    fc.assert(fc.property(fc.string({ maxLength: 200 }), fc.string({ maxLength: 200 }), fc.integer({ min: 0, max: 999 }), fc.integer({ min: 0, max: 9999 }), (show, title, season, number) => {
      const name = episodeFileBase(show, season, number, title);
      expect(name).not.toMatch(/[\\/:*?"<>|%\u0000-\u001f]/);
      expect(name.length).toBeGreaterThan(0);
      expect(name.length).toBeLessThanOrEqual(200);
      for (const part of seriesFolders(show, season)) expect(part).not.toMatch(/[\\/:*?"<>|]/);
    }), { numRuns: 300 });
  });

  it('puts an episode in the show folder, then its season folder', () => {
    expect(seriesFolders('The Divorce Insurance', 1)).toEqual(['The Divorce Insurance', 'Season 01']);
    expect(seriesFolders('X', 0)).toEqual(['X', 'Specials']);
    expect(seriesFolders('', 12)).toEqual(['Series', 'Season 12']);
  });
});

describe('episodes already on disk', () => {
  it('recognises a finished episode under any extension, and not a half-finished one', () => {
    const have = baseNames(['The Show - S01E01.mkv', 'The Show - S01E02.mp4', 'The Show - S01E03.mkv.aria2', 'The Show - S01E03.mkv.part', 'notes.txt']);
    expect(alreadyHave(have, 'The Show', { season: 1, number: 1, title: '' })).toBe(true);
    expect(alreadyHave(have, 'The Show', { season: 1, number: 2, title: '' })).toBe(true);
    expect(alreadyHave(have, 'The Show', { season: 1, number: 3, title: '' })).toBe(false);
    expect(alreadyHave(have, 'the show', { season: 1, number: 1, title: '' })).toBe(true);
    expect(alreadyHave(have, 'The Show', { season: 2, number: 1, title: '' })).toBe(false);
  });
});

describe('ordering', () => {
  it('sorts by season then number and keeps one of a repeated episode', () => {
    const e = (season: number, number: number, title = '') => ({ season, number, title });
    expect(orderedEpisodes([e(2, 1), e(1, 3), e(1, 1), e(1, 3, 'dup'), e(1, 2)]).map((x) => `${x.season}x${x.number}`)).toEqual(['1x1', '1x2', '1x3', '2x1']);
  });
});

import { outputTemplate } from '@core/ytdlpArgs';
import type { DownloadOptions } from '@shared/types';

describe('the name an episode is saved under', () => {
  const opts = (over: Partial<DownloadOptions>) => ({ contentType: 'video', ...over }) as DownloadOptions;
  it('uses the name it was given, whatever the stream is called', () => {
    expect(outputTemplate(opts({ fileName: 'Show - S01E03' }), false, false, '%(title)s')).toBe('Show - S01E03.%(ext)s');
  });
  it('makes a percent sign in the name literal, so yt-dlp does not read it as a field', () => {
    expect(outputTemplate(opts({ fileName: '100% Show - S01E01' }), false, false, '%(title)s')).toBe('100%% Show - S01E01.%(ext)s');
  });
  it('is left out for a playlist and when there is no name', () => {
    expect(outputTemplate(opts({ fileName: 'X' }), true, false, '%(title)s')).toContain('%(playlist_title|Playlist)s');
    expect(outputTemplate(opts({}), false, false, '%(title)s')).toBe('%(title)s.%(ext)s');
  });
});
