// Copying Lumina itself onto a drive, so the stick carries the app as well as the media.
//
// The decisions live in @core/portableInstall; this does the filesystem work. Three properties are
// worth protecting, and each has a matching guard below:
//
//   * **Never destroy the user's data.** `Lumina-Data` on the drive is excluded from the copy, so
//     updating the program leaves the library, settings and playlists exactly as they were.
//   * **Never leave a half-copied app.** Everything is checked up front (packaged build, writable
//     drive, enough room), and the marker and version files are written *last* — so an interrupted
//     copy is recognisably incomplete rather than looking installed and failing to run.
//   * **Never copy into ourselves.** Refused if the destination is inside the source, which would
//     otherwise recurse until the drive filled.
import nodeFs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { app } from 'electron';
import {
  PORTABLE_VERSION_FILE, canInstall, installState, planInstall, shouldCopyEntry,
  type InstallState,
} from '../core/portableInstall';
import { logger } from './log';

const log = logger('portable-install');

/**
 * The filesystem WITHOUT Electron's asar patching.
 *
 * This is not a detail. Electron makes a packaged `app.asar` look like a *directory* to `fs`, so a
 * plain recursive copy walks into the archive, tries to copy the files it believes are inside, and
 * dies part-way with `ENOENT, not found in ...app.asar`. That is exactly how this failed on a real
 * stick: 349 MB of 732 MB copied, then nothing. `original-fs` sees `app.asar` for what it is on
 * disk — one file — and copies it as one file. It also stops `measure()` from reporting the
 * archive's uncompressed contents as the size to copy.
 *
 * Only this module needs the unpatched view, so it is taken here rather than by setting the
 * process-wide `process.noAsar`, which would break every other read from the archive for as long as
 * a copy was running. Outside Electron the module does not exist and plain `fs` is the right answer.
 */
const fs: typeof nodeFs = (() => {
  try {
    return createRequire(import.meta.url)('original-fs') as typeof nodeFs;
  } catch {
    return nodeFs;
  }
})();

export interface PortableInstallStatus {
  state: InstallState;
  versionOnDrive: string | null;
  currentVersion: string;
  appDir: string | null;
  /** Bytes the program files occupy, so the UI can say how long this will take. */
  appBytes: number;
  canInstall: boolean;
  reason: string | null;
}

/** The folder holding the running application's files. */
const sourceDir = (): string => path.dirname(app.getPath('exe'));

/** Total size of everything that would be copied. Bounded so a pathological tree cannot hang us. */
function measure(dir: string, depth = 0): number {
  if (depth > 12) return 0;
  let total = 0;
  let entries: nodeFs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (depth === 0 && !shouldCopyEntry(entry.name)) continue;
    // Symlinks are not followed: a link pointing back up the tree would loop forever.
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += measure(full, depth + 1);
    else if (entry.isFile()) {
      try {
        total += fs.statSync(full).size;
      } catch {
        // Vanished between listing and stat; it simply won't be copied either.
      }
    }
  }
  return total;
}

function readVersionOnDrive(appDir: string): string | null {
  try {
    return fs.readFileSync(path.join(appDir, PORTABLE_VERSION_FILE), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/** Is the drive writable? Answered by trying, because Windows lies about read-only flags. */
function writable(root: string): boolean {
  const probe = path.join(root, `.lumina-write-test-${process.pid}`);
  try {
    fs.writeFileSync(probe, '');
    fs.rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

function freeBytes(root: string): number {
  try {
    const stats = fs.statfsSync(root);
    return stats.bavail * stats.bsize;
  } catch {
    return 0;
  }
}

/** Would copying into `dest` mean copying the source into itself? */
function nested(source: string, dest: string): boolean {
  const from = path.resolve(source).toLowerCase();
  const to = path.resolve(dest).toLowerCase();
  return to === from || to.startsWith(`${from}${path.sep}`);
}

export function portableInstallStatus(driveRoot: string): PortableInstallStatus {
  const currentVersion = app.getVersion();
  const plan = planInstall(driveRoot, (...p) => path.join(...p));
  const appDirExists = fs.existsSync(plan.appDir);
  const versionOnDrive = appDirExists ? readVersionOnDrive(plan.appDir) : null;
  const appBytes = measure(sourceDir());

  let destEntries: string[] = [];
  if (appDirExists) {
    try {
      destEntries = fs.readdirSync(plan.appDir);
    } catch {
      destEntries = [];
    }
  }

  const verdict = canInstall({
    packaged: app.isPackaged,
    driveRoot,
    appBytes,
    freeBytes: freeBytes(driveRoot),
    writable: writable(driveRoot),
    destExists: appDirExists,
    destEntries,
  });

  const blocked = !verdict.ok
    ? verdict.reason
    : nested(sourceDir(), plan.appDir)
      ? 'That drive already holds the copy of Lumina that is running.'
      : null;

  return {
    state: installState({ appDirExists, version: versionOnDrive }, currentVersion),
    versionOnDrive,
    currentVersion,
    appDir: plan.appDir,
    appBytes,
    canInstall: blocked === null,
    reason: blocked,
  };
}

export interface InstallProgress {
  stage: string;
  bytes: number;
  totalBytes: number;
  done: boolean;
  error: string | null;
}

/**
 * Copy the app onto the drive.
 *
 * Files are copied through a `.part` name and renamed, so a file that exists on the drive is a file
 * that copied completely.
 */
export async function installPortable(
  driveRoot: string,
  onProgress: (p: InstallProgress) => void,
  handle: { cancelled?: boolean } = {},
): Promise<InstallProgress> {
  const status = portableInstallStatus(driveRoot);
  if (!status.canInstall) {
    const failed = { stage: 'Stopped', bytes: 0, totalBytes: 0, done: true, error: status.reason };
    onProgress(failed);
    return failed;
  }

  const source = sourceDir();
  const plan = planInstall(driveRoot, (...p) => path.join(...p));
  let copied = 0;
  const report = (stage: string): InstallProgress =>
    ({ stage, bytes: copied, totalBytes: status.appBytes, done: false, error: null });

  onProgress(report('Preparing'));

  try {
    fs.mkdirSync(plan.appDir, { recursive: true });
    // Created but never written into — if a data folder is already there it is left untouched.
    fs.mkdirSync(plan.dataDir, { recursive: true });

    // A stale marker from an interrupted copy must not make a broken folder look installed.
    fs.rmSync(plan.markerFile, { force: true });
    fs.rmSync(plan.versionFile, { force: true });

    const copyDir = async (from: string, to: string, depth: number): Promise<void> => {
      if (handle.cancelled) return;
      fs.mkdirSync(to, { recursive: true });
      for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        if (handle.cancelled) return;
        if (depth === 0 && !shouldCopyEntry(entry.name)) continue;
        if (entry.isSymbolicLink()) continue;
        const src = path.join(from, entry.name);
        const dst = path.join(to, entry.name);
        if (entry.isDirectory()) {
          await copyDir(src, dst, depth + 1);
        } else if (entry.isFile()) {
          const part = `${dst}.lumina-part`;
          await fs.promises.copyFile(src, part);
          await fs.promises.rename(part, dst);
          copied += fs.statSync(dst).size;
          onProgress(report(entry.name));
        }
      }
    };

    await copyDir(source, plan.appDir, 0);

    if (handle.cancelled) {
      const stopped = { stage: 'Cancelled', bytes: copied, totalBytes: status.appBytes, done: true, error: null };
      onProgress(stopped);
      return stopped;
    }

    // Written last, and only now: their presence is what marks the copy as complete and portable.
    fs.writeFileSync(plan.markerFile, 'This file makes Lumina run portably, keeping all data in Lumina-Data.\n', 'utf8');
    fs.writeFileSync(plan.versionFile, `${status.currentVersion}\n`, 'utf8');

    log.info(`Copied Lumina ${status.currentVersion} to ${plan.appDir}`);
    const finished = { stage: 'Finished', bytes: copied, totalBytes: status.appBytes, done: true, error: null };
    onProgress(finished);
    return finished;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`Portable copy failed: ${message}`);
    const failed = { stage: 'Stopped', bytes: copied, totalBytes: status.appBytes, done: true, error: message };
    onProgress(failed);
    return failed;
  }
}
