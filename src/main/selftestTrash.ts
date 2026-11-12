// Development-only: deleting a playlist from the Library moves its folder to the real Recycle Bin, and never a library folder itself.
// Needs a scratch library (LUMINA_LIB_ROOT) with real audio in a folder and one loose file directly in the root.
import fs from 'node:fs';
import { library } from './library';
import { settings } from './settings';

const out = (m: string) => {
  const line = `[selftest] ${m}\n`;
  process.stdout.write(line);
  if (process.env.LUMINA_SELFTEST_LOG) { try { fs.appendFileSync(process.env.LUMINA_SELFTEST_LOG, line); } catch { /* best effort */ } }
};

export async function runTrashSelftest(): Promise<void> {
  const root = process.env.LUMINA_LIB_ROOT ?? '';
  let ok = 0;
  let total = 0;
  const check = (name: string, pass: boolean, detail = '') => {
    total++;
    if (pass) ok++;
    out(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  };
  settings.update({ storage: { libraryRoots: [root], musicDir: root, videoDir: root, seriesDir: root, otherDir: root } });
  await library.scan();
  await new Promise((r) => setTimeout(r, 6000));
  const lists = library.playlists();
  out(`playlists: ${lists.map((p) => `${p.source}:${p.name}(${p.itemCount})`).join(' | ')}`);
  const rootList = lists.find((p) => p.source === 'folder' && p.path.toLowerCase() === root.toLowerCase());
  const target = lists.find((p) => p.source === 'folder' && p.name.startsWith('Lumina trash test'));
  // Only when a folder to delete was put there (a second run can check just the refusal, and put nothing more in the Recycle Bin).
  if (!process.env.LUMINA_TRASH_REFUSAL_ONLY) check('the scratch library has a folder playlist to delete', Boolean(target) && (target?.itemCount ?? 0) >= 2, target ? `${target.name}: ${target.itemCount} songs` : 'none');
  // The scanner never lists a library folder as a playlist, so the refusal below is a second line of defence (it has its own unit tests).
  out(`a library folder is ${rootList ? 'listed as a playlist (the refusal below is exercised)' : 'never listed as a playlist, as designed'}`);

  if (rootList) {
    const refused = await library.trashPlaylist(rootList.id);
    check('deleting the library folder itself is refused, with a reason', !refused.ok && Boolean(refused.message), refused.message ?? '');
    check('and nothing was removed', fs.existsSync(root) && fs.readdirSync(root).length > 0);
  }
  if (target) {
    const folder = target.path;
    const done = await library.trashPlaylist(target.id);
    check('deleting a folder playlist succeeds', done.ok, done.message ?? '');
    check('its folder is gone from the disk (it is in the Recycle Bin)', !fs.existsSync(folder));
    check('the library no longer lists it', !library.playlists().some((p) => p.id === target.id));
    await new Promise((r) => setTimeout(r, 6000));
    check('after the rescan its songs are gone from the library too', library.items({}).every((i) => !i.path.startsWith(folder)));
    const again = await library.trashPlaylist(target.id);
    check('deleting it twice is harmless', !again.ok, again.message ?? '');
  }
  out(`${ok}/${total} checks passed`);
}
