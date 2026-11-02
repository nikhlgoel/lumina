import { describe, expect, it } from 'vitest';
import { shouldForget } from '@core/libraryPrune';

const probe = (o: { seen?: boolean; exists?: boolean; driveUp?: boolean }) => ({
  seen: () => o.seen ?? false,
  exists: () => o.exists ?? false,
  driveUp: () => o.driveUp ?? true,
});

describe('which library rows are forgotten after a scan', () => {
  it('keeps a file the scan found', () => {
    expect(shouldForget('C:\\m\\a.mp3', probe({ seen: true, exists: true }))).toBe(false);
  });

  it('forgets a file that is gone, even when its whole folder was deleted', () => {
    expect(shouldForget('C:\\Users\\x\\OneDrive\\Desktop\\Music & Videos\\a.mp3', probe({}))).toBe(true);
  });

  it('keeps a file the scan did not list but that is still on disk', () => {
    expect(shouldForget('C:\\m\\deep\\a.mp3', probe({ exists: true }))).toBe(false);
  });

  it('keeps the files of a drive that is not connected', () => {
    expect(shouldForget('E:\\music\\a.mp3', probe({ driveUp: false }))).toBe(false);
  });
});
