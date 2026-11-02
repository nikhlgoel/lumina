// Which library rows to forget after a scan.
//
// The scan used to forget only a file that sat under a root it had just walked, and a root that no longer exists is not walked. So when
// a library folder was deleted or moved (a OneDrive folder that stopped syncing, a cleanup), every song in it stayed listed: no cover,
// "Can't play" on every click, and no scan could ever remove them. A file that is no longer on disk is forgotten wherever it was.
//
// The one exception is a drive that is not there at all (an external disk that is unplugged): its files are not "deleted", so they
// stay until the drive is back or the person removes the folder from the library. Pure, so each case is tested without a disk.

export interface PruneProbe {
  /** Was this path seen by the walk that just finished? */
  seen: (p: string) => boolean;
  /** Does the file exist right now? */
  exists: (p: string) => boolean;
  /** Is the drive (or filesystem root) the path lives on there at all? */
  driveUp: (p: string) => boolean;
}

/** True when a row whose file was not found by the walk should be removed. */
export function shouldForget(p: string, probe: PruneProbe): boolean {
  if (probe.seen(p)) return false;
  if (probe.exists(p)) return false; // a file the walk missed (a depth limit, a skipped folder) but that is still there
  return probe.driveUp(p);
}
