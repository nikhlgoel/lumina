import { describe, expect, it } from 'vitest';
import { entryKind, type StatLike } from '@core/walkEntry';

const listed = (kind: 'file' | 'dir' | 'link' | 'other') => ({
  isFile: () => kind === 'file',
  isDirectory: () => kind === 'dir',
});
const stat = (kind: 'file' | 'dir' | 'other'): StatLike => ({ isFile: () => kind === 'file', isDirectory: () => kind === 'dir' });

describe('what a directory entry is', () => {
  it('is what the listing says when it says plainly, without asking the disk again', () => {
    const never = () => { throw new Error('should not stat'); };
    expect(entryKind(listed('file'), never)).toBe('file');
    expect(entryKind(listed('dir'), never)).toBe('dir');
  });

  it('is looked through when the listing calls it a link: a cloud-synced music file is a file', () => {
    // The real case: the listing said "symbolic link" for 40 FLAC tracks; a stat said they were ordinary files. They were skipped, and the
    // folder never appeared in the Library or in its playlists.
    expect(entryKind(listed('link'), () => stat('file'))).toBe('file');
  });

  it('is a folder when a link points at one', () => {
    expect(entryKind(listed('link'), () => stat('dir'))).toBe('dir');
  });

  it('is nothing for a link that points nowhere, or at something that is neither', () => {
    expect(entryKind(listed('link'), () => null)).toBeNull();
    expect(entryKind(listed('other'), () => stat('other'))).toBeNull();
  });
});
