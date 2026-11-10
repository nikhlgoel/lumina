import { describe, expect, it } from 'vitest';
import { archiveName, countMedia, playlistFolder, skippedEverythingWrongly } from '@core/archiveScope';

describe('finding the folder a playlist went to', () => {
  const dirs = (names: string[]) => () => names.map((name) => ({ name, isDir: true }));

  it('finds the folder named like the playlist', () => {
    expect(playlistFolder('D:/Music', 'Blender Releases', dirs(['Other', 'Blender Releases']))).toBe('D:/Music/Blender Releases');
  });

  it('matches through the look-alike characters yt-dlp writes for ones Windows forbids', () => {
    expect(playlistFolder('D:/Music', 'Mix: A/B?', dirs(['Mix： A⧸B？']))).toBe('D:/Music/Mix： A⧸B？');
  });

  it('is null when there is no such folder (it was deleted, or never made)', () => {
    expect(playlistFolder('D:/Music', 'Blender Releases', dirs(['Other']))).toBeNull();
    expect(playlistFolder('D:/Music', '', dirs(['Other']))).toBeNull();
  });

  it('does not take a file for the folder', () => {
    expect(playlistFolder('D:/Music', 'Mix', () => [{ name: 'Mix', isDir: false }])).toBeNull();
  });
});

describe('what "already downloaded" is allowed to mean', () => {
  it('keeps one memory per kind of download, so a video never blocks the same song as an MP3', () => {
    expect(archiveName('audio', 'D:/Music')).not.toBe(archiveName('video', 'D:/Music'));
  });

  it('keeps one memory per folder, so another folder does not inherit this one\'s history', () => {
    expect(archiveName('audio', 'D:/Music')).not.toBe(archiveName('audio', 'D:/Other'));
  });

  it('gives the same name for the same folder however it is written', () => {
    expect(archiveName('audio', 'D:\\Music\\')).toBe(archiveName('audio', 'd:/music'));
  });

  it('is a plain file name', () => {
    expect(archiveName('audio', 'D:/Music')).toMatch(/^download-archive-audio-[0-9a-f]{8}\.txt$/);
  });
});

describe('a playlist that skipped everything', () => {
  it('is not believed when the folder holds fewer files than songs were asked for (the owner\'s case: files gone, list remembered)', () => {
    expect(skippedEverythingWrongly(3, 0)).toBe(true);
    expect(skippedEverythingWrongly(8, 5)).toBe(true);
  });

  it('is believed when the files are there', () => {
    expect(skippedEverythingWrongly(3, 3)).toBe(false);
    expect(skippedEverythingWrongly(3, 40)).toBe(false);
  });

  it('is nothing to doubt when nothing was asked for', () => {
    expect(skippedEverythingWrongly(0, 0)).toBe(false);
  });
});

describe('counting what is really in the folder', () => {
  const tree: Record<string, { name: string; isDir: boolean }[]> = {
    'D:/Music': [{ name: 'Playlist', isDir: true }, { name: 'notes.txt', isDir: false }, { name: 'a.mp3', isDir: false }],
    'D:/Music/Playlist': [{ name: '01 - x.mp3', isDir: false }, { name: '02 - y.FLAC', isDir: false }, { name: 'cover.jpg', isDir: false }, { name: 'list.m3u8', isDir: false }],
  };
  const list = (d: string) => tree[d] ?? [];

  it('counts media files below the folder and nothing else', () => {
    expect(countMedia('D:/Music', list)).toBe(3);
  });

  it('is zero for a folder that is not there', () => {
    expect(countMedia('D:/Nowhere', list)).toBe(0);
  });

  it('stops at the limit so a huge library is not walked for ever', () => {
    expect(countMedia('D:/Music', list, 2)).toBe(2);
  });
});
