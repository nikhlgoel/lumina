import { describe, it, expect } from 'vitest';
import { friendlyAria2Error } from '@core/progress';

describe('what a person is told when aria2 stops', () => {
  it('explains a full disk in Windows\u2019 own words, as captured from a real full drive', () => {
    // Real message from aria2 1.37 on an NTFS volume with no room left, trailing CR LF included.
    const raw = 'Failed to write into the file V:/dl-direct/big.bin, cause: There is not enough space on the disk.\r\n';
    const msg = friendlyAria2Error(raw);
    expect(msg).toMatch(/disk is full/i);
    expect(msg).toMatch(/Retry/);
    expect(msg).not.toContain('V:/dl-direct');
  });

  it('recognises the other ways an operating system says a disk is full', () => {
    for (const raw of ['No space left on device', 'There is not enough space on the disk', 'The disk is full', 'ENOSPC: no space left on device, write']) {
      expect(friendlyAria2Error(raw), raw).toMatch(/disk is full/i);
    }
  });

  it('turns the real outage text into a sentence, and one that still reads as a lost connection', () => {
    const raw = 'Network problem has occurred. cause:No connection could be made because the target machine actively refused it.\r\n';
    expect(friendlyAria2Error(raw)).toBe('The connection to the server was lost.');
  });

  it('never shows the raw line breaks of an unrecognised message', () => {
    expect(friendlyAria2Error('Something odd happened\r\n')).toBe('Something odd happened');
  });
});
