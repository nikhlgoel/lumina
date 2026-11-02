import fs from 'node:fs';

/**
 * Put a freshly written executable in place of the one at `dest`, even if that one is running.
 *
 * Windows will not overwrite an .exe that is running, and a download is often using yt-dlp at the moment it is updated: the owner's log had
 * EPERM on the rename and a 17 MB `.new` file left behind. It does let a running .exe be *renamed*, so a refused overwrite becomes: move the
 * old one aside, put the new one in. The old copy cannot be deleted while it runs, so it is removed on the next update.
 * The app is never left without the program: if the second step fails, the old one goes back.
 */
export function replaceExecutable(fresh: string, dest: string): void {
  const old = `${dest}.old`;
  try { fs.rmSync(old, { force: true }); } catch { /* an earlier copy that is still running: tried again next time */ }
  try {
    fs.renameSync(fresh, dest);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') {
      fs.rmSync(fresh, { force: true });
      throw err;
    }
    try {
      fs.renameSync(dest, old);
      fs.renameSync(fresh, dest);
    } catch (e) {
      if (!fs.existsSync(dest) && fs.existsSync(old)) fs.renameSync(old, dest);
      fs.rmSync(fresh, { force: true });
      throw e;
    }
  }
  try { fs.rmSync(old, { force: true }); } catch { /* still running: removed at the next update */ }
}
