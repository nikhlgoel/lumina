import { describe, it, expect } from 'vitest';
import {
  PORTABLE_DIR, buildPlaylist, describePlan, fingerprint, planExport, planImport, portableTargetFor,
  safeSegment, type PortableItem,
} from '@core/portable';

const item = (p: Partial<PortableItem> & { path: string }): PortableItem => ({
  kind: 'audio', title: 'Title', artist: 'Artist', album: 'Album', trackNo: null, sizeBytes: 100, ...p,
});

describe('safeSegment', () => {
  it('strips characters FAT32 and Windows reject', () => {
    expect(safeSegment('AC/DC: Live? <best>')).toBe('AC DC Live best');
    expect(safeSegment('a|b*c"d')).toBe('a b c d');
  });

  it('drops trailing dots and spaces, which Windows silently mangles', () => {
    expect(safeSegment('Album name. ')).toBe('Album name');
    expect(safeSegment('...')).toBe('Untitled');
  });

  it('dodges reserved device names', () => {
    expect(safeSegment('CON')).toBe('_CON');
    expect(safeSegment('com4')).toBe('_com4');
    expect(safeSegment('console')).toBe('console');
  });

  it('never returns an empty segment', () => {
    expect(safeSegment('')).toBe('Untitled');
    expect(safeSegment('///')).toBe('Untitled');
  });

  it('caps the length without leaving a trailing dot', () => {
    expect(safeSegment('x'.repeat(200), 20)).toHaveLength(20);
    expect(safeSegment(`${'x'.repeat(19)}.yyyy`, 20)).toBe('x'.repeat(19));
  });

  it('strips control characters and newlines from a tag', () => {
    expect(safeSegment('Song\u0001\nName')).toBe('Song Name');
  });
});

describe('portableTargetFor', () => {
  it('files music as Artist/Album/Track Title', () => {
    expect(portableTargetFor(item({ path: 'C:\\m\\a.flac', artist: 'Daft Punk', album: 'RAM', title: 'Get Lucky', trackNo: 8 })))
      .toBe(`${PORTABLE_DIR}/Music/Daft Punk/RAM/08 Get Lucky.flac`);
  });

  it('omits the track number when there isn’t one', () => {
    expect(portableTargetFor(item({ path: '/m/a.mp3', trackNo: null }))).toBe(`${PORTABLE_DIR}/Music/Artist/Album/Title.mp3`);
  });

  it('fills in placeholders for untagged music', () => {
    expect(portableTargetFor(item({ path: '/m/a.mp3', artist: null, album: null })))
      .toBe(`${PORTABLE_DIR}/Music/Unknown artist/Unknown album/Title.mp3`);
  });

  it('puts video flat under Videos', () => {
    expect(portableTargetFor(item({ path: '/v/x.mkv', kind: 'video', title: 'Big Buck Bunny' })))
      .toBe(`${PORTABLE_DIR}/Videos/Big Buck Bunny.mkv`);
  });

  it('keeps the extension and copes with a file that has none', () => {
    expect(portableTargetFor(item({ path: '/v/x', kind: 'video', title: 'T' }))).toBe(`${PORTABLE_DIR}/Videos/T`);
  });
});

describe('planExport', () => {
  it('plans every item and totals the bytes', () => {
    const plan = planExport([
      item({ path: '/a.mp3', title: 'A', sizeBytes: 10 }),
      item({ path: '/b.mp3', title: 'B', sizeBytes: 20 }),
    ]);
    expect(plan.entries).toHaveLength(2);
    expect(plan.totalBytes).toBe(30);
    expect(plan.skipped).toBe(0);
  });

  it('skips a file already on the drive at the same size', () => {
    const existing = { [`${PORTABLE_DIR}/Music/Artist/Album/A.mp3`]: 10 };
    const plan = planExport([item({ path: '/a.mp3', title: 'A', sizeBytes: 10 })], existing);
    expect(plan.entries).toHaveLength(0);
    expect(plan.skipped).toBe(1);
    expect(plan.totalBytes).toBe(0);
  });

  it('re-copies when the size on the drive differs (a truncated earlier copy)', () => {
    const existing = { [`${PORTABLE_DIR}/Music/Artist/Album/A.mp3`]: 5 };
    expect(planExport([item({ path: '/a.mp3', title: 'A', sizeBytes: 10 })], existing).entries).toHaveLength(1);
  });

  it('never lets two different songs overwrite each other after sanitising', () => {
    const plan = planExport([
      item({ path: '/one.mp3', title: 'A/B' }),
      item({ path: '/two.mp3', title: 'A?B' }),
    ]);
    const targets = plan.entries.map((e) => e.target);
    expect(new Set(targets).size).toBe(2);
    expect(targets[1]).toContain('(2)');
    expect(targets[1]!.endsWith('.mp3')).toBe(true);
  });

  it('handles an empty selection', () => {
    expect(planExport([])).toEqual({ entries: [], skipped: 0, totalBytes: 0 });
  });
});

describe('planImport', () => {
  it('returns only the drive files the library doesn’t already have', () => {
    const have = new Set([fingerprint('Song.mp3', 10)]);
    const found = planImport(
      [{ path: 'E:/x/Song.mp3', name: 'Song.mp3', sizeBytes: 10 }, { path: 'E:/x/New.mp3', name: 'New.mp3', sizeBytes: 20 }],
      have,
    );
    expect(found.map((f) => f.name)).toEqual(['New.mp3']);
  });

  it('matches names case-insensitively but treats a different size as a different file', () => {
    const have = new Set([fingerprint('song.mp3', 10)]);
    expect(planImport([{ path: 'E:/Song.MP3', name: 'Song.MP3', sizeBytes: 10 }], have)).toHaveLength(0);
    expect(planImport([{ path: 'E:/Song.MP3', name: 'Song.MP3', sizeBytes: 11 }], have)).toHaveLength(1);
  });
});

describe('buildPlaylist', () => {
  it('writes an m3u8 other players can read, with Windows separators and CRLF', () => {
    const text = buildPlaylist('All music', ['LuminaMedia/Music/A/B/1.mp3']);
    expect(text.startsWith('#EXTM3U\r\n')).toBe(true);
    expect(text).toContain('#PLAYLIST:All music');
    expect(text).toContain('LuminaMedia\\Music\\A\\B\\1.mp3');
    expect(text.endsWith('\r\n')).toBe(true);
  });

  it('still produces a valid header for an empty drive', () => {
    expect(buildPlaylist('Empty', [])).toBe('#EXTM3U\r\n#PLAYLIST:Empty\r\n');
  });
});

describe('describePlan', () => {
  it('says what will happen, including when there is nothing to do', () => {
    expect(describePlan({ entries: [], skipped: 0, totalBytes: 0 })).toBe('Nothing to copy.');
    expect(describePlan({ entries: [], skipped: 3, totalBytes: 0 })).toBe('Everything is already on the drive.');
    expect(describePlan({ entries: [{ source: 'a', target: 'b', sizeBytes: 1 }], skipped: 0, totalBytes: 1 })).toBe('1 file to copy');
    expect(describePlan({ entries: [{ source: 'a', target: 'b', sizeBytes: 1 }, { source: 'c', target: 'd', sizeBytes: 1 }], skipped: 2, totalBytes: 2 }))
      .toBe('2 files to copy, 2 already there');
  });
});
