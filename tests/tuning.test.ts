import { describe, it, expect } from 'vitest';
import { diskCacheMb } from '@core/tuning';

const GB = 2 ** 30;

describe('diskCacheMb — machine-adaptive aria2 disk cache', () => {
  it('scales ~16 MB per GB of RAM', () => {
    expect(diskCacheMb(8 * GB)).toBe(128);
    expect(diskCacheMb(12 * GB)).toBe(192);
    expect(diskCacheMb(16 * GB)).toBe(256);
  });

  it('floors at 64 MB on low-RAM machines', () => {
    expect(diskCacheMb(2 * GB)).toBe(64);
    expect(diskCacheMb(4 * GB)).toBe(64);
  });

  it('caps at 512 MB so it never hogs memory on huge machines', () => {
    expect(diskCacheMb(64 * GB)).toBe(512);
    expect(diskCacheMb(256 * GB)).toBe(512);
  });

  it('is safe for zero/garbage input', () => {
    expect(diskCacheMb(0)).toBe(64);
    expect(diskCacheMb(Number.NaN)).toBe(64);
    expect(diskCacheMb(-1)).toBe(64);
  });
});
