import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

/** Folder holding bundled tools and models: resources/ in development, process.resourcesPath when packaged. */
export function resourcesDir(): string {
  return app.isPackaged ? process.resourcesPath : path.resolve(app.getAppPath(), 'resources');
}

export function bundledBinDir(): string {
  const packaged = path.join(resourcesDir(), 'bin');
  if (app.isPackaged) return packaged;
  return path.join(resourcesDir(), 'bin', `${process.platform}-${process.arch}`);
}

export const bundledModelsDir = () => path.join(resourcesDir(), 'models');
/** Rendered icon set: resources/icons when packaged, assets/icons in development. */
export const iconsDir = () => (app.isPackaged ? path.join(process.resourcesPath, 'icons') : path.resolve(app.getAppPath(), 'assets', 'icons'));
export const iconPath = (file: string) => path.join(iconsDir(), file);
/** Unpacked browser extension ("Load unpacked" in Chrome/Edge points here). */
export const extensionDir = () => (app.isPackaged ? path.join(process.resourcesPath, 'extension') : path.resolve(app.getAppPath(), 'extension'));
export const appIconPath =() => iconPath(process.platform === 'win32' ? 'icon.ico' : 'icon_512.png');

function ensure(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export const dataDir = () => ensure(app.getPath('userData'));
export const updatedBinDir = () => ensure(path.join(dataDir(), 'bin'));
export const downloadedModelsDir = () => ensure(path.join(dataDir(), 'models'));
export const logsDir = () => ensure(path.join(dataDir(), 'logs'));
export const tempDir = () => ensure(path.join(app.getPath('temp'), 'lumina'));
export const artworkCacheDir = () => ensure(path.join(dataDir(), 'artwork'));
export const databaseFile = () => path.join(dataDir(), 'lumina.db');
export const settingsFile = () => path.join(dataDir(), 'settings.json');
export const archiveFile = () => path.join(dataDir(), 'download-archive.txt');

export const exe = (name: string) => (process.platform === 'win32' ? `${name}.exe` : name);
