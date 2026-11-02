import { describe, expect, it } from 'vitest';
import { autoUploadCapKbps, UPLOAD_FLOOR_KBPS, worthChanging } from '@core/uploadCap';

describe('how much to share while downloading', () => {
  it('is a tenth of the download speed', () => {
    expect(autoUploadCapKbps(10_000, true)).toBe(1000);
    expect(autoUploadCapKbps(30_000, true)).toBe(3000);
  });

  it('never goes below the floor that keeps peers willing to send', () => {
    expect(autoUploadCapKbps(0, true)).toBe(UPLOAD_FLOOR_KBPS);
    expect(autoUploadCapKbps(100, true)).toBe(UPLOAD_FLOOR_KBPS);
    expect(autoUploadCapKbps(400, true)).toBe(UPLOAD_FLOOR_KBPS);
  });

  it('cuts a user-reported 628 KB/s download from 646 KB/s of upload to about a tenth', () => {
    expect(autoUploadCapKbps(628, true)).toBe(60);
  });

  it('is rounded to steps of 10 KB/s', () => {
    expect(autoUploadCapKbps(1234, true) % 10).toBe(0);
    expect(autoUploadCapKbps(5555, true)).toBe(560);
  });

  it('has no limit when nothing is downloading, so deliberate seeding is not held back', () => {
    expect(autoUploadCapKbps(0, false)).toBe(0);
    expect(autoUploadCapKbps(5000, false)).toBe(0);
  });

  it('does not chase small wobbles in the speed', () => {
    expect(worthChanging(1000, 1100)).toBe(false);
    expect(worthChanging(1000, 800)).toBe(false);
    expect(worthChanging(1000, 1300)).toBe(true);
    expect(worthChanging(1000, 600)).toBe(true);
  });

  it('always sets the first limit and always follows a switch on or off', () => {
    expect(worthChanging(-1, 50)).toBe(true);
    expect(worthChanging(-1, 0)).toBe(true);
    expect(worthChanging(0, 50)).toBe(true);
    expect(worthChanging(500, 0)).toBe(true);
    expect(worthChanging(0, 0)).toBe(false);
  });

  it('copes with a bad speed reading', () => {
    expect(autoUploadCapKbps(Number.NaN, true)).toBe(UPLOAD_FLOOR_KBPS);
    expect(autoUploadCapKbps(-5, true)).toBe(UPLOAD_FLOOR_KBPS);
  });
});
