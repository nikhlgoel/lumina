// Classifies the downloads that aren't music or video — documents, archives, installers, images —
// so the Library can list them instead of leaving them invisible in the downloads folder.
// Pure string work on file names, so it is unit-tested and usable from both processes.

export type FileKind = 'document' | 'ebook' | 'archive' | 'image' | 'app' | 'subtitle' | 'code' | 'other';

const BY_EXT: Record<string, FileKind> = {};
const register = (kind: FileKind, exts: string[]) => exts.forEach((e) => { BY_EXT[e] = kind; });

register('document', ['pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'xls', 'xlsx', 'ods', 'csv', 'ppt', 'pptx', 'odp', 'pages', 'numbers', 'key']);
register('ebook', ['epub', 'mobi', 'azw', 'azw3', 'fb2', 'djvu', 'cbz', 'cbr']);
register('archive', ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'zst', 'iso', 'img', 'cab', 'arj', 'lzh', 'tgz']);
register('image', ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'svg', 'avif', 'heic', 'ico', 'psd']);
register('app', ['exe', 'msi', 'msix', 'appx', 'dmg', 'pkg', 'deb', 'rpm', 'appimage', 'apk', 'flatpak', 'snap']);
register('subtitle', ['srt', 'vtt', 'ass', 'ssa', 'sub', 'idx', 'sbv']);
register('code', ['json', 'xml', 'yml', 'yaml', 'js', 'ts', 'py', 'sh', 'ps1', 'bat', 'sql', 'html', 'css', 'toml', 'ini', 'cfg', 'log']);

export const LABELS: Record<FileKind, string> = {
  document: 'Documents', ebook: 'Books', archive: 'Archives', image: 'Images',
  app: 'Apps and installers', subtitle: 'Subtitles', code: 'Text and data', other: 'Other files',
};

/** The order the Files tab shows the groups in — most-wanted first, 'Other' last. */
export const KIND_ORDER: FileKind[] = ['app', 'archive', 'document', 'ebook', 'image', 'subtitle', 'code', 'other'];

/** Lower-case extension without the dot; '' when the name has none. */
export function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf('.');
  // A leading dot is a hidden file (".gitignore"), not an extension.
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

/**
 * Is this the downloader's own bookkeeping rather than something the user downloaded?
 *
 * The Files tab exists to show people what they got. Control files and metadata dumps are ours, and
 * a name like `c9625df298353912c52657774bb3de80a9941277.torrent` tells the reader nothing at all —
 * aria2 writes one of those beside the download whenever `--bt-save-metadata` is on, so a magnet can
 * resume without fetching its metadata again.
 *
 * A torrent file the user put there themselves keeps its own name, so it is not matched and stays
 * visible: only the 40-character infohash form is ours.
 */
export function isDownloaderArtifact(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.endsWith('.aria2') || lower.endsWith('.part') || lower.endsWith('.ytdl') || lower.endsWith('.lumina-part')) return true;
  return /^[0-9a-f]{40}.torrent$/.test(lower);
}

export function fileKindOf(name: string): FileKind {
  return BY_EXT[extensionOf(name)] ?? 'other';
}

/**
 * Split-archive volumes (`name.part02.rar`, `name.7z.003`, `name.r01`) are pieces of one download,
 * not files in their own right — the Files tab hides all but the first so a 24-part repack is one row.
 */
export function isTrailingVolume(name: string): boolean {
  // Windows appends " (2)" when a file is downloaded twice — strip it so the volume number still reads.
  const base = (name.split(/[\\/]/).pop() ?? name).toLowerCase().replace(/ \(\d+\)(?=\.|$)/g, '');
  const part = base.match(/\.part0*(\d+)\.rar$/);
  if (part) return Number(part[1]) > 1;
  const numbered = base.match(/\.(?:7z|zip|rar|tar|iso|bin|img)\.0*(\d{1,3})$/);
  if (numbered) return Number(numbered[1]) > 1;
  if (/\.r\d{2}$/.test(base) || /\.z\d{2}$/.test(base)) return true;
  return false;
}

/** Group a listing into the tab's sections, dropping empty ones and keeping KIND_ORDER. */
export function groupByKind<T extends { name: string }>(files: T[]): { kind: FileKind; label: string; files: T[] }[] {
  const buckets = new Map<FileKind, T[]>();
  for (const f of files) {
    const kind = fileKindOf(f.name);
    buckets.set(kind, [...(buckets.get(kind) ?? []), f]);
  }
  return KIND_ORDER.filter((k) => buckets.has(k)).map((kind) => ({ kind, label: LABELS[kind], files: buckets.get(kind)! }));
}
