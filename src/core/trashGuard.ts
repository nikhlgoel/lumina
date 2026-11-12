// Whether a folder may be moved to the Recycle Bin on the person's say-so ("delete this playlist"). A folder playlist IS a folder on disk, and a
// mistake here would not lose a playlist but a whole music collection, so the rule is strict: only a folder strictly inside a library folder,
// never a library folder itself, never a parent of one, never a drive root.

import path from 'node:path';

export type TrashVerdict = { ok: true } | { ok: false; reason: string };

/**
 * `roots` are the library folders; `protectedDirs` are other places that must stay (downloads, music, video, series folders). Paths are compared
 * after resolving them, ignoring letter case when `ignoreCase` is set (Windows).
 */
export function canTrashFolder(target: string, roots: readonly string[], protectedDirs: readonly string[], ignoreCase = process.platform === 'win32'): TrashVerdict {
  const norm = (p: string) => {
    const r = path.resolve(p).replace(/[\\/]+$/, '');
    return ignoreCase ? r.toLowerCase() : r;
  };
  const sep = path.sep;
  const t = norm(target);
  if (!target.trim()) return { ok: false, reason: 'There is no folder to remove.' };
  if (path.parse(path.resolve(target)).root.replace(/[\\/]+$/, '').toLowerCase() === t.toLowerCase() || t === '') return { ok: false, reason: 'That is a whole drive.' };
  const guarded = [...roots, ...protectedDirs].map(norm).filter(Boolean);
  if (guarded.some((g) => g === t)) return { ok: false, reason: 'That folder is one of the places Lumina keeps your library in, so it is not removed from here.' };
  if (guarded.some((g) => g.startsWith(t + sep))) return { ok: false, reason: 'That folder holds one of the places Lumina keeps your library in, so it is not removed from here.' };
  if (!roots.map(norm).some((r) => t.startsWith(r + sep))) return { ok: false, reason: 'That folder is outside your library folders.' };
  return { ok: true };
}
