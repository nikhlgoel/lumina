// Planning a portable copy of Lumina onto a drive.
//
// Three files in this family, easy to confuse, so: `portable.ts` is the *media* layout written to a
// drive; `portableApp.ts` decides where a portable copy keeps its data; this one decides what to
// copy onto the drive in the first place, and whether it needs doing at all.
//
// The rule that matters most is at the bottom: **the user's data folder is never part of the copy.**
// Updating the app on a stick must not touch the library, settings or playlists already on it.

import { PORTABLE_DATA_DIR, PORTABLE_MARKER } from './portableApp';

/** The app itself lives in its own folder, so the drive's root stays the user's. */
export const PORTABLE_APP_DIR = 'Lumina';

/** Records which build is on the drive, so "is this up to date?" is a file read rather than a guess. */
export const PORTABLE_VERSION_FILE = 'lumina-version.txt';

export type InstallState = 'absent' | 'current' | 'outdated' | 'unknown';

/**
 * Is a copy already there, and is it the build we are running?
 *
 * `unknown` is deliberate: a folder with no version file is *something*, and silently overwriting
 * it would be worse than saying so.
 */
export function installState(found: { appDirExists: boolean; version: string | null }, current: string): InstallState {
  if (!found.appDirExists) return 'absent';
  const there = (found.version ?? '').trim();
  if (!there) return 'unknown';
  return there === current.trim() ? 'current' : 'outdated';
}

export function describeInstallState(state: InstallState, versionOnDrive: string | null): string {
  switch (state) {
    case 'absent':
      return 'Lumina isn’t on this drive yet.';
    case 'current':
      return 'This drive already has the version you’re running.';
    case 'outdated':
      return `This drive has ${versionOnDrive ?? 'an older version'}. Copying again will update it and leave your library on the drive alone.`;
    default:
      return 'There’s a Lumina folder here, but no version file. Copying again will overwrite the program files.';
  }
}

/** Copying needs the app's own size plus some slack, since the filesystem needs room to work. */
export function roomNeeded(appBytes: number): number {
  return Math.ceil(appBytes * 1.05) + 32 * 1024 * 1024;
}

export function hasRoom(appBytes: number, freeBytes: number): boolean {
  return freeBytes >= roomNeeded(appBytes);
}

export interface InstallPlan {
  /** Absolute destination for the program files. */
  appDir: string;
  /** Where the marker that switches portable mode on goes. */
  markerFile: string;
  /** The data folder — created if missing, and never overwritten. */
  dataDir: string;
  versionFile: string;
}

export function planInstall(driveRoot: string, join: (...p: string[]) => string): InstallPlan {
  const appDir = join(driveRoot, PORTABLE_APP_DIR);
  return {
    appDir,
    markerFile: join(appDir, PORTABLE_MARKER),
    dataDir: join(appDir, PORTABLE_DATA_DIR),
    versionFile: join(appDir, PORTABLE_VERSION_FILE),
  };
}

/**
 * Should this entry be copied from the installed app into the portable copy?
 *
 * Two exclusions, and both matter:
 *   * **the data folder** — it belongs to the user, and an update must leave it exactly as it was;
 *   * **the marker and version files** — they are written fresh at the end, so a stale one from a
 *     half-finished copy can never be mistaken for a complete install.
 */
export function shouldCopyEntry(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower === PORTABLE_DATA_DIR.toLowerCase()) return false;
  if (lower === PORTABLE_MARKER.toLowerCase()) return false;
  if (lower === PORTABLE_VERSION_FILE.toLowerCase()) return false;
  // Crash dumps and logs from the machine we're copying *from* are noise on someone else's stick.
  if (lower === 'crashpad' || lower === 'logs') return false;
  return true;
}

/**
 * Does an existing folder actually hold a Lumina install, or is it the user's own?
 *
 * This is not hypothetical: a real stick had `F:\Lumina` holding the owner's music, because people
 * name a folder after the app they use it with. Copying program files in there would have mixed
 * binaries through someone's library, so a folder that does not look like ours is refused outright
 * rather than "updated".
 */
export function looksLikeInstall(entries: string[]): boolean {
  const lower = entries.map((e) => e.toLowerCase());
  if (lower.includes(PORTABLE_VERSION_FILE.toLowerCase())) return true;
  if (lower.includes(PORTABLE_MARKER.toLowerCase())) return true;
  // A half-finished copy still has the executable, and re-copying over it is safe.
  return lower.some((e) => e.endsWith('.exe') && e.includes('lumina'));
}

/** An existing folder that is not ours and is not empty must never be written into. */
export function folderConflict(exists: boolean, entries: string[]): boolean {
  if (!exists) return false;
  if (entries.length === 0) return false;
  return !looksLikeInstall(entries);
}

export type InstallRefusal = { ok: true } | { ok: false; reason: string };

/**
 * Everything that must be true before a single byte is copied.
 *
 * Checked up front rather than discovered halfway through, because a half-copied app on a stick is
 * worse than no app: it looks installed and does not run.
 */
export function canInstall(o: {
  packaged: boolean;
  driveRoot: string;
  appBytes: number;
  freeBytes: number;
  writable: boolean;
  /** Whether the destination folder already exists, and what is in it. */
  destExists?: boolean;
  destEntries?: string[];
}): InstallRefusal {
  if (!o.packaged) {
    return { ok: false, reason: 'A portable copy can only be made from an installed Lumina, not from a development build.' };
  }
  if (!o.driveRoot.trim()) return { ok: false, reason: 'No drive is selected.' };
  if (!o.writable) return { ok: false, reason: 'That drive is read-only.' };
  if (o.appBytes <= 0) return { ok: false, reason: 'Lumina’s own files could not be measured.' };
  if (folderConflict(o.destExists ?? false, o.destEntries ?? [])) {
    return {
      ok: false,
      reason: `There is already a “${PORTABLE_APP_DIR}” folder on that drive with your own files in it. Rename or move it first — Lumina will not write program files into it.`,
    };
  }
  if (!hasRoom(o.appBytes, o.freeBytes)) {
    const needed = Math.ceil(roomNeeded(o.appBytes) / (1024 * 1024));
    const free = Math.floor(o.freeBytes / (1024 * 1024));
    return { ok: false, reason: `Not enough room: about ${needed} MB is needed and ${free} MB is free.` };
  }
  return { ok: true };
}
