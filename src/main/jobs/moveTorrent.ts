import fs from 'node:fs';
import path from 'node:path';

// Moving a half-done torrent to another folder or drive. aria2 keeps a torrent's data as `<name>` (the one file, or the folder of
// files) and its progress as `<name>.aria2` beside it. Both have to travel together: data without its control file cannot be resumed,
// and aria2 then refuses to touch it (the log's "File … exists, but a control file(*.aria2) does not exist").

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A torrent's name is a single path segment; anything else would let a crafted name reach outside the download folder. */
export function isPlainName(name: string): boolean {
  return name.length > 0 && name !== '.' && name !== '..' && !/[\\/:*?"<>|\0]/.test(name);
}

/** What has to move for torrent `name` in `dir`: the data and, when there is one, its control file. */
export function entriesToMove(dir: string, name: string): string[] {
  const entries = [name, `${name}.aria2`].filter((n) => fs.existsSync(path.join(dir, n)));
  return entries.includes(name) ? entries : [];
}

/** Windows keeps a file locked for a moment after aria2 lets go; retry such failures for up to about 20 s. */
async function withRetry<T>(op: () => T | Promise<T>, tries = 40): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await op();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (i >= tries - 1 || !['EBUSY', 'EPERM', 'EACCES'].includes(code ?? '')) throw err;
      await sleep(500);
    }
  }
}

/**
 * Move one entry. A rename is instant on one drive; across drives it fails (EXDEV), so copy, and only after the copy has
 * succeeded remove the original. A copy that fails halfway removes what it wrote and leaves the original untouched.
 */
async function moveEntry(from: string, to: string): Promise<void> {
  try {
    await withRetry(() => fs.promises.rename(from, to));
    return;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
  }
  try {
    await fs.promises.cp(from, to, { recursive: true, errorOnExist: true, force: false });
  } catch (err) {
    await fs.promises.rm(to, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
  await withRetry(() => fs.promises.rm(from, { recursive: true, force: true }));
}

/** Move torrent `name` (and its control file) from `fromDir` to `toDir`. Never overwrites anything in `toDir`. */
export async function moveTorrentEntries(fromDir: string, toDir: string, name: string): Promise<string[]> {
  if (!isPlainName(name)) throw new Error('This torrent’s name cannot be used as a folder name, so it cannot be moved.');
  if (path.resolve(fromDir).toLowerCase() === path.resolve(toDir).toLowerCase()) throw new Error('That is already the folder this torrent is saved in.');
  const entries = entriesToMove(fromDir, name);
  if (entries.length === 0) throw new Error(`Nothing named “${name}” was found in ${fromDir}, so there is nothing to move.`);
  fs.mkdirSync(toDir, { recursive: true });
  for (const e of entries) {
    if (fs.existsSync(path.join(toDir, e))) throw new Error(`“${e}” already exists in ${toDir}. Move or rename it first; nothing was moved.`);
  }
  const done: string[] = [];
  // The data first and its control file last: a stop in between leaves data with no control file at the new place, which is
  // recoverable by moving the control file, rather than a control file that vouches for data that is not there.
  for (const e of entries) {
    await moveEntry(path.join(fromDir, e), path.join(toDir, e));
    done.push(e);
  }
  return done;
}
