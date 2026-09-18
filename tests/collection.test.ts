import { describe, it, expect } from 'vitest';
import {
  PLAYLIST_NAME_MAX, addPaths, isUserPlaylistPath, movePath, normalizePlaylistName, removeAt,
  removePaths, sortByLikedAt, uniquePlaylistName, userPlaylistPath,
} from '@core/collection';

describe('normalizePlaylistName', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizePlaylistName('  late   night  ')).toBe('late night');
    expect(normalizePlaylistName('a\n\tb')).toBe('a b');
  });

  it('returns empty for a blank name so callers can reject it', () => {
    expect(normalizePlaylistName('   ')).toBe('');
    expect(normalizePlaylistName('')).toBe('');
  });

  it('caps the length', () => {
    expect(normalizePlaylistName('x'.repeat(500))).toHaveLength(PLAYLIST_NAME_MAX);
  });
});

describe('uniquePlaylistName', () => {
  it('keeps the name when it is free', () => {
    expect(uniquePlaylistName('Chill', ['Focus'])).toBe('Chill');
  });

  it('numbers duplicates, ignoring case', () => {
    expect(uniquePlaylistName('Chill', ['chill'])).toBe('Chill 2');
    expect(uniquePlaylistName('Chill', ['Chill', 'Chill 2'])).toBe('Chill 3');
  });

  it('falls back to a default for a blank name', () => {
    expect(uniquePlaylistName('   ', [])).toBe('New playlist');
    expect(uniquePlaylistName('', ['New playlist'])).toBe('New playlist 2');
  });
});

describe('addPaths', () => {
  it('appends in order and skips songs already in the playlist', () => {
    expect(addPaths(['a', 'b'], ['c', 'a', 'd'])).toEqual(['a', 'b', 'c', 'd']);
  });

  it('drops duplicates within the added batch too', () => {
    expect(addPaths([], ['a', 'a', 'b'])).toEqual(['a', 'b']);
  });

  it('does not mutate the original list', () => {
    const before = ['a'];
    addPaths(before, ['b']);
    expect(before).toEqual(['a']);
  });
});

describe('removePaths', () => {
  it('removes every occurrence', () => {
    expect(removePaths(['a', 'b', 'a', 'c'], ['a'])).toEqual(['b', 'c']);
  });

  it('leaves the list alone when nothing matches', () => {
    expect(removePaths(['a'], ['z'])).toEqual(['a']);
  });
});

describe('removeAt', () => {
  it('removes exactly one entry, so a repeated song loses only that copy', () => {
    expect(removeAt(['a', 'b', 'a'], 0)).toEqual(['b', 'a']);
    expect(removeAt(['a', 'b', 'a'], 2)).toEqual(['a', 'b']);
  });

  it('ignores an out-of-range index', () => {
    expect(removeAt(['a'], 5)).toEqual(['a']);
    expect(removeAt(['a'], -1)).toEqual(['a']);
  });
});

describe('movePath', () => {
  it('reorders an entry', () => {
    expect(movePath(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(movePath(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });

  it('clamps a drop past the end', () => {
    expect(movePath(['a', 'b', 'c'], 0, 99)).toEqual(['b', 'c', 'a']);
  });

  it('is a no-op for a bad or unchanged position', () => {
    expect(movePath(['a', 'b'], 0, 0)).toEqual(['a', 'b']);
    expect(movePath(['a', 'b'], 7, 0)).toEqual(['a', 'b']);
  });
});

describe('user playlist paths', () => {
  it('round-trips and is recognisable', () => {
    const p = userPlaylistPath('abc');
    expect(isUserPlaylistPath(p)).toBe(true);
    expect(isUserPlaylistPath('C:\\Music\\list.m3u')).toBe(false);
  });
});

describe('sortByLikedAt', () => {
  it('puts the newest like first without mutating the input', () => {
    const rows = [{ likedAt: 1 }, { likedAt: 3 }, { likedAt: 2 }];
    expect(sortByLikedAt(rows).map((r) => r.likedAt)).toEqual([3, 2, 1]);
    expect(rows.map((r) => r.likedAt)).toEqual([1, 3, 2]);
  });
});
