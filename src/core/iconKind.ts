// What picture to show beside a download (separate from core/fileKind, which sorts the Library's Files tab).
// What kind of file a name is, for that picture. The extension is the honest signal for a plain file (a .rar is an
// archive whatever the page said about it); only when the name says nothing does the caller fall back to what the download was set up as.

import type { Job } from '../shared/types';

export type IconKind = 'archive' | 'video' | 'audio' | 'image' | 'document' | 'installer' | 'torrent' | 'subtitle' | 'other';

/** Exported so a test can check the table itself: no extension in two kinds, every one reads back as its kind. */
export const ICON_EXTENSIONS: Record<Exclude<IconKind, 'other'>, string[]> = {
  archive: ['rar', 'zip', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'cab', 'iso', 'img', 'dmg', 'lz', 'lzma', 'arj'],
  video: ['mp4', 'mkv', 'webm', 'avi', 'mov', 'm4v', 'wmv', 'flv', 'ts', 'm2ts', 'mpg', 'mpeg', '3gp', 'ogv'],
  audio: ['mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wma', 'aiff', 'alac', 'mka'],
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'tif', 'tiff', 'avif', 'heic', 'ico'],
  document: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'epub', 'mobi', 'odt', 'ods', 'csv', 'md', 'nfo'],
  installer: ['exe', 'msi', 'msix', 'apk', 'deb', 'rpm', 'appimage', 'pkg', 'bat', 'cmd'],
  torrent: ['torrent'],
  subtitle: ['srt', 'ass', 'ssa', 'vtt', 'sub'],
};

const BY_EXT = new Map<string, IconKind>();
for (const [kind, list] of Object.entries(ICON_EXTENSIONS) as [IconKind, string[]][]) for (const ext of list) BY_EXT.set(ext, kind);

/** A split archive's later volumes: `.r00`, `.r01`, `.z01`, `.001` and the like. */
const VOLUME = /^(?:r\d{2,3}|z\d{2}|\d{3})$/i;

/**
 * The kind of file `name` is, or null when the name does not say. Reads the last extension, so `Game.part01.rar` and `Game.rar.001` are both
 * archives. A bare magnet link is a torrent.
 */
export function fileKindOfName(name: string | null | undefined): IconKind | null {
  if (!name) return null;
  const text = name.trim();
  if (/^magnet:/i.test(text)) return 'torrent';
  // Only the file name part: a path or a URL's query must not decide it.
  const base = text.split(/[?#]/)[0]!.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot < 0 || dot === base.length - 1) return null;
  const ext = base.slice(dot + 1).toLowerCase();
  if (VOLUME.test(ext)) return 'archive';
  return BY_EXT.get(ext) ?? null;
}

/**
 * The kind to show for a download: what its file name says, else what it was set up as (music, video), else a plain file.
 * `fallback` is the content type of the job; an unknown name with no hint is `other`, never "music".
 */
export function fileKindFor(names: Array<string | null | undefined>, fallback?: 'music' | 'video' | 'series' | 'other' | null): IconKind {
  for (const name of names) {
    const kind = fileKindOfName(name);
    if (kind) return kind;
  }
  if (fallback === 'music') return 'audio';
  if (fallback === 'video' || fallback === 'series') return 'video';
  return 'other';
}

/** The kind that stands for a whole batch: the one most of its files share (ties go to the first seen), so twelve archive parts read as archives. */
export function dominantKind(kinds: IconKind[]): IconKind {
  const counts = new Map<IconKind, number>();
  for (const k of kinds) counts.set(k, (counts.get(k) ?? 0) + 1);
  let best: IconKind = 'other';
  let bestN = 0;
  for (const k of kinds) {
    const n = counts.get(k) ?? 0;
    if (n > bestN) { best = k; bestN = n; }
  }
  return best;
}

/**
 * The kind to show beside a download. A plain file (aria2) is read by its name: the title, the file it wrote, then the link. A site download
 * (yt-dlp) and a conversion are what they were set up as, since a video title is not a file name.
 */
export function jobIconKind(job: Pick<Job, 'engine' | 'title' | 'url' | 'outputPaths' | 'options'>): IconKind {
  if (job.engine === 'extract') return 'archive';
  const plainFile = job.engine === 'aria2';
  return fileKindFor(plainFile ? [job.title, job.outputPaths[0], job.url] : [], job.options.contentType);
}
