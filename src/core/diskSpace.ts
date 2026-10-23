// Will the rest of this download fit on the disk?
//
// Direct downloads know their size up front and fail fast (aria2.ts). A torrent knows it only once
// the metadata arrives, and the user can still pick fewer files after that, so a torrent bigger than
// the free space must not be failed outright — it waits, says why, and carries on the moment the
// space (or a smaller selection) allows. Without any check a 120 GB game on an 80 GB disk starts
// happily and dies hours later, far into the download.

export interface FileAllocation {
  /** Full size the file will have. */
  length: number;
  /** Bytes aria2 says it has received for this file. */
  completed: number;
  /** The file's size on disk right now, or null if it does not exist yet. */
  sizeOnDisk: number | null;
  /** True when we marked it sparse, so holes in it cost nothing. */
  sparse: boolean;
}

/**
 * How much of a file's final size is already paid for on the disk.
 *
 * Not the same as bytes received. A file that is not sparse gets the whole gap between its old end
 * and a far-off write zero-filled and allocated at once (measured: a 246 MB torrent file took 246 MB
 * of a 286 MB drive after receiving 9 MB), so counting only received bytes made the check demand
 * space that was already gone and block a download that fit.
 */
export function allocatedBytes(f: FileAllocation): number {
  const real = f.sparse || f.sizeOnDisk === null ? f.completed : Math.max(f.completed, f.sizeOnDisk);
  return Math.min(f.length, real);
}

/** Keep a little back for control files, filesystem overhead and whatever else is writing. */
const MARGIN = 1.01;

/**
 * Bytes still missing for the rest of the selected files, or null when they fit.
 *
 * `selectedBytes` is the size of everything chosen; `doneBytes` is already on disk, so it needs no
 * further room. A resumed download therefore only has to fit what is left.
 */
export function spaceShortfall(freeBytes: number, selectedBytes: number, doneBytes: number): number | null {
  const remaining = Math.max(0, selectedBytes - doneBytes);
  if (remaining === 0) return null;
  const need = Math.ceil(remaining * MARGIN);
  return need > freeBytes ? need - freeBytes : null;
}
