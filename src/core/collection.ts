// Pure list maths behind the offline music collection: liked songs and playlists the user builds
// here (as opposed to the .m3u files and folders the scanner finds). No I/O, so it is unit-tested.

export const PLAYLIST_NAME_MAX = 120;
/** A user playlist has no file on disk; this synthetic path fills the table's UNIQUE path column. */
export const userPlaylistPath = (id: string) => `lumina:playlist/${id}`;
export const isUserPlaylistPath = (p: string) => p.startsWith('lumina:playlist/');

/** Trim and collapse whitespace; returns '' when the name is blank, which callers must reject. */
export function normalizePlaylistName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, PLAYLIST_NAME_MAX);
}

/**
 * A name that isn't taken yet: "Chill", then "Chill 2", "Chill 3"… Comparison ignores case so the
 * list never shows two playlists that look identical.
 */
export function uniquePlaylistName(base: string, taken: string[]): string {
  const clean = normalizePlaylistName(base) || 'New playlist';
  const used = new Set(taken.map((t) => t.toLowerCase()));
  if (!used.has(clean.toLowerCase())) return clean;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${clean} ${n}`.slice(0, PLAYLIST_NAME_MAX);
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `${clean} ${Date.now()}`.slice(0, PLAYLIST_NAME_MAX);
}

/** Append songs, keeping the existing order and ignoring ones already in the playlist. */
export function addPaths(existing: string[], add: string[]): string[] {
  const have = new Set(existing);
  const out = [...existing];
  for (const p of add) {
    if (have.has(p)) continue;
    have.add(p);
    out.push(p);
  }
  return out;
}

/** Remove every occurrence of the given songs. */
export function removePaths(existing: string[], remove: string[]): string[] {
  const drop = new Set(remove);
  return existing.filter((p) => !drop.has(p));
}

/** Remove exactly one entry by position — the right behaviour when a playlist repeats a song. */
export function removeAt(existing: string[], index: number): string[] {
  if (index < 0 || index >= existing.length) return existing;
  return [...existing.slice(0, index), ...existing.slice(index + 1)];
}

/** Drag-reorder: take the entry at `from` and drop it at `to`, clamped to the list. */
export function movePath(existing: string[], from: number, to: number): string[] {
  if (from < 0 || from >= existing.length || from === to) return existing;
  const target = Math.max(0, Math.min(existing.length - 1, to));
  const out = [...existing];
  const [moved] = out.splice(from, 1);
  out.splice(target, 0, moved!);
  return out;
}

/** Newest-first ordering for the Liked songs list, matching how the likes are stored. */
export function sortByLikedAt<T extends { likedAt: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.likedAt - a.likedAt);
}
