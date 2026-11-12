import { describe, expect, it } from 'vitest';
import { actionForExisting, chooseBatchFolder, stampedBatchTitle } from '@core/existingFiles';

describe('what to do with a file that is already there', () => {
  const same = { size: 5_000 };
  it('downloads it when nothing is there, whatever the mode', () => {
    for (const mode of [undefined, 'skip', 'replace'] as const) expect(actionForExisting(mode, 5_000, null)).toBe('download');
  });

  it('skip: reuses a file of the right size, and does not mistake another size for it', () => {
    expect(actionForExisting('skip', 5_000, same)).toBe('reuse');
    expect(actionForExisting('skip', 5_000, { size: 4_999 })).toBe('keep-both');
    expect(actionForExisting('skip', 5_000, { size: 5_001 })).toBe('keep-both');
  });

  it('skip: when the link gave no size, nothing proves the file is whole, so it is kept and the new one saved beside it', () => {
    expect(actionForExisting('skip', null, same)).toBe('keep-both');
    expect(actionForExisting('skip', 0, same)).toBe('keep-both');
    expect(actionForExisting('skip', null, { size: 0 })).toBe('keep-both');
  });

  it('replace: always replaces what is there', () => {
    expect(actionForExisting('replace', 5_000, same)).toBe('replace');
    expect(actionForExisting('replace', 5_000, { size: 1 })).toBe('replace');
    expect(actionForExisting('replace', null, { size: 0 })).toBe('replace');
  });

  it('no choice made: keeps both, as before', () => {
    expect(actionForExisting(undefined, 5_000, same)).toBe('keep-both');
  });
});

describe('the folder for a batch', () => {
  const join = (d: string, n: string) => `${d}/${n}`;
  const disk = (folders: Record<string, string[]>) => (dir: string) => folders[dir] ?? null;
  const choose = (folders: Record<string, string[]>, filenames: string[]) => chooseBatchFolder({ base: '/dl', title: 'Release', filenames, listDir: disk(folders), join });

  it('uses the plain title when no such folder exists, or it is empty', () => {
    expect(choose({}, ['a.rar'])).toEqual({ dir: '/dl/Release', sameBatch: false });
    expect(choose({ '/dl/Release': [] }, ['a.rar'])).toEqual({ dir: '/dl/Release', sameBatch: false });
  });

  it('reuses the folder when it holds a file of this batch, so a repeat finds its own files', () => {
    expect(choose({ '/dl/Release': ['a.rar', 'x.txt'] }, ['a.rar', 'b.rar'])).toEqual({ dir: '/dl/Release', sameBatch: true });
    expect(choose({ '/dl/Release': ['A.RAR'] }, ['a.rar'])).toEqual({ dir: '/dl/Release', sameBatch: true });
  });

  it('recognises a half-finished file of this batch by its control file', () => {
    expect(choose({ '/dl/Release': ['b.rar.aria2'] }, ['b.rar'])).toEqual({ dir: '/dl/Release', sameBatch: true });
  });

  it('gives another batch with the same title its own folder: (2), then (3)', () => {
    expect(choose({ '/dl/Release': ['other.zip'] }, ['a.rar'])).toEqual({ dir: '/dl/Release (2)', sameBatch: false });
    expect(choose({ '/dl/Release': ['other.zip'], '/dl/Release (2)': ['x.zip'] }, ['a.rar'])).toEqual({ dir: '/dl/Release (3)', sameBatch: false });
  });

  it('finds the batch’s own folder even when it is the second of that name', () => {
    expect(choose({ '/dl/Release': ['other.zip'], '/dl/Release (2)': ['a.rar'] }, ['a.rar'])).toEqual({ dir: '/dl/Release (2)', sameBatch: true });
  });

  it('never throws for a batch with no names', () => {
    expect(choose({ '/dl/Release': ['x'] }, [])).toEqual({ dir: '/dl/Release (2)', sameBatch: false });
  });
});

describe('a name for a batch whose links do not name their files', () => {
  it('is the day and time, with the minutes dotted so it is a valid folder name', () => {
    expect(stampedBatchTitle(new Date(2026, 10, 12, 9, 5))).toBe('Batch 2026-11-12 09.05');
  });
});
