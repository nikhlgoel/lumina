// Removable-drive detection plus export/import between the library and a portable drive.
//
// The drive gets a plain, self-describing layout (see src/core/portable.ts) so any player can read
// it — Lumina is not required to play the stick. Copies go through a temp file and a rename, so a
// drive pulled mid-copy leaves a partial that is obviously partial rather than a corrupt track.
import { app } from 'electron';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { LibraryItem, PortableDrive, PortableTransfer } from '../shared/types';
import {
  PORTABLE_DIR, PORTABLE_SUBDIRS, buildPlaylist, fingerprint, planExport, planImport,
  type PortableItem,
} from '../core/portable';
import { mediaKindOf } from '../core/playlists';
import { itemId as libraryIdOf, library } from './library';
import { settings } from './settings';
import { logger } from './log';
import { ensureArtwork } from './coverArt';
import { factsOf, probe } from './media/probe';
import { convertAudio, transcodeTvSafe } from './media/ffmpeg';
import { TV_PROFILE, isTvSafe } from '../core/tvSafe';

const execFileAsync = promisify(execFile);
const log = logger('usb');

/* ---------- detection ---------- */

async function windowsDrives(): Promise<PortableDrive[]> {
  // DriveType 2 = removable. Read-only CIM query, no elevation, no user input on the command line.
  const script =
    'Get-CimInstance Win32_LogicalDisk -Filter "DriveType=2" | ' +
    'Select-Object DeviceID,VolumeName,Size,FreeSpace | ConvertTo-Json -Compress';
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { timeout: 10_000, windowsHide: true },
  );
  const text = stdout.trim();
  if (!text) return [];
  const parsed = JSON.parse(text) as unknown;
  const rows = (Array.isArray(parsed) ? parsed : [parsed]) as {
    DeviceID?: string; VolumeName?: string; Size?: number; FreeSpace?: number;
  }[];
  return rows
    .filter((r) => typeof r?.DeviceID === 'string' && Number(r.Size) > 0)
    .map((r) => ({
      root: `${r.DeviceID}\\`,
      label: r.VolumeName?.trim() || `Removable disk (${r.DeviceID})`,
      totalBytes: Number(r.Size) || 0,
      freeBytes: Number(r.FreeSpace) || 0,
      ready: Boolean(readyAt(`${r.DeviceID}\\`)),
    }));
}

function unixDrives(): PortableDrive[] {
  // Linux mounts removable media under /media/<user> or /run/media/<user>; macOS under /Volumes.
  const roots = process.platform === 'darwin'
    ? ['/Volumes']
    : [`/media/${os.userInfo().username}`, '/media', `/run/media/${os.userInfo().username}`];
  const out: PortableDrive[] = [];
  for (const base of roots) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(base, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const root = path.join(base, e.name);
      // The boot volume shows up under /Volumes on macOS; it isn't removable.
      if (process.platform === 'darwin' && fs.existsSync(path.join(root, 'System', 'Library', 'CoreServices'))) continue;
      if (out.some((d) => d.root === root)) continue;
      let totalBytes = 0;
      let freeBytes = 0;
      try {
        const st = fs.statfsSync(root);
        totalBytes = st.blocks * st.bsize;
        freeBytes = st.bavail * st.bsize;
      } catch {
        // An unreadable mount still gets listed, just without sizes.
      }
      out.push({ root, label: e.name, totalBytes, freeBytes, ready: Boolean(readyAt(root)) });
    }
  }
  return out;
}

/** True when the drive already has a LuminaMedia folder. */
const readyAt = (root: string) => fs.existsSync(path.join(root, PORTABLE_DIR));

/**
 * Dev-only: treat a plain folder as a removable drive, so the whole export/import path can be
 * exercised without physically plugging something in. Ignored in a packaged build.
 */
function fakeDrives(): PortableDrive[] {
  const dir = !app.isPackaged && process.env.LUMINA_USB_FAKE;
  if (!dir || !fs.existsSync(dir)) return [];
  const drive = listDriveSync(dir);
  return drive ? [{ ...drive, label: `${drive.label} (test drive)` }] : [];
}

export async function listDrives(): Promise<PortableDrive[]> {
  try {
    const drives = process.platform === 'win32' ? await windowsDrives() : unixDrives();
    return [...fakeDrives(), ...drives].sort((a, b) => a.root.localeCompare(b.root));
  } catch (err) {
    log.warn('Could not list removable drives', err);
    return fakeDrives();
  }
}

/* ---------- change notification ---------- */

type Listener = (drives: PortableDrive[]) => void;
const listeners = new Set<Listener>();
let known = '';
let timer: NodeJS.Timeout | null = null;

export function onDrivesChanged(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function poll() {
  const drives = await listDrives();
  const key = drives.map((d) => `${d.root}:${d.ready}`).join('|');
  if (key === known) return;
  known = key;
  log.info(drives.length ? `Removable drives: ${drives.map((d) => d.label).join(', ')}` : 'No removable drives');
  for (const fn of listeners) fn(drives);
}

/** There is no cross-platform mount event in Electron, so poll — cheap, and only while running. */
export function initUsb() {
  void poll();
  timer ??= setInterval(() => void poll().catch(() => {}), 5000);
  timer.unref?.();
}

/* ---------- structure ---------- */

/** Create (or repair) the LuminaMedia folders and drop a README explaining the layout. */
export function prepareDrive(root: string): PortableDrive | null {
  const base = path.join(root, PORTABLE_DIR);
  fs.mkdirSync(base, { recursive: true });
  for (const sub of PORTABLE_SUBDIRS) fs.mkdirSync(path.join(base, sub), { recursive: true });
  const readme = path.join(base, 'README.txt');
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(readme, [
      'LuminaMedia — a portable media folder.',
      '',
      'Music/      songs, filed as Artist/Album/Track Title',
      'Videos/     videos',
      'Playlists/  .m3u8 playlists pointing at the files above',
      'Files/      everything else',
      '',
      'Plain files in plain folders: any media player can read this drive.',
      'Lumina can also import this folder back into a library on another PC.',
      '',
    ].join('\r\n'), 'utf8');
  }
  log.info(`Prepared ${base}`);
  return listDriveSync(root);
}

function listDriveSync(root: string): PortableDrive | null {
  try {
    const st = fs.statfsSync(root);
    return {
      root,
      label: path.basename(root) || root,
      totalBytes: st.blocks * st.bsize,
      freeBytes: st.bavail * st.bsize,
      ready: readyAt(root),
    };
  } catch {
    return null;
  }
}

/* ---------- export ---------- */

const toPortableItem = (i: LibraryItem): PortableItem => ({
  path: i.path, kind: i.kind, title: i.title, artist: i.artist, album: i.album, trackNo: i.trackNo, sizeBytes: i.sizeBytes,
});

/** Index what's already on the drive, so a repeat export only copies what changed. */
function existingOnDrive(root: string): Record<string, number> {
  const base = path.join(root, PORTABLE_DIR);
  const out: Record<string, number> = {};
  const walk = (dir: string, depth: number) => {
    if (depth > 6) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.isFile()) {
        try {
          out[path.relative(root, full).split(path.sep).join('/')] = fs.statSync(full).size;
        } catch {
          // Unreadable file: treat as absent so the export re-copies it.
        }
      }
    }
  };
  walk(base, 0);
  return out;
}

export interface TransferHandle {
  cancel: () => void;
}

/**
 * Copy the chosen library items onto the drive, reporting progress. Each file lands as `.lumina-part`
 * and is renamed once fully written, so an unplugged drive can never leave a half file posing as
 * a whole one.
 */
export async function exportToDrive(
  root: string,
  kinds: ('audio' | 'video')[],
  onProgress: (t: PortableTransfer) => void,
  handle: TransferHandle & { cancelled?: boolean },
): Promise<PortableTransfer> {
  prepareDrive(root);
  const items = kinds.flatMap((kind) => library.items({ kind })).map(toPortableItem);
  // The gradient is drawn from the same string the library shows, so art on the drive matches the app.
  const seedFor = new Map(items.map((i) => [i.path, i.album ?? i.title]));
  const kindFor = new Map(items.map((i) => [i.path, i.kind]));
  const plan = planExport(items, existingOnDrive(root));

  let copiedBytes = 0;
  let copiedFiles = 0;
  /** Already on the drive and newer than the source — counted with the other skips. */
  let alreadyThere = 0;
  const report = (stage: string): PortableTransfer => ({
    stage, direction: 'export', root,
    files: copiedFiles, totalFiles: plan.entries.length,
    bytes: copiedBytes, totalBytes: plan.totalBytes,
    done: false, error: null, skipped: plan.skipped + alreadyThere,
  });

  onProgress(report('Preparing'));

  // Decide up front what the television cannot decode. Probing is cheap next to copying, and doing
  // it here means the progress report knows how much work is really ahead.
  const tvMode = settings.get().storage.usbTvCompatibility;
  const convert = new Set<string>();
  const durations = new Map<string, number | null>();
  if (tvMode === 'safe') {
    onProgress(report('Checking what your TV can play'));
    for (const entry of plan.entries) {
      if (handle.cancelled) break;
      try {
        const probed = await probe(entry.source);
        durations.set(entry.source, probed.durationSec);
        if (!isTvSafe(factsOf(probed))) convert.add(entry.source);
      } catch {
        // Unreadable by ffprobe: copy it untouched rather than guessing.
      }
    }
  }
  const cancels: (() => void)[] = [];
  handle.cancel = () => { for (const c of cancels) c(); };

  for (const entry of plan.entries) {
    if (handle.cancelled) break;
    let dest = path.join(root, ...entry.target.split('/'));

    // planExport recognises "already on the drive" by the source's name and size, but neither
    // survives the trip: converting changes both, and embedding a cover changes the size of a file
    // we merely copied. Without this check every re-export would redo the entire library — which a
    // two-run test caught doing exactly that.
    const willConvert = convert.has(entry.source);
    const isVideoFile = kindFor.get(entry.source) === 'video';
    const parsedDest = path.parse(dest);
    const outExt = isVideoFile ? '.mp4' : '.m4a';
    const finalDest = willConvert ? path.join(parsedDest.dir, `${parsedDest.name}${outExt}`) : dest;
    if (upToDate(finalDest, entry.source)) {
      alreadyThere++;
      continue;
    }

    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.lumina-part`;
    try {
      // A TV decodes far less than a PC. Rather than copying a file the set will refuse, convert it
      // on the way over — the whole point of "export to a drive I plug into the television".
      if (willConvert) {
        // ffmpeg chooses its muxer from the OUTPUT EXTENSION, so the usual `.lumina-part` suffix
        // makes it fail with "Error initializing the muxer … Invalid argument". The partial file
        // has to end in the real extension; the leading dot keeps it hidden and identifiable.
        const tmpConvert = path.join(parsedDest.dir, `.lumina-part-${process.pid}${outExt}`);
        onProgress(report(`Converting ${path.basename(entry.source)} for your TV`));
        if (isVideoFile) {
          await transcodeTvSafe({
            input: entry.source,
            output: tmpConvert,
            maxHeight: TV_PROFILE.maxHeight,
            maxFps: TV_PROFILE.maxFps,
            durationSec: durations.get(entry.source) ?? null,
            onProgress: () => {},
            register: (cancel) => { cancels.push(cancel); },
          });
        } else {
          const run = convertAudio(entry.source, tmpConvert, 'm4a', 256, durations.get(entry.source) ?? null, () => {});
          cancels.push(run.cancel);
          await run.promise;
        }
        await fs.promises.rename(tmpConvert, finalDest);
        dest = finalDest;
      } else {
        await fs.promises.copyFile(entry.source, tmp);
        await fs.promises.rename(tmp, dest);
      }

      // A TV reading this drive never opens Lumina, so anything without a cover would show a blank
      // tile. Give the copy on the drive a picture; the original on this PC is never touched.
      const seed = seedFor.get(entry.source) ?? path.basename(entry.source);
      try {
        await ensureArtwork(dest, seed, {
          // Video gets an image beside it only: tagging would make ffmpeg rewrite the whole file.
          sidecarOnly: isVideoFile,
          besideImage: isVideoFile,
          folderImage: !isVideoFile,
        });
      } catch (err) {
        log.debug(`Artwork for ${path.basename(dest)} skipped: ${err instanceof Error ? err.message : String(err)}`);
      }

      copiedFiles++;
      copiedBytes += entry.sizeBytes;
      onProgress(report(path.basename(dest)));
    } catch (err) {
      fs.rmSync(tmp, { force: true });
      for (const ext of ['.mp4', '.m4a']) {
        fs.rmSync(path.join(path.dirname(dest), `.lumina-part-${process.pid}${ext}`), { force: true });
      }
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`Export failed for ${entry.source}: ${message}`);
      return { ...report('Stopped'), done: true, error: `Couldn’t copy “${path.basename(entry.source)}” — ${message}` };
    }
  }

  writeDrivePlaylists(root);
  const final = { ...report(handle.cancelled ? 'Cancelled' : 'Finished'), done: true };
  log.info(`Export ${final.stage.toLowerCase()}: ${copiedFiles}/${plan.entries.length} files, ${plan.skipped} already there`);
  onProgress(final);
  return final;
}

/** Is the copy on the drive at least as new as the original? Cheaper and truer than comparing sizes. */
function upToDate(dest: string, source: string): boolean {
  try {
    return fs.statSync(dest).mtimeMs >= fs.statSync(source).mtimeMs;
  } catch {
    return false;
  }
}

/** Refresh the .m3u8 playlists so a dumb player sees everything on the drive in order. */
function writeDrivePlaylists(root: string) {
  const base = path.join(root, PORTABLE_DIR);
  for (const [sub, name] of [['Music', 'All music'], ['Videos', 'All videos']] as const) {
    const dir = path.join(base, sub);
    if (!fs.existsSync(dir)) continue;
    const found: string[] = [];
    const walk = (d: string, depth: number) => {
      if (depth > 6) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full, depth + 1);
        else if (e.isFile() && mediaKindOf(full)) found.push(path.relative(base, full).split(path.sep).join('/'));
      }
    };
    walk(dir, 0);
    try {
      // Paths are relative to the Playlists folder, so "../Music/..." keeps the drive portable.
      fs.writeFileSync(path.join(base, 'Playlists', `${name}.m3u8`), buildPlaylist(name, found.map((p) => `../${p}`)), 'utf8');
    } catch (err) {
      log.warn(`Could not write the ${name} playlist`, err);
    }
  }
}

/* ---------- import ---------- */

/** Everything playable on the drive that this library doesn't already have. */
export function scanDriveForImport(root: string): { path: string; name: string; sizeBytes: number }[] {
  const base = fs.existsSync(path.join(root, PORTABLE_DIR)) ? path.join(root, PORTABLE_DIR) : root;
  const found: { path: string; name: string; sizeBytes: number }[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 6 || found.length > 20_000) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.isFile() && mediaKindOf(full)) {
        try {
          found.push({ path: full, name: e.name, sizeBytes: fs.statSync(full).size });
        } catch {
          // Skip anything that can't be read.
        }
      }
    }
  };
  walk(base, 0);

  const have = new Set(
    (['audio', 'video'] as const)
      .flatMap((kind) => library.items({ kind }))
      .map((i) => fingerprint(path.basename(i.path), i.sizeBytes)),
  );
  return planImport(found, have);
}

/**
 * Copy the drive's media into this PC's library folders and index it. Music and video go to the
 * folders the user already configured, so imported files behave exactly like downloaded ones.
 */
export async function importFromDrive(
  root: string,
  onProgress: (t: PortableTransfer) => void,
  handle: TransferHandle & { cancelled?: boolean },
): Promise<PortableTransfer> {
  const wanted = scanDriveForImport(root);
  const s = settings.get().storage;
  let files = 0;
  let bytes = 0;
  const totalBytes = wanted.reduce((n, f) => n + f.sizeBytes, 0);
  const report = (stage: string): PortableTransfer => ({
    stage, direction: 'import', root,
    files, totalFiles: wanted.length, bytes, totalBytes, done: false, error: null, skipped: 0,
  });

  onProgress(report('Preparing'));
  for (const f of wanted) {
    if (handle.cancelled) break;
    const dir = mediaKindOf(f.path) === 'audio' ? s.musicDir : s.videoDir;
    fs.mkdirSync(dir, { recursive: true });
    let dest = path.join(dir, f.name);
    // Don't clobber a different file that happens to share the name.
    for (let n = 2; fs.existsSync(dest); n++) {
      const ext = path.extname(f.name);
      dest = path.join(dir, `${path.basename(f.name, ext)} (${n})${ext}`);
    }
    const tmp = `${dest}.lumina-part`;
    try {
      await fs.promises.copyFile(f.path, tmp);
      await fs.promises.rename(tmp, dest);
      await library.ingest(dest);
      files++;
      bytes += f.sizeBytes;
      onProgress(report(f.name));
    } catch (err) {
      fs.rmSync(tmp, { force: true });
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`Import failed for ${f.path}: ${message}`);
      return { ...report('Stopped'), done: true, error: `Couldn’t copy “${f.name}” — ${message}` };
    }
  }

  const final = { ...report(handle.cancelled ? 'Cancelled' : 'Finished'), done: true };
  log.info(`Import ${final.stage.toLowerCase()}: ${files}/${wanted.length} files`);
  onProgress(final);
  return final;
}

/* ---------- routing finished downloads to the drive ---------- */

/**
 * Copy a finished download onto the chosen drive, when routing is on and that drive is plugged in.
 * Deliberately a *post-download* copy: a USB stick is far too slow (and too easy to unplug) to be
 * a safe target for a multi-connection download — see docs/05. Failures are logged, never fatal:
 * the file is already safely on this PC.
 */
export async function routeFinishedToDrive(outputPaths: string[]): Promise<number> {
  const s = settings.get().storage;
  if (!s.usbRouting || !s.usbDrive) return 0;
  if (!fs.existsSync(s.usbDrive)) return 0;

  let copied = 0;
  for (const src of outputPaths) {
    const kind = mediaKindOf(src);
    if (!kind) continue;
    try {
      const st = fs.statSync(src);
      const item = library.getById(libraryIdOf(src));
      const portable: PortableItem = item
        ? toPortableItem(item)
        : { path: src, kind, title: path.basename(src, path.extname(src)), artist: null, album: null, trackNo: null, sizeBytes: st.size };
      const plan = planExport([portable], existingOnDrive(s.usbDrive));
      const entry = plan.entries[0];
      if (!entry) continue; // already on the drive at the same size

      const dest = path.join(s.usbDrive, ...entry.target.split('/'));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const tmp = `${dest}.lumina-part`;
      await fs.promises.copyFile(src, tmp);
      await fs.promises.rename(tmp, dest);
      copied++;
      log.info(`Copied ${path.basename(src)} to ${s.usbDrive}`);
    } catch (err) {
      // The download itself succeeded; a drive that vanished mid-copy is not a download failure.
      log.warn(`Could not copy ${path.basename(src)} to the drive`, err);
    }
  }
  if (copied > 0) writeDrivePlaylists(s.usbDrive);
  return copied;
}
