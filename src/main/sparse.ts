import { execFile } from 'node:child_process';
import { logger } from './log';

const log = logger('sparse');
const done = new Set<string>();
const marked = new Set<string>();

/** True only for files this process successfully marked sparse. */
export const isSparse = (file: string): boolean => marked.has(file);

/**
 * Mark a file sparse (Windows/NTFS) so a write far past its end does not stall the process doing it.
 *
 * Called right after aria2 creates a large file: measured, the flag lands ~7 ms after creation and
 * works on a file aria2 already has open. Failure is never fatal — a FAT/exFAT stick has no sparse
 * support and simply keeps the old behaviour — and a path is only attempted once.
 */
export function markSparse(file: string): Promise<boolean> {
  if (done.has(file)) return Promise.resolve(true);
  done.add(file);
  return new Promise((resolve) => {
    execFile('fsutil', ['sparse', 'setflag', file], { windowsHide: true, timeout: 5000 }, (err) => {
      if (err) log.debug(`Could not mark ${file} sparse: ${err.message}`);
      if (!err) marked.add(file);
      resolve(!err);
    });
  });
}
