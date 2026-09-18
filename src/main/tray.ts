import { app, Menu, Tray, nativeImage, type MenuItemConstructorOptions, type NativeImage } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AudioOutputDevice } from '../shared/ipc';
import { EQ_PROFILES } from '../core/equalizer';
import {
  downloadItems, idlePlayback, pauseAllOrder, playbackItems, type TrayItem, type TrayPlayback,
} from '../core/trayMenu';
import { iconPath } from './paths';
import { settings } from './settings';
import { mainWindow, showWindow } from './window';
import { queue } from './jobs/queue';
import { logger } from './log';

const log = logger('tray');
let tray: Tray | null = null;
let playback: TrayPlayback = idlePlayback();
let audioOutputs: AudioOutputDevice[] = [];
let lastActive = -1;
let rebuildTimer: NodeJS.Timeout | null = null;

/** Windows exposes pseudo-devices we don't want to list separately from "System default". */
const isRealDevice = (d: AudioOutputDevice) => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications';

/** Submenu to switch the audio output device straight from the tray. */
function audioOutputSubmenu(): MenuItemConstructorOptions[] {
  const selected = settings.get().player.outputDeviceId;
  const items: MenuItemConstructorOptions[] = [
    { label: 'System default', type: 'radio', checked: !selected, click: () => settings.update({ player: { outputDeviceId: '' } }) },
  ];
  const real = audioOutputs.filter(isRealDevice);
  if (real.length) items.push({ type: 'separator' });
  for (const d of real) {
    items.push({
      label: (d.label || 'Audio device').slice(0, 80),
      type: 'radio',
      checked: selected === d.deviceId,
      click: () => settings.update({ player: { outputDeviceId: d.deviceId } }),
    });
  }
  return items;
}

/** Submenu to switch the equalizer profile (or turn it off) straight from the tray. */
function equalizerSubmenu(): MenuItemConstructorOptions[] {
  const p = settings.get().player;
  const items: MenuItemConstructorOptions[] = [
    { label: 'Off', type: 'radio', checked: !p.eqEnabled, click: () => settings.update({ player: { eqEnabled: false } }) },
    { type: 'separator' },
  ];
  for (const prof of EQ_PROFILES) {
    items.push({
      label: prof.name,
      type: 'radio',
      checked: p.eqEnabled && p.eqProfile === prof.id,
      click: () => settings.update({ player: { eqEnabled: true, eqProfile: prof.id } }),
    });
  }
  if (p.eqEnabled && p.eqProfile === 'custom') {
    items.push({ type: 'separator' }, { label: 'Custom (set in the player)', type: 'radio', checked: true, enabled: false });
  }
  return items;
}

/** Loads "name.png" plus "name@2x.png" so the tray stays sharp at 150–200% scaling. */
function trayImage(name: string): NativeImage {
  const img = nativeImage.createFromPath(iconPath(`${name}.png`));
  const hiDpi = iconPath(`${name}@2x.png`);
  if (fs.existsSync(hiDpi)) img.addRepresentation({ scaleFactor: 2, buffer: fs.readFileSync(hiDpi) });
  if (name === 'trayTemplate') img.setTemplateImage(true);
  return img;
}

const baseName = (active: boolean) => (process.platform === 'darwin' ? 'trayTemplate' : active ? 'tray-active' : 'tray');

/** Run a tray item: player commands go to the renderer, download actions are done here. */
function run(item: TrayItem) {
  const r = item.run;
  if (!r) return;
  if ('command' in r) {
    mainWindow()?.webContents.send('player:command', r);
    return;
  }
  if (r.action === 'downloads-pause-all') {
    for (const id of pauseAllOrder(queue.list())) queue.pause(id);
    log.info('Paused all downloads from the tray');
  } else {
    for (const j of queue.list()) if (j.status === 'paused') queue.resume(j.id);
    log.info('Resumed all downloads from the tray');
  }
}

/** Turn the pure menu model (core/trayMenu) into Electron menu items. */
function toMenu(items: TrayItem[]): MenuItemConstructorOptions[] {
  return items.map((i): MenuItemConstructorOptions => {
    if (i.type === 'separator') return { type: 'separator' };
    return {
      label: i.label,
      type: i.submenu ? 'submenu' : (i.type ?? 'normal'),
      checked: i.checked,
      enabled: i.enabled ?? true,
      submenu: i.submenu ? toMenu(i.submenu) : undefined,
      click: i.run ? () => run(i) : undefined,
    };
  });
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
  const all = queue.list();
  const waiting = all.filter((j) => j.status === 'queued').length;
  const paused = all.filter((j) => j.status === 'paused').length;
  const lines = ['Lumina', nowPlaying && `♪ ${nowPlaying}`, active && `${active} download${active > 1 ? 's' : ''} in progress`].filter(Boolean);
  tray.setToolTip(lines.join('\n').slice(0, 127));

  lastActive = active;

  tray.setContextMenu(Menu.buildFromTemplate([
    ...toMenu(playbackItems(playback)),
    { label: 'Audio output', submenu: audioOutputSubmenu() },
    { label: 'Equalizer', submenu: equalizerSubmenu() },
    { type: 'separator' },
    { label: 'Open player', click: () => showWindow('player') },
    { label: 'Open Lumina', click: () => showWindow('downloader') },
    ...toMenu(downloadItems({ active, waiting, paused })),
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
  // Reflect tray-driven (or in-app) audio-output / equalizer changes back in the menu's radio marks.
  settings.on('changed', scheduleRebuild);
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

/** What the tray currently believes about playback — read by the dev capture harness to verify it. */
export const trayPlayback = (): TrayPlayback => playback;

/** The tray's own playback items, exactly as the menu is built from them (dev harness only). */
export const trayPlaybackItems = () => playbackItems(playback);

export function updateTrayPlayback(state: TrayPlayback) {
  playback = state;
  // Coalesced like download progress: a menu that isn't open doesn't need every intermediate state.
  scheduleRebuild();
}

/** The renderer reports the machine's audio outputs so the tray can offer them. */
export function setAudioOutputs(devices: AudioOutputDevice[]) {
  audioOutputs = devices;
  if (tray) scheduleRebuild();
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
