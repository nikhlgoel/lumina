import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { canTrashFolder } from '@core/trashGuard';

const root = path.resolve('/music');
const other = path.resolve('/downloads');
const at = (...p: string[]) => path.join(root, ...p);

describe('which folders may be moved to the Recycle Bin', () => {
  it('allows a folder inside a library folder', () => {
    expect(canTrashFolder(at('English Songs'), [root], [other], false)).toEqual({ ok: true });
    expect(canTrashFolder(at('Rock', 'Live 1999'), [root], [other], false)).toEqual({ ok: true });
  });

  it('never allows a library folder itself, however it is written', () => {
    for (const t of [root, `${root}${path.sep}`, path.join(root, '.'), path.join(root, 'sub', '..')]) {
      expect(canTrashFolder(t, [root], [other], false).ok, t).toBe(false);
    }
  });

  it('never allows the folders Lumina saves into, or a folder that holds a library folder', () => {
    expect(canTrashFolder(other, [root], [other], false).ok).toBe(false);
    expect(canTrashFolder(path.dirname(root), [root], [other], false).ok).toBe(false);
    expect(canTrashFolder(path.resolve('/'), [root], [other], false).ok).toBe(false);
  });

  it('refuses a folder outside every library folder, and an empty path', () => {
    expect(canTrashFolder(path.resolve('/elsewhere/Songs'), [root], [other], false).ok).toBe(false);
    expect(canTrashFolder('', [root], [other], false).ok).toBe(false);
  });

  it('does not take a sibling that merely starts with the same letters for a folder inside', () => {
    expect(canTrashFolder(`${root}-backup`, [root], [other], false).ok).toBe(false);
    expect(canTrashFolder(`${root}-backup${path.sep}Songs`, [root], [other], false).ok).toBe(false);
  });

  it('ignores letter case when asked (Windows), and only then', () => {
    const upper = at('English Songs').toUpperCase();
    expect(canTrashFolder(root.toUpperCase(), [root], [other], true).ok).toBe(false);
    expect(canTrashFolder(upper, [root], [other], true)).toEqual({ ok: true });
    expect(canTrashFolder(root.toUpperCase(), [root], [other], false).ok).toBe(false); // a different folder, and outside the library
  });

  it('says why in words', () => {
    const v = canTrashFolder(root, [root], [other], false);
    expect(v.ok ? '' : v.reason).toMatch(/places Lumina keeps your library/);
  });
});
