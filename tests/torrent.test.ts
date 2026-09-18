import { describe, it, expect } from 'vitest';
import {
  commonRoot, fromSelectFileSpec, selectedBytes, toSelectFileSpec, toTorrentFiles, type Aria2FileRow,
} from '@core/torrentFiles';
import { HISTORY_LENGTH, niceMax, pushSample, shareRatio, sparklineArea, sparklinePath } from '@core/speedHistory';
import { isDiskCacheFailure } from '@core/progress';

const row = (index: number, path: string, length: number, completed = 0, selected = true): Aria2FileRow =>
  ({ index: String(index), path, length: String(length), completedLength: String(completed), selected: String(selected) });

describe('commonRoot', () => {
  it('finds the folder every file shares', () => {
    expect(commonRoot(['Pack/a.mkv', 'Pack/subs/b.srt'])).toBe('Pack');
    expect(commonRoot(['A/B/one', 'A/B/two'])).toBe('A/B');
  });

  it('returns nothing when the files do not share a folder', () => {
    expect(commonRoot(['a.mkv', 'b.mkv'])).toBe('');
    expect(commonRoot(['X/a', 'Y/a'])).toBe('');
  });

  it('never swallows the file name itself', () => {
    expect(commonRoot(['A/same', 'A/same'])).toBe('A');
  });

  it('returns nothing for a single file', () => {
    expect(commonRoot(['Only/file.mkv'])).toBe('');
    expect(commonRoot([])).toBe('');
  });

  it('treats backslashes as separators too', () => {
    expect(commonRoot(['Pack\\a.mkv', 'Pack\\b.mkv'].map((p) => p.replace(/\\/g, '/')))).toBe('Pack');
  });
});

describe('toTorrentFiles', () => {
  it('strips the shared folder and computes each percent', () => {
    const files = toTorrentFiles([row(1, '/dl/Pack/movie.mkv', 100, 50), row(2, '/dl/Pack/subs/en.srt', 10, 10)]);
    expect(files[0]).toMatchObject({ index: 1, name: 'movie.mkv', sizeBytes: 100, downloadedBytes: 50, percent: 50, selected: true });
    expect(files[1]!.name).toBe('subs/en.srt');
  });

  it('keeps just the file name for a single-file torrent', () => {
    expect(toTorrentFiles([row(1, '/downloads/Big Buck Bunny.mp4', 10)])[0]!.name).toBe('Big Buck Bunny.mp4');
  });

  it('reads the selected flag', () => {
    const files = toTorrentFiles([row(1, 'a', 1, 0, true), row(2, 'b', 1, 0, false)]);
    expect(files.map((f) => f.selected)).toEqual([true, false]);
  });

  it('survives zero-length files and junk numbers without NaN', () => {
    const files = toTorrentFiles([{ index: 'x', path: 'p', length: '0', completedLength: 'nope', selected: 'true' }]);
    expect(files[0]!.percent).toBe(0);
    expect(files[0]!.index).toBe(1);
    expect(files[0]!.downloadedBytes).toBe(0);
  });

  it('never reports more downloaded than the file’s size', () => {
    expect(toTorrentFiles([row(1, 'a', 100, 500)])[0]).toMatchObject({ downloadedBytes: 100, percent: 100 });
  });
});

describe('toSelectFileSpec', () => {
  it('collapses runs the way aria2 expects', () => {
    expect(toSelectFileSpec([1, 2, 3, 7, 9, 10])).toBe('1-3,7,9-10');
    expect(toSelectFileSpec([5])).toBe('5');
  });

  it('sorts and de-duplicates', () => {
    expect(toSelectFileSpec([3, 1, 2, 2])).toBe('1-3');
  });

  it('drops invalid indices and returns empty for none', () => {
    expect(toSelectFileSpec([0, -1, 1.5])).toBe('');
    expect(toSelectFileSpec([])).toBe('');
  });

  it('round-trips through fromSelectFileSpec', () => {
    const indices = [1, 2, 3, 8, 11, 12, 13];
    expect(fromSelectFileSpec(toSelectFileSpec(indices))).toEqual(indices);
  });
});

describe('fromSelectFileSpec', () => {
  it('reads singles and ranges, ignoring junk', () => {
    expect(fromSelectFileSpec('1,3-5, 9 ,,bad')).toEqual([1, 3, 4, 5, 9]);
    expect(fromSelectFileSpec('')).toEqual([]);
  });

  it('refuses an absurd range rather than allocating forever', () => {
    expect(fromSelectFileSpec('1-999999999')).toEqual([]);
    expect(fromSelectFileSpec('5-1')).toEqual([]);
  });
});

describe('selectedBytes', () => {
  const files = toTorrentFiles([row(1, 'a', 100, 40), row(2, 'b', 200, 200), row(3, 'c', 50, 0)]);

  it('totals size and what is still missing for the chosen files', () => {
    expect(selectedBytes(files, [1, 3])).toEqual({ total: 150, remaining: 110 });
  });

  it('is zero for an empty selection and ignores unknown indices', () => {
    expect(selectedBytes(files, [])).toEqual({ total: 0, remaining: 0 });
    expect(selectedBytes(files, [99])).toEqual({ total: 0, remaining: 0 });
  });

  it('counts a finished file as having nothing remaining', () => {
    expect(selectedBytes(files, [2])).toEqual({ total: 200, remaining: 0 });
  });
});

describe('pushSample', () => {
  it('appends, newest last', () => {
    const h = pushSample(pushSample([], { down: 1, up: 0 }), { down: 2, up: 0 });
    expect(h.map((s) => s.down)).toEqual([1, 2]);
  });

  it('drops the oldest past the limit', () => {
    let h: { down: number; up: number }[] = [];
    for (let i = 0; i < HISTORY_LENGTH + 10; i++) h = pushSample(h, { down: i, up: 0 });
    expect(h).toHaveLength(HISTORY_LENGTH);
    expect(h[h.length - 1]!.down).toBe(HISTORY_LENGTH + 9);
  });

  it('clamps junk to zero and does not mutate the input', () => {
    const before = [{ down: 1, up: 1 }];
    const after = pushSample(before, { down: -5, up: Number.NaN });
    expect(after[1]).toEqual({ down: 0, up: 0 });
    expect(before).toHaveLength(1);
  });
});

describe('niceMax', () => {
  it('rounds up to a 1/2/5 step so the axis stops jittering', () => {
    expect(niceMax(1_500_000)).toBe(2_000_000);
    expect(niceMax(2_100_000)).toBe(5_000_000);
    expect(niceMax(6_000_000)).toBe(10_000_000);
  });

  it('never collapses to zero for an idle torrent', () => {
    expect(niceMax(0)).toBe(128 * 1024);
    expect(niceMax(-5)).toBe(128 * 1024);
  });
});

describe('sparklinePath', () => {
  it('draws oldest-left, newest-right, with the peak at the top', () => {
    const d = sparklinePath([0, 100], 100, 10, 100);
    expect(d).toBe('M0.00,10.00 L100.00,0.00');
  });

  it('lays a partial history out from the left against the full slot count', () => {
    const d = sparklinePath([50], 100, 10, 100, 11);
    expect(d.startsWith('M0.00,5.00')).toBe(true);
  });

  it('clamps a value above the axis instead of drawing off-canvas', () => {
    expect(sparklinePath([500], 100, 10, 100, 1)).toContain(',0.00');
  });

  it('returns empty for nothing to draw', () => {
    expect(sparklinePath([], 100, 10, 100)).toBe('');
    expect(sparklinePath([1], 0, 10, 100)).toBe('');
  });

  it('closes the area path back to the baseline', () => {
    const area = sparklineArea([0, 100], 100, 10, 100);
    expect(area.endsWith('L0.00,10.00 Z')).toBe(true);
    expect(sparklineArea([], 100, 10, 100)).toBe('');
  });
});

describe('shareRatio', () => {
  it('is upload over download', () => {
    expect(shareRatio(50, 100)).toBe(0.5);
    expect(shareRatio(200, 100)).toBe(2);
  });

  it('is null before anything has been downloaded', () => {
    expect(shareRatio(10, 0)).toBeNull();
  });
});

describe('isDiskCacheFailure', () => {
  it('recognises the write/flush errors that a smaller cache can fix', () => {
    expect(isDiskCacheFailure('Failed to flush the disk cache')).toBe(true);
    expect(isDiskCacheFailure('[ERROR] disk cache flush failure')).toBe(true);
    expect(isDiskCacheFailure('Cannot write to file')).toBe(true);
    expect(isDiskCacheFailure('File I/O error')).toBe(true);
  });

  it('excludes a full disk, which no cache size fixes', () => {
    expect(isDiskCacheFailure('No space left on device')).toBe(false);
    expect(isDiskCacheFailure('Disk full while writing to file')).toBe(false);
  });

  it('ignores network errors and empty input', () => {
    expect(isDiskCacheFailure('Name resolution failed')).toBe(false);
    expect(isDiskCacheFailure('404 Not Found')).toBe(false);
    expect(isDiskCacheFailure('')).toBe(false);
    expect(isDiskCacheFailure(undefined)).toBe(false);
  });
});
