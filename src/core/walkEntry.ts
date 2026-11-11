// What a directory entry is, when the listing is not to be trusted about it.
//
// On Windows a file that is a reparse point (cloud-synced and redirected folders, some backup and de-duplication tools) is listed by `readdir`
// as a symbolic link, while a stat of it says it is an ordinary file. The library walked a folder of 40 FLAC tracks like that and found none:
// it kept only entries the listing called files, so the whole folder was invisible and nothing from it ever reached the Library or its
// playlists. A link is therefore looked through to what it points at.

export type EntryKind = 'file' | 'dir' | null;

export interface DirentLike {
  isFile(): boolean;
  isDirectory(): boolean;
}

export interface StatLike {
  isFile(): boolean;
  isDirectory(): boolean;
}

/**
 * The kind of an entry: a file, a folder, or neither (a socket, a link that points nowhere, an entry that cannot be read).
 * `statThrough` follows links and is only called when the listing did not say plainly.
 */
export function entryKind(entry: DirentLike, statThrough: () => StatLike | null): EntryKind {
  if (entry.isFile()) return 'file';
  if (entry.isDirectory()) return 'dir';
  const st = statThrough();
  if (!st) return null;
  return st.isFile() ? 'file' : st.isDirectory() ? 'dir' : null;
}
