// What "already downloaded" is allowed to mean for a playlist.
//
// yt-dlp's download archive is a list of video ids. Lumina used ONE such list for everything, so:
//   * a song once downloaded as a video blocked the same song as an MP3 (the id is the same, the file is not);
//   * a song whose file was deleted, or that went to another folder, still counted as downloaded;
//   * a playlist whose songs were all "downloaded" finished as "Done" with no file and no word about why.
// The owner's list held 423 ids. Asking for a playlist he had fetched before produced a green "Done" and nothing on disk
// (reproduced in the real app: 3 songs requested, 3 skipped, 0 files, status completed).
//
// The memory is now kept per kind (audio / video) and per destination folder, and a playlist that ends with every item
// skipped while the folder holds fewer files than that is not believed: it is run again without the list.

/** FNV-1a, 32 bit: small, stable between runs, and good enough to tell a handful of folders apart. */
function hash32(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** The file name of the memory for this kind of download into this folder. Case and slash style do not matter on Windows. */
export function archiveName(kind: 'audio' | 'video', outputDir: string): string {
  const folder = outputDir.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return `download-archive-${kind}-${hash32(folder)}.txt`;
}

/**
 * Was a playlist run that skipped everything telling the truth?
 *
 * `selected` is how many items were asked for, `mediaFilesInFolder` how many media files the destination really holds.
 * The files may have been moved on purpose, but a person who asked for N songs and has fewer than N in the folder wants
 * them downloaded, not a hollow "Done"; a duplicate is a smaller cost than nothing.
 */
export function skippedEverythingWrongly(selected: number, mediaFilesInFolder: number): boolean {
  return selected > 0 && mediaFilesInFolder < selected;
}

/** A folder name reduced to its letters and digits, so "Mix: A/B" and the look-alike characters yt-dlp writes for it compare equal. */
const plain = (name: string): string => name.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * The folder yt-dlp made for a playlist: the one under `outputDir` named like the playlist, or null when there is none
 * (nothing was ever put there, or it was deleted). Only the playlist's own folder says anything about the playlist; the
 * rest of a music library says nothing, and counting it would let a stale memory pass for ever.
 */
export function playlistFolder(
  outputDir: string,
  title: string,
  list: (dir: string) => { name: string; isDir: boolean }[],
): string | null {
  const want = plain(title);
  if (!want) return null;
  const hit = list(outputDir).find((e) => e.isDir && plain(e.name) === want);
  return hit ? `${outputDir}/${hit.name}` : null;
}

const MEDIA =/\.(mp3|m4a|flac|opus|ogg|oga|wav|aac|wma|webm|mp4|mkv|m4v|mov|avi)$/i;

/** Count of media files below a folder (given as a directory listing function so this stays testable), stopping at `limit`. */
export function countMedia(
  dir: string,
  list: (dir: string) => { name: string; isDir: boolean }[],
  limit = 5000,
): number {
  let count = 0;
  const walk = (d: string, depth: number) => {
    if (count >= limit || depth > 4) return;
    for (const e of list(d)) {
      if (count >= limit) return;
      if (e.isDir) walk(`${d}/${e.name}`, depth + 1);
      else if (MEDIA.test(e.name)) count++;
    }
  };
  walk(dir, 0);
  return count;
}
