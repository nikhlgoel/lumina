import { describe, it, expect } from 'vitest';
import { allocatedBytes, spaceShortfall } from '@core/diskSpace';

const GB = 2 ** 30;
const MB = 2 ** 20;

describe('how much of a file is already paid for', () => {
  it('counts a non-sparse file by its size on disk, not by what was received', () => {
    // Real: 9 MB received, but the file already held 246 MB because its gap was zero-filled.
    expect(allocatedBytes({ length: 246 * MB, completed: 9 * MB, sizeOnDisk: 246 * MB, sparse: false })).toBe(246 * MB);
  });

  it('trusts received bytes for a sparse file, whose logical size is not what it occupies', () => {
    expect(allocatedBytes({ length: 100 * GB, completed: 3 * GB, sizeOnDisk: 100 * GB, sparse: true })).toBe(3 * GB);
  });

  it('falls back to received bytes when the file does not exist yet', () => {
    expect(allocatedBytes({ length: 5 * GB, completed: 0, sizeOnDisk: null, sparse: false })).toBe(0);
  });

  it('never counts more than the file will be', () => {
    expect(allocatedBytes({ length: 10 * MB, completed: 10 * MB, sizeOnDisk: 12 * MB, sparse: false })).toBe(10 * MB);
  });

  it('stops a download whose space is already allocated from being called too big', () => {
    // The false block seen on the 300 MB drive: 40 MB free, 246 MB file with 246 MB already on disk.
    const done = allocatedBytes({ length: 246 * MB, completed: 9 * MB, sizeOnDisk: 246 * MB, sparse: false });
    expect(spaceShortfall(40 * MB, 246 * MB, done)).toBeNull();
  });
});

describe('does the rest of a download fit', () => {
  it('says nothing when there is plenty of room', () => {
    expect(spaceShortfall(80 * GB, 20 * GB, 0)).toBeNull();
  });

  it('reports how much is missing when a torrent is bigger than the disk', () => {
    // The owner's case: a ~120 GB game, about 80 GB free.
    const missing = spaceShortfall(80 * GB, 120 * GB, 0)!;
    expect(missing).toBeGreaterThan(40 * GB);
    expect(missing).toBeLessThan(42 * GB + 2 * GB);
  });

  it('only counts what is still to come, so a resumed download is not penalised for what it already wrote', () => {
    expect(spaceShortfall(10 * GB, 120 * GB, 115 * GB)).toBeNull();
  });

  it('keeps a small margin back rather than filling the disk to the last byte', () => {
    expect(spaceShortfall(100 * GB, 100 * GB, 0)).not.toBeNull();
    expect(spaceShortfall(102 * GB, 100 * GB, 0)).toBeNull();
  });

  it('has nothing to do for a finished or empty selection', () => {
    expect(spaceShortfall(0, 50 * GB, 50 * GB)).toBeNull();
    expect(spaceShortfall(0, 0, 0)).toBeNull();
  });
});
