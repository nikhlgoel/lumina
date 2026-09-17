import { app, Menu, Tray, nativeImage, type NativeImage } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { iconPath } from './paths';
import { mainWindow, showWindow } from './window';
import { queue } from './jobs/queue';
import { logger } from './log';

const log = logger('tray');
let tray: Tray | null = null;
let playback = { playing: false, title: null as string | null, artist: null as string | null };
let lastActive = -1;
let rebuildTimer: NodeJS.Timeout | null = null;

/** Loads "name.png" plus "name@2x.png" so the tray stays sharp at 150–200% scaling. */
function trayImage(name: string): NativeImage {
  const img = nativeImage.createFromPath(iconPath(`${name}.png`));
  const hiDpi = iconPath(`${name}@2x.png`);
  if (fs.existsSync(hiDpi)) img.addRepresentation({ scaleFactor: 2, buffer: fs.readFileSync(hiDpi) });
  if (name === 'trayTemplate') img.setTemplateImage(true);
  return img;
}

const baseName = (active: boolean) => (process.platform === 'darwin' ? 'trayTemplate' : active ? 'tray-active' : 'tray');

function sendCommand(command: 'toggle' | 'next' | 'previous') {
  mainWindow()?.webContents.send('player:command', { command });
}

function activeJobs() {
  return queue.list().filter((j) => j.status === 'running' || j.status === 'processing');
}

/** Windows taskbar button progress, like Explorer's copy dialog. */
function updateTaskbar(jobs: ReturnType<typeof activeJobs>) {
  const win = mainWindow();
  if (!win) return;
  if (!jobs.length) {
    win.setProgressBar(-1);
    return;
  }
  const avg = jobs.reduce((s, j) => s + j.progress.percent, 0) / jobs.length / 100;
  const indeterminate = jobs.every((j) => j.progress.percent <= 0);
  win.setProgressBar(indeterminate ? 2 : Math.max(0.01, avg), { mode: indeterminate ? 'indeterminate' : 'normal' });
}

function rebuild() {
  if (!tray) return;
  const jobs = activeJobs();
  const active = jobs.length;
  updateTaskbar(jobs);

  if ((active > 0) !== (lastActive > 0) || lastActive === -1) tray.setImage(trayImage(baseName(active > 0)));
  const nowPlaying = playback.title ? `${playback.title}${playback.artist ? ` — ${playback.artist}` : ''}` : null;
  const lines = ['Lumina', nowPlaying && `♪ ${nowPlaying}`, active && `${active} download${active > 1 ? 's' : ''} in progress`].filter(Boolean);
  tray.setToolTip(lines.join('\n').slice(0, 127));

  lastActive = active;

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: nowPlaying ? (nowPlaying.length > 48 ? `${nowPlaying.slice(0, 45)}…` : nowPlaying) : 'Nothing playing', enabled: false },
    { label: playback.playing ? 'Pause' : 'Play', enabled: Boolean(playback.title), click: () => sendCommand('toggle') },
    { label: 'Next', enabled: Boolean(playback.title), click: () => sendCommand('next') },
    { label: 'Previous', enabled: Boolean(playback.title), click: () => sendCommand('previous') },
    { type: 'separator' },
    { label: 'Open player', click: () => showWindow('player') },
    { label: 'Open Lumina', click: () => showWindow('downloader') },
    { label: active ? `${active} download${active > 1 ? 's' : ''} in progress` : 'No active downloads', enabled: false },
    { type: 'separator' },
    { label: 'Quit Lumina', role: 'quit', click: () => app.quit() },
  ]));
}

/** Progress events arrive many times a second; the tray only needs a few updates. */
function scheduleRebuild() {
  if (rebuildTimer) return;
  rebuildTimer = setTimeout(() => {
    rebuildTimer = null;
    rebuild();
  }, 700);
}

export function createTray() {
  if (tray) return;
  tray = new Tray(trayImage(baseName(false)));
  tray.on('click', () => showWindow());
  tray.on('double-click', () => showWindow('player'));
  queue.on('updated', scheduleRebuild);
  rebuild();

  if (process.platform === 'win32') {
    // Taskbar jump list (right-click the taskbar button).
    app.setUserTasks([
      { program: process.execPath, arguments: app.isPackaged ? '--player' : `${process.argv[1] ?? '.'} --player`, iconPath: process.execPath, iconIndex: 0, title: 'Open player', description: 'Open Lumina straight into the player' },
      { program: process.execPath, arguments: app.isPackaged ? '--paste' : `${process.argv[1] ?? '.'} --paste`, iconPath: process.execPath, iconIndex: 0, title: 'Download copied link', description: 'Start a download from the link on your clipboard' },
    ]);
  }
  log.info('Tray ready');
}

export function updateTrayPlayback(state: typeof playback) {
  playback = state;
  rebuild();
}

/** Start with system, launching hidden in the tray. */
export function applyLoginItem(enabled: boolean) {
  if (process.platform === 'linux') {
    const dir = path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'autostart');
    const file = path.join(dir, 'lumina.desktop');
    if (!enabled) {
      fs.rmSync(file, { force: true });
      return;
    }
    const exec = process.env.APPIMAGE ?? process.execPath;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, `[Desktop Entry]\nType=Application\nName=Lumina\nIcon=lumina\nExec="${exec}" --hidden\nX-GNOME-Autostart-enabled=true\n`);
    return;
  }
  if (!app.isPackaged) return; // avoid registering the dev Electron binary
  app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] });
}
