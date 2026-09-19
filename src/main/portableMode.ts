// Portable mode: keep everything on the stick.
//
// **Import order matters more than anything else in this file.** `app.setPath('userData', …)` must
// happen before any module reads a path — settings, the database, the log file and the artwork
// cache all derive from userData at import time. So `src/main/index.ts` imports this module first,
// and ES modules are evaluated in import order, which makes that a guarantee rather than a hope.
//
// Turning it on (any one of these):
//   * run the portable build — electron-builder sets `PORTABLE_EXECUTABLE_DIR` to the folder the
//     .exe was launched from;
//   * drop a `lumina-portable.txt` next to the executable, for a copied folder;
//   * set `LUMINA_PORTABLE=<dir>` explicitly.
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { PORTABLE_DATA_DIR, portableDataPath } from '../core/portableApp';

let portableRoot: string | null = null;

/** The data folder on the drive, or null when this is an ordinary installed copy. */
export const portableDir = (): string | null => portableRoot;
export const runningPortable = (): boolean => portableRoot !== null;

const target = portableDataPath({
  portableExecutableDir: process.env.PORTABLE_EXECUTABLE_DIR,
  override: process.env.LUMINA_PORTABLE,
  execDir: path.dirname(app.getPath('exe')),
  exists: (p) => fs.existsSync(p),
  join: (...parts) => path.join(...parts),
});

if (target) {
  try {
    fs.mkdirSync(target, { recursive: true });
    app.setPath('userData', target);
    // Chromium's own caches are large and rewritten constantly; keeping them beside the data means
    // nothing is left behind on a borrowed PC.
    app.setPath('sessionData', path.join(target, 'Session'));
    portableRoot = target;
    // No logger yet — it is configured from a path that has only just been decided.
    process.stdout.write(`[portable] Using ${target} for all data\n`);
  } catch (err) {
    // A read-only or full stick must not stop the app starting; fall back to the normal location.
    const reason = err instanceof Error ? err.message : String(err);
    process.stdout.write(`[portable] Could not use ${target}, falling back to the usual folder: ${reason}\n`);
    portableRoot = null;
  }
}

export { PORTABLE_DATA_DIR };
