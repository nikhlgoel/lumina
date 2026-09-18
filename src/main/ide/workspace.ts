// Filesystem access for the embedded IDE, confined to one folder the user explicitly opened.
//
// Security posture: the renderer never hands us a path we trust. Every read, write and listing is
// resolved and then checked with isInsideWorkspace() against the current root, so a crafted path
// (../../.. , a symlink target, an absolute path to somewhere else) is refused rather than served.
// There is no "open file" API that works without a root being opened first.
import { dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {
  isInsideWorkspace, isNoiseDir, relativeToWorkspace, sortEntries, type TreeEntry,
} from '../../core/ide';
import { mainWindow } from '../window';
import { settings } from '../settings';
import { logger } from '../log';

const log = logger('ide');

/** Text files above this are opened read-only-ish: Monaco bogs down and it's usually generated. */
export const LARGE_FILE_BYTES = 2 << 20;
/** Hard refusal: not a source file anyone edits by hand. */
export const MAX_FILE_BYTES = 16 << 20;

let root: string | null = null;

export const workspaceRoot = () => root;

/** Resolve a workspace-relative path to an absolute one, or throw if it escapes the folder. */
/** The one guard every IDE path goes through — file access here, and git in ./git.ts. */
export function resolveInside(relative: string): string {
  if (!root) throw new Error('No folder is open.');
  const abs = path.resolve(root, relative);
  if (!isInsideWorkspace(root, abs)) {
    log.warn(`Refused a path outside the workspace: ${relative}`);
    throw new Error('That path is outside the open folder.');
  }
  return abs;
}

export interface WorkspaceInfo {
  root: string;
  name: string;
  /** Folders opened before, most recent first — the "Open Recent" list. */
  recent: string[];
}

const info = (): WorkspaceInfo => ({
  root: root ?? '',
  name: root ? path.basename(root) || root : '',
  recent: settings.get().ide.recentFolders,
});

/** Remember a folder at the top of the recent list, without duplicates. */
function remember(folder: string) {
  const recent = [folder, ...settings.get().ide.recentFolders.filter((f) => f !== folder)].slice(0, 10);
  settings.update({ ide: { recentFolders: recent, lastFolder: folder } });
}

/** Open a folder. With no argument, ask the user for one. Returns null if they cancelled. */
export async function openWorkspace(folder?: string): Promise<WorkspaceInfo | null> {
  let target = folder;
  if (!target) {
    const win = mainWindow();
    const opts = { title: 'Open a folder', properties: ['openDirectory' as const] };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled || !r.filePaths[0]) return null;
    target = r.filePaths[0];
  }
  const abs = path.resolve(target);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Error('That folder no longer exists.');
  root = abs;
  remember(abs);
  log.info(`Workspace opened: ${abs}`);
  return info();
}

export function closeWorkspace(): WorkspaceInfo {
  log.info('Workspace closed');
  root = null;
  return info();
}

/** Re-open whatever was open last, quietly — called at startup so the IDE comes back as it was. */
export function restoreWorkspace(): WorkspaceInfo {
  const last = settings.get().ide.lastFolder;
  if (last && fs.existsSync(last) && fs.statSync(last).isDirectory()) {
    root = path.resolve(last);
    log.info(`Workspace restored: ${root}`);
  }
  return info();
}

export const workspaceInfo = info;

/**
 * One directory level, sorted for display. The tree is lazy: the UI asks for children when a folder
 * is expanded, so opening a huge repo costs one readdir rather than a full recursive walk.
 */
export function listDirectory(relative = ''): TreeEntry[] {
  const abs = resolveInside(relative);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch (err) {
    log.debug(`Unreadable folder ${abs}`, err);
    return [];
  }
  const out: TreeEntry[] = [];
  for (const e of entries) {
    const isDir = e.isDirectory();
    if (isDir && isNoiseDir(e.name)) continue;
    // A symlink is listed but never followed into: its target could be anywhere on the disk.
    if (e.isSymbolicLink()) continue;
    if (!isDir && !e.isFile()) continue;
    out.push({
      name: e.name,
      path: relativeToWorkspace(root!, path.join(abs, e.name)),
      kind: isDir ? 'directory' : 'file',
    });
  }
  return sortEntries(out);
}

export interface FileContent {
  path: string;
  text: string;
  sizeBytes: number;
  /** True when the file is big enough that the editor should warn before treating it as source. */
  large: boolean;
  /** Last-modified stamp, so a save can detect the file changed underneath us. */
  mtimeMs: number;
}

/** Read a text file. Binary files are refused rather than rendered as mojibake. */
export function readTextFile(relative: string): FileContent {
  const abs = resolveInside(relative);
  const st = fs.statSync(abs);
  if (!st.isFile()) throw new Error('That isn’t a file.');
  if (st.size > MAX_FILE_BYTES) throw new Error(`That file is too large to open (${Math.round(st.size / (1 << 20))} MB).`);

  const buf = fs.readFileSync(abs);
  // A NUL byte in the first few KB is the standard cheap "this is binary" test.
  if (buf.subarray(0, 8192).includes(0)) throw new Error('That looks like a binary file, so there’s nothing to edit.');

  return {
    path: relativeToWorkspace(root!, abs),
    text: buf.toString('utf8'),
    sizeBytes: st.size,
    large: st.size > LARGE_FILE_BYTES,
    mtimeMs: st.mtimeMs,
  };
}

/**
 * Save a file. `expectedMtimeMs` guards against clobbering a change made outside the editor: pass
 * the mtime the buffer was loaded with, and the write is refused if the file moved on since.
 * Written to a temp file and renamed, so an interrupted save can't truncate the original.
 */
export function writeTextFile(relative: string, text: string, expectedMtimeMs?: number): FileContent {
  const abs = resolveInside(relative);
  if (expectedMtimeMs != null && fs.existsSync(abs)) {
    const current = fs.statSync(abs).mtimeMs;
    // Filesystem timestamps are coarse; a whole millisecond of difference is a real edit.
    if (Math.abs(current - expectedMtimeMs) > 1) {
      throw new Error('This file changed on disk since you opened it. Reload it before saving.');
    }
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.lumina-tmp`;
  try {
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, abs);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  const st = fs.statSync(abs);
  log.info(`Saved ${relativeToWorkspace(root!, abs)} (${st.size} bytes)`);
  return { path: relativeToWorkspace(root!, abs), text, sizeBytes: st.size, large: st.size > LARGE_FILE_BYTES, mtimeMs: st.mtimeMs };
}

export function createFile(relative: string, directory = false): TreeEntry {
  const abs = resolveInside(relative);
  if (fs.existsSync(abs)) throw new Error('Something with that name already exists.');
  if (directory) fs.mkdirSync(abs, { recursive: true });
  else {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, '', 'utf8');
  }
  return { name: path.basename(abs), path: relativeToWorkspace(root!, abs), kind: directory ? 'directory' : 'file' };
}

/** Rename or move within the workspace. Both ends are checked, so nothing can be moved outside it. */
export function renameEntry(from: string, to: string): TreeEntry {
  const src = resolveInside(from);
  const dest = resolveInside(to);
  if (fs.existsSync(dest)) throw new Error('Something with that name already exists.');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(src, dest);
  const isDir = fs.statSync(dest).isDirectory();
  return { name: path.basename(dest), path: relativeToWorkspace(root!, dest), kind: isDir ? 'directory' : 'file' };
}

/**
 * Every file in the workspace, workspace-relative — the list Quick Open filters against. Walked
 * once per request and bounded, which is fine for a project tree and avoids a stale index.
 */
export function allFiles(limit = 20_000): string[] {
  if (!root) throw new Error('No folder is open.');
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 12 || out.length >= limit) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= limit) return;
      if (e.isSymbolicLink()) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!isNoiseDir(e.name)) walk(abs, depth + 1);
      } else if (e.isFile()) {
        out.push(relativeToWorkspace(root!, abs));
      }
    }
  };
  walk(root, 0);
  return out;
}

export interface CodeSearchHit {
  path: string;
  line: number;
  column: number;
  /** The matching line, trimmed for display. */
  text: string;
}

/**
 * Plain substring search across the workspace's text files — enough for "find in files" without
 * shelling out to ripgrep. Bounded by file size, file count and hit count so a huge repo can't
 * lock the main process up.
 */
export function searchInFiles(
  query: string,
  opts: { caseSensitive?: boolean; maxHits?: number } = {},
): CodeSearchHit[] {
  if (!root) throw new Error('No folder is open.');
  const needle = opts.caseSensitive ? query : query.toLowerCase();
  if (needle.trim().length < 2) return [];
  const maxHits = Math.min(opts.maxHits ?? 500, 2000);
  const hits: CodeSearchHit[] = [];
  let filesRead = 0;

  const walk = (dir: string, depth: number) => {
    if (depth > 12 || hits.length >= maxHits || filesRead > 5000) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (hits.length >= maxHits) return;
      if (e.isSymbolicLink()) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!isNoiseDir(e.name)) walk(abs, depth + 1);
        continue;
      }
      if (!e.isFile()) continue;
      let buf: Buffer;
      try {
        if (fs.statSync(abs).size > LARGE_FILE_BYTES) continue;
        buf = fs.readFileSync(abs);
      } catch {
        continue;
      }
      if (buf.subarray(0, 4096).includes(0)) continue; // binary
      filesRead++;
      const rel = relativeToWorkspace(root!, abs);
      const lines = buf.toString('utf8').split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const column = (opts.caseSensitive ? line : line.toLowerCase()).indexOf(needle);
        if (column < 0) continue;
        hits.push({ path: rel, line: i + 1, column: column + 1, text: line.trim().slice(0, 300) });
        if (hits.length >= maxHits) return;
      }
    }
  };

  walk(root, 0);
  log.debug(`Search "${query}": ${hits.length} hits across ${filesRead} files`);
  return hits;
}
