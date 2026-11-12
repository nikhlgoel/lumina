import fs from 'node:fs';
import path from 'node:path';
import { chooseBatchFolder } from '../core/existingFiles';
import { baseNames, seriesFolders } from '../core/episodes';

/** How a download names the file it writes (see the aria2 runner), so what is looked for here is what would be written there. */
export const diskName = (filename: string): string => filename.replace(/[\\/:*?"<>|]/g, '_');

/**
 * The folder a batch should go into, and which of its files are already complete in it. A half-finished file (one with a control file beside
 * it) is not "already there": it carries on where it stopped.
 */
export function planBatchFolder(base: string, title: string, filenames: string[], flat = false): { dir: string; sameBatch: boolean; existing: { filename: string; size: number }[] } {
  const names = filenames.map(diskName);
  // "flat": the files go straight into the chosen folder (no folder of their own), so that folder is the one to look in.
  const choice = flat ? { dir: base, sameBatch: true } : chooseBatchFolder({
    base,
    title,
    filenames: names,
    listDir: (dir) => {
      try {
        return fs.readdirSync(dir);
      } catch {
        return null;
      }
    },
    join: path.join,
  });
  const existing: { filename: string; size: number }[] = [];
  for (const filename of filenames) {
    const full = path.join(choice.dir, diskName(filename));
    try {
      const st = fs.statSync(full);
      if (st.isFile() && !fs.existsSync(`${full}.aria2`)) existing.push({ filename, size: st.size });
    } catch {
      // not there
    }
  }
  return { ...choice, existing };
}

/**
 * The folder an episode goes in: the show's own folder, then its season, kept for good (a later episode of the same show goes in beside the
 * earlier ones, unlike a batch, which is given a folder of its own). `have` is what is already in it, by name without extension, so an episode
 * downloaded before is not downloaded again.
 *
 * Nothing is created here. This is asked again as the series name is typed, and creating the folder each time left a trail of empty ones ("The R",
 * "The Replica"); the download makes the folder when it starts.
 */
export function seriesFolder(base: string, show: string, season: number): { dir: string; have: string[] } {
  const dir = path.join(base, ...seriesFolders(show, season));
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir);
  } catch {
    // not there yet, or unreadable: nothing is in it
  }
  return { dir, have: [...baseNames(files)] };
}
