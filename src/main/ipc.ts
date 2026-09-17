import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {
  inputSchemas, type DiskUsage, type EventChannel, type EventPayloads, type ExtensionStatus, type InvokeChannel, type InvokeOutputs, type SpotifyStatus,
} from '../shared/ipc';
import type { DownloadOptions, FormatChoice, MediaInfo, PlayableItem, RequestInfo } from '../shared/types';
import type { SettingsPatch } from '../shared/settings';
import { applyFormatPreferences, BUILT_IN_PRESETS } from '../core/presets';
import { mediaKindOf } from '../core/playlists';
import { settings } from './settings';
import { tools } from './tools';
import { inspect } from './inspect';
import { queue } from './jobs/queue';
import { runTool } from './process';
import { challengeAction, currentChallenge, placeChallenge } from './hosters';
import { queueConversion, queueSubtitleGeneration } from './jobs/cpu';
import { library } from './library';
import { getLyrics } from './lyrics';
import { MEDIA_SCHEME } from './media/protocol';
import { currentMode, mainWindow, setMode } from './window';
import { updateTrayPlayback } from './tray';
import { listAccounts, signIn, signOut } from './services/accounts';
import { connectSpotify, disconnectSpotify, SPOTIFY_REDIRECT, spotifyStatus } from './services/spotify';
import { bridge, pairedBrowsers, revokeBrowser } from './bridge/server';
import { shortcutStatus } from './shortcuts';
import { database } from './db';
import { artworkCacheDir, extensionDir, logsDir } from './paths';
import { logger } from './log';

const log = logger('ipc');

type Handler<K extends InvokeChannel> = (input: never) => Promise<InvokeOutputs[K]> | InvokeOutputs[K];

export function broadcast<K extends EventChannel>(channel: K, payload: EventPayloads[K]) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

/** Resume point for long media only; short songs always start from the beginning. */
function resumePoint(id: string, path: string, durationSec: number | null): number | undefined {
  if (!settings.get().player.resumePosition || !durationSec || durationSec < 600) return undefined;
  const pos = library.getPosition(path);
  return pos && pos > 15 && pos < durationSec - 20 ? pos : undefined;
}

function toPlayable(id: string): PlayableItem | null {
  const item = library.getById(id);
  if (!item) return null;
  return {
    id: item.id, kind: item.kind, title: item.title, artist: item.artist, album: item.album, durationSec: item.durationSec,
    src: `${MEDIA_SCHEME}://media/${item.id}`, artworkUrl: `${MEDIA_SCHEME}://art/${item.id}`, path: item.path,
    resumeAtSec: resumePoint(item.id, item.path, item.durationSec),
  };
}

function outputDirFor(info: MediaInfo, contentType: 'music' | 'video' | 'series'): string {
  const s = settings.get().storage;
  if (info.sourceKind === 'direct' || info.sourceKind === 'torrent') return s.otherDir;
  return contentType === 'music' ? s.musicDir : contentType === 'series' ? s.seriesDir : s.videoDir;
}

function assertKnownPath(p: string) {
  if (!library.isAllowedPath(p) && !queue.list().some((j) => j.outputPaths.includes(p) || j.outputDir === p)) {
    throw new Error('Lumina can only open files from your library or downloads.');
  }
}

const withParent = <T extends Electron.OpenDialogOptions | Electron.SaveDialogOptions>(opts: T) => ({ win: mainWindow(), opts });

export function extensionStatus(): ExtensionStatus {
  const s = settings.get().extension;
  return {
    running: s.enabled, port: s.port, folder: extensionDir(),
    paired: pairedBrowsers().map(({ id, browser, createdAt, lastUsedAt }) => ({ id, browser, createdAt, lastUsedAt })),
  };
}

const spotify = (): SpotifyStatus => ({ ...spotifyStatus(), redirectUri: SPOTIFY_REDIRECT });

// The exact list of sites the bundled yt-dlp can handle, cached after the first call.
let sitesCache: string[] | null = null;
async function supportedSites(): Promise<string[]> {
  if (sitesCache) return sitesCache;
  const r = await runTool(tools.require('yt-dlp'), ['--list-extractors'], { env: tools.env(), timeoutMs: 60_000 });
  const names = r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  sitesCache = [...new Set(names)]
    .filter((n) => n.toLowerCase() !== 'generic' && !/^testurl/i.test(n))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  return sitesCache;
}

function dirSize(dir: string): number {
  let total = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      total += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
    }
  } catch {
    // missing folder
  }
  return total;
}

const handlers: { [K in InvokeChannel]: Handler<K> } = {
  'app:info': () => ({ version: app.getVersion(), platform: process.platform, isPackaged: app.isPackaged, startMode: currentMode() }),
  'app:open-logs': async () => {
    await shell.openPath(logsDir());
  },
  'app:shortcut-status': () => shortcutStatus(),

  'tools:status': () => tools.list(),
  'tools:update-ytdlp': () => tools.updateYtdlp(),
  'tools:supported-sites': () => supportedSites(),

  'settings:get': () => settings.get(),
  'settings:update': (patch: SettingsPatch) => settings.update(patch),
  'settings:reset': ({ section }: { section?: string }) => settings.reset(section),
  'settings:export': async () => {
    const { win, opts } = withParent({ title: 'Export settings', defaultPath: 'lumina-settings.json', filters: [{ name: 'Lumina settings', extensions: ['json'] }] });
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, JSON.stringify({ ...settings.get(), updates: { ...settings.get().updates, lastYtdlpCheck: 0 } }, null, 2));
    return r.filePath;
  },
  'settings:import': async () => {
    const { win, opts } = withParent({ title: 'Import settings', properties: ['openFile'] as const, filters: [{ name: 'Lumina settings', extensions: ['json'] }] });
    const r = win ? await dialog.showOpenDialog(win, { ...opts, properties: ['openFile'] }) : await dialog.showOpenDialog({ ...opts, properties: ['openFile'] });
    const file = r.filePaths[0];
    if (r.canceled || !file) return null;
    let data: unknown;
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      throw new Error('That file isn’t a Lumina settings file.');
    }
    return settings.replace(data);
  },

  'presets:list': () => BUILT_IN_PRESETS,

  'media:inspect': ({ url, request }: { url: string; request?: RequestInfo }) => inspect(url, request),

  'jobs:list': () => queue.list(),
  'jobs:add': ({ url, info, options }: { url: string; info: MediaInfo; options: DownloadOptions }) => {
    if (!info || typeof info !== 'object' || typeof info.sourceKind !== 'string') throw new Error('Inspect the link before downloading.');
    const format = applyFormatPreferences(options.format, settings.get().formats);
    return queue.addFromInfo(url, info, { ...options, format }, options.targetDir || outputDirFor(info, options.contentType));
  },
  'jobs:pause': ({ id }: { id: string }) => queue.pause(id),
  'jobs:resume': ({ id }: { id: string }) => queue.resume(id),
  'jobs:cancel': ({ id }: { id: string }) => queue.cancel(id),
  'jobs:retry': ({ id }: { id: string }) => queue.retry(id),
  'jobs:remove': ({ id }: { id: string }) => queue.remove(id),
  'jobs:clear-finished': () => queue.clearFinished(),
  'hosts:challenge-current': () => currentChallenge(),
  'hosts:challenge-frame': ({ id, ...rect }: { id: string; x: number; y: number; width: number; height: number }) => placeChallenge(id, rect),
  'hosts:challenge-action': ({ id, action }: { id: string; action: 'reload' | 'skip' }) => challengeAction(id, action),
  'jobs:convert': ({ paths, format }: { paths: string[]; format: FormatChoice }) => {
    paths.forEach(assertKnownPath);
    return queueConversion(paths, format);
  },
  'subtitles:generate': ({ path: p }: { path: string }) => {
    assertKnownPath(p);
    if (mediaKindOf(p) !== 'video') throw new Error('Subtitles can only be generated for video files.');
    return queueSubtitleGeneration(p);
  },

  'library:stats': () => library.stats(),
  'library:items': (q: { kind?: 'audio' | 'video'; playlistId?: string; query?: string }) => library.items(q),
  'library:playlists': () => library.playlists(),
  'library:rescan': () => {
    void library.scan();
  },

  'player:resolve': ({ ids }: { ids: string[] }) => ids.map(toPlayable).filter((x): x is PlayableItem => Boolean(x)),
  'player:resolve-path': async ({ path: p }: { path: string }) => {
    assertKnownPath(p);
    const item = await library.ingest(p);
    const playable = item ? toPlayable(item.id) : null;
    if (!playable) throw new Error('This file can’t be played.');
    return playable;
  },
  'player:state': (state: { playing: boolean; title: string | null; artist: string | null }) => updateTrayPlayback(state),
  'player:save-position': ({ id, positionSec }: { id: string; positionSec: number }) => {
    const item = library.getById(id);
    if (item) library.savePosition(item.path, positionSec);
  },

  'lyrics:get': (q: { title: string; artist: string | null; durationSec: number | null; path: string | null }) => {
    if (q.path && !library.isAllowedPath(q.path)) q.path = null;
    return getLyrics(q);
  },

  'accounts:list': () => listAccounts(),
  'accounts:sign-in': ({ target }: { target: string }) => signIn(mainWindow(), target),
  'accounts:sign-out': async ({ domain }: { domain: string }) => {
    await signOut(domain);
    return listAccounts();
  },
  'accounts:import-cookies': async () => {
    const opts: Electron.OpenDialogOptions = { title: 'Choose a cookies.txt file', properties: ['openFile'], filters: [{ name: 'Cookies', extensions: ['txt'] }] };
    const win = mainWindow();
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    const file = r.filePaths[0];
    if (r.canceled || !file) return null;
    const head = fs.readFileSync(file, 'utf8').slice(0, 4000);
    if (!/^# (Netscape )?HTTP Cookie File/m.test(head) && !/\t(TRUE|FALSE)\t/.test(head)) {
      throw new Error('That doesn’t look like a cookies.txt file (Netscape format).');
    }
    settings.update({ network: { cookiesFrom: 'file', cookiesFile: file } });
    return file;
  },

  'spotify:status': () => spotify(),
  'spotify:connect': async () => {
    await connectSpotify(mainWindow());
    return spotify();
  },
  'spotify:disconnect': () => {
    disconnectSpotify();
    return spotify();
  },

  'extension:status': () => extensionStatus(),
  'extension:revoke': ({ id }: { id: string }) => {
    revokeBrowser(id);
    return extensionStatus();
  },
  'extension:open-folder': async () => {
    const dir = extensionDir();
    if (!fs.existsSync(dir)) throw new Error('The extension files are missing from this installation.');
    await shell.openPath(dir);
  },

  'storage:usage': async () => {
    const s = settings.get().storage;
    const dirs: [string, string][] = [['Music', s.musicDir], ['Videos', s.videoDir], ['Files and torrents', s.otherDir]];
    const out: DiskUsage[] = [];
    for (const [label, dir] of dirs) {
      // Walk up to the nearest existing folder so a not-yet-created download folder still reports its drive.
      let probe = dir;
      while (probe && !fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
      try {
        const st = await fs.promises.statfs(probe);
        out.push({ label, path: dir, freeBytes: st.bavail * st.bsize, totalBytes: st.blocks * st.bsize });
      } catch {
        out.push({ label, path: dir, freeBytes: null, totalBytes: null });
      }
    }
    return out;
  },
  'cache:sizes': () => ({
    artworkBytes: dirSize(artworkCacheDir()),
    lyricsEntries: (database().prepare('SELECT COUNT(*) AS n FROM lyrics_cache').get() as { n: number }).n,
  }),
  'cache:clear': ({ what }: { what: 'artwork' | 'lyrics' }) => {
    if (what === 'artwork') {
      fs.rmSync(artworkCacheDir(), { recursive: true, force: true });
      artworkCacheDir();
    } else {
      database().prepare('DELETE FROM lyrics_cache').run();
    }
  },

  'shell:open-path': async ({ path: p }: { path: string }) => {
    assertKnownPath(p);
    const err = await shell.openPath(p);
    if (err) throw new Error(err);
  },
  'shell:show-in-folder': ({ path: p }: { path: string }) => {
    assertKnownPath(p);
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) void shell.openPath(p);
    else shell.showItemInFolder(p);
  },
  'dialog:pick-folder': async ({ title }: { title?: string }) => {
    const w = mainWindow();
    const r = w ? await dialog.showOpenDialog(w, { title, properties: ['openDirectory', 'createDirectory'] }) : await dialog.showOpenDialog({ title, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0] ?? null;
  },
  'dialog:pick-torrents': async () => {
    const w = mainWindow();
    const opts: Electron.OpenDialogOptions = { title: 'Open torrent files', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Torrent files', extensions: ['torrent'] }] };
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
    return r.canceled ? [] : r.filePaths;
  },

  'window:set-mode': ({ mode }: { mode: 'downloader' | 'player' }) => setMode(mode),
  'window:minimize': () => mainWindow()?.minimize(),
  'window:toggle-maximize': () => {
    const w = mainWindow();
    if (w) (w.isMaximized() ? w.unmaximize() : w.maximize());
  },
  'window:close': () => mainWindow()?.close(),
};

export function registerIpc() {
  for (const channel of Object.keys(handlers) as InvokeChannel[]) {
    ipcMain.handle(channel, async (event, payload: unknown) => {
      // Only our own window may call in.
      const origin = event.senderFrame?.url ?? '';
      if (!origin.startsWith('file://') && !(process.env.VITE_DEV_SERVER_URL && origin.startsWith(process.env.VITE_DEV_SERVER_URL))) {
        throw new Error('Blocked request from an unknown page.');
      }
      const schema = inputSchemas[channel];
      const parsed = schema.safeParse(payload);
      if (!parsed.success) {
        log.warn(`Invalid input for ${channel}`, parsed.error.issues);
        throw new Error('Invalid request.');
      }
      try {
        return await (handlers[channel] as (input: unknown) => unknown)(parsed.data);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn(`${channel} failed: ${message}`);
        throw new Error(message);
      }
    });
  }

  queue.on('updated', (job) => broadcast('jobs:updated', job));
  queue.on('removed', (id) => broadcast('jobs:removed', { id }));
  settings.on('changed', (s) => broadcast('settings:changed', s));
  library.on('changed', (stats) => broadcast('library:changed', stats));
  tools.on('changed', (list) => broadcast('tools:changed', list));
  void bridge;
}
