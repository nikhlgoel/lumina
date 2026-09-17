import { app, BrowserWindow, Notification, nativeTheme, screen, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { settings } from './settings';
import { appIconPath, dataDir, iconPath } from './paths';
import { logger } from './log';

const log = logger('window');
export type AppMode = 'downloader' | 'player';

let win: BrowserWindow | null = null;
let mode: AppMode = 'downloader';
let quitting = false;

const boundsFile = () => path.join(dataDir(), 'window.json');

function savedBounds(): Electron.Rectangle | null {
  try {
    const b = JSON.parse(fs.readFileSync(boundsFile(), 'utf8')) as Electron.Rectangle;
    const visible = screen.getAllDisplays().some((d) => b.x < d.workArea.x + d.workArea.width && b.x + b.width > d.workArea.x && b.y < d.workArea.y + d.workArea.height && b.y + b.height > d.workArea.y);
    return visible ? b : null;
  } catch {
    return null;
  }
}

/** Follow Lumina's own theme setting, not just the OS, so caption buttons always contrast with the page. */
function appIsDark(): boolean {
  const colorMode = settings.get().appearance.colorMode;
  return colorMode === 'dark' || (colorMode === 'system' && nativeTheme.shouldUseDarkColors);
}

function overlayColors(m: AppMode) {
  const dark = m === 'player' || appIsDark();
  return { color: '#00000000', symbolColor: dark ? '#E9E4DC' : '#2A251F', height: 44 };
}

export function refreshWindowChrome() {
  nativeTheme.themeSource = settings.get().appearance.colorMode;
  const w = mainWindow();
  if (!w || process.platform === 'darwin') return;
  w.setTitleBarOverlay(overlayColors(mode));
  w.setBackgroundColor(mode === 'player' || appIsDark() ? '#0D0C0B' : '#F4F2EE');
}

export const setQuitting = () => {
  quitting = true;
};

export function mainWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null;
}

export function currentMode(): AppMode {
  return mode;
}

export function createWindow(opts: { show: boolean; mode: AppMode }): BrowserWindow {
  mode = opts.mode;
  nativeTheme.themeSource = settings.get().appearance.colorMode;
  const bounds = savedBounds();
  win = new BrowserWindow({
    width: bounds?.width ?? 1280,
    height: bounds?.height ?? 820,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: appIsDark() || mode === 'player' ? '#0D0C0B' : '#F4F2EE',
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? undefined : overlayColors(mode),
    trafficLightPosition: { x: 16, y: 14 },
    icon: appIconPath(),
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.VITE_DEV_SERVER_URL;
    if (devUrl && url.startsWith(devUrl)) return;
    event.preventDefault();
  });
  win.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(['fullscreen', 'clipboard-read', 'clipboard-sanitized-write', 'media'].includes(permission));
  });

  win.once('ready-to-show', () => {
    if (opts.show) win?.show();
  });

  win.on('close', (event) => {
    const s = settings.get();
    persistBounds();
    if (quitting || !s.general.closeToTray) return;
    event.preventDefault();
    win?.hide();
    if (!s.general.trayNoticeShown) {
      settings.update({ general: { trayNoticeShown: true } });
      if (Notification.isSupported()) {
        new Notification({ title: 'Lumina is still running', body: 'Music and downloads keep going. Open Lumina from the tray icon, or quit it there.', icon: iconPath('icon_256.png') }).show();
      }
    }
  });

  win.on('closed', () => {
    win = null;
  });

  nativeTheme.on('updated', refreshWindowChrome);

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void win.loadURL(`${devUrl}?mode=${mode}`);
  else void win.loadFile(path.join(import.meta.dirname, '../../dist/index.html'), { query: { mode } });

  log.info(`Window created (${mode}, ${opts.show ? 'visible' : 'hidden'})`);
  return win;
}

function persistBounds() {
  if (!win || win.isDestroyed() || win.isMinimized() || win.isMaximized()) return;
  try {
    fs.writeFileSync(boundsFile(), JSON.stringify(win.getBounds()));
  } catch {
    // non-critical
  }
}

export function setMode(next: AppMode) {
  mode = next;
  settings.update({ general: { lastMode: next } });
  const w = mainWindow();
  if (!w) return;
  refreshWindowChrome();
  w.webContents.send('app:mode', { mode: next });
}

export function showWindow(next?: AppMode) {
  const w = mainWindow() ?? createWindow({ show: true, mode: next ?? mode });
  if (next && next !== mode) setMode(next);
  if (w.isMinimized()) w.restore();
  w.show();
  w.focus();
}
