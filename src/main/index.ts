import { app, dialog, Notification, shell } from 'electron';
import fs from 'node:fs';
import type { RequestInfo } from '../shared/types';
import { settings } from './settings';
import { setVerboseLogging, logger } from './log';
import { tools } from './tools';
import { database, closeDatabase } from './db';
import { queue } from './jobs/queue';
import { ytdlpRunner } from './jobs/ytdlp';
import { aria2, aria2Runner } from './jobs/aria2';
import { convertRunner, subtitlesRunner } from './jobs/cpu';
import { extractRunner, watchReleases } from './jobs/release';
import { library } from './library';
import { routeFinishedToDrive } from './usb';
import { shutdownMcp } from './ide/mcp';
import { shutdownTerminals } from './ide/terminal';
import { handleMediaProtocol, registerMediaScheme } from './media/protocol';
import { broadcast, extensionStatus, registerIpc } from './ipc';
import { createWindow, mainWindow, refreshWindowChrome, setQuitting, showWindow, type AppMode } from './window';
import { applyLoginItem, createTray } from './tray';
import { bridge } from './bridge/server';
import { applyGlobalShortcut, watchClipboard } from './shortcuts';
import { watchQueuePower } from './power';
import { iconPath } from './paths';
import { takeOverDownload } from './bridge/handoff';
import { browserEvents } from './browser';
import type { Job } from '../shared/types';

/**
 * Tag downloaded files with Windows' Mark of the Web, exactly as browsers do,
 * so SmartScreen and Office Protected View still protect the user.
 */
function markFromInternet(job: Job) {
  if (process.platform !== 'win32' || !/^https?:/i.test(job.url)) return;
  const referrer = job.source.request?.pageUrl;
  const zone = `[ZoneTransfer]\r\nZoneId=3\r\n${referrer && /^https?:/i.test(referrer) ? `ReferrerUrl=${referrer.split('#')[0]}\r\n` : ''}HostUrl=${job.url.split('#')[0]}\r\n`;
  for (const p of job.outputPaths) {
    try {
      if (fs.statSync(p).isFile()) fs.writeFileSync(`${p}:Zone.Identifier`, zone);
    } catch {
      // non-NTFS drives (FAT32 USB sticks) don't support alternate data streams
    }
  }
}

const log = logger('app');

// Some shells (VS Code's terminal) leak this; it would turn child Electron instances into Node.
delete process.env.ELECTRON_RUN_AS_NODE;

registerMediaScheme();

/** Bring Lumina forward with a link ready to inspect. */
function openLink(url: string, source: 'extension' | 'clipboard' | 'system', request?: RequestInfo) {
  showWindow('downloader');
  const send = () => broadcast('app:open-url', { url, request, source });
  const wc = mainWindow()?.webContents;
  if (wc?.isLoading()) wc.once('did-finish-load', send);
  else send();
}

// A download started in the in-app browser is caught and handed to the downloader to pick a format and pull it.
browserEvents.on('download', (dl) => openLink(dl.url, 'system'));

function notify(title: string, body: string, onClick?: () => void) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: iconPath('icon_256.png'), silent: !settings.get().general.completionSound });
  if (onClick) n.on('click', onClick);
  n.show();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId('com.lumina.media');
  for (const scheme of ['magnet', 'lumina']) {
    if (process.defaultApp && process.argv[1]) app.setAsDefaultProtocolClient(scheme, process.execPath, [process.argv[1]]);
    else app.setAsDefaultProtocolClient(scheme);
  }

  const linkFromArgv = (argv: string[]) => {
    const raw = argv.find((a) => /^(magnet:\?|lumina:\/\/)/i.test(a) || (/\.torrent$/i.test(a) && fs.existsSync(a)));
    // lumina://download?url=... lets web pages and the extension hand links over without the bridge.
    if (raw?.startsWith('lumina://')) {
      try {
        return new URL(raw).searchParams.get('url');
      } catch {
        return null;
      }
    }
    return raw ?? null;
  };

  app.on('second-instance', (_e, argv) => {
    const link = linkFromArgv(argv);
    if (link) return openLink(link, 'system');
    if (argv.includes('--paste')) return broadcast('app:navigate', { view: 'download', section: 'paste' });
    showWindow(argv.includes('--player') ? 'player' : undefined);
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    const link = linkFromArgv([url]);
    if (link) openLink(link, 'system');
  });

  app.whenReady().then(async () => {
    const s = settings.load();
    setVerboseLogging(s.advanced.verboseLogs);
    database();
    handleMediaProtocol();

    queue.register('ytdlp', ytdlpRunner);
    queue.register('aria2', aria2Runner);
    queue.register('convert', convertRunner);
    queue.register('subtitles', subtitlesRunner);
    queue.register('extract', extractRunner);
    queue.load();
    watchReleases();
    registerIpc();

    const argv = process.argv;
    const hidden = argv.includes('--hidden') || s.general.startMode === 'tray';
    const mode: AppMode = argv.includes('--player') || s.general.startMode === 'player'
      ? 'player'
      : s.general.startMode === 'last' ? s.general.lastMode : 'downloader';

    if (!app.isPackaged && process.env.LUMINA_SELFTEST) {
      const { runSelftest } = await import('./selftest');
      await runSelftest().catch((err) => log.error('Selftest failed', err));
      setQuitting();
      queue.shutdown();
      aria2.stop();
      app.exit(0);
      return;
    }

    // Screenshot runs render offscreen and never show a window. The user was watching something while
    // earlier capture runs kept popping Lumina over it. A plain hidden window is not enough: it stops
    // painting after the first frame, so the screenshots came back stale (see createWindow).
    const capturing = !app.isPackaged && !!process.env.LUMINA_CAPTURE;
    // Metrics runs use a plain hidden window (not offscreen), so memory reflects a normal window.
    const measuring = !app.isPackaged && !!process.env.LUMINA_METRICS;
    const win = createWindow({ show: !hidden && !capturing && !measuring, mode, offscreen: capturing });
    createTray();

    if (!app.isPackaged && process.env.LUMINA_CAPTURE) {
      const dir = process.env.LUMINA_CAPTURE;
      win.setSize(1360, 860);
      win.webContents.on('console-message', (e) => process.stdout.write(`[renderer:${e.level}] ${e.message}\n`));
      win.webContents.on('preload-error', (_e, p, err) => process.stdout.write(`[preload-error] ${p} ${err.stack}\n`));
      win.webContents.on('did-fail-load', (_e, code, desc, url) => process.stdout.write(`[did-fail-load] ${code} ${desc} ${url}\n`));
      win.webContents.once('did-finish-load', async () => {
        const { runCapture } = await import('./capture');
        await runCapture(win, dir).catch((err) => log.error('Capture failed', err));
        setQuitting();
        app.quit();
      });
    }
    if (measuring) {
      const file = process.env.LUMINA_METRICS!;
      win.setSize(1360, 860);
      win.webContents.once('did-finish-load', async () => {
        const { runMetrics } = await import('./metrics');
        await runMetrics(win, file).catch((err) => log.error('Metrics failed', err));
        setQuitting();
        app.quit();
      });
    }
    applyLoginItem(s.general.startWithSystem);

    const initialLink = linkFromArgv(argv);
    if (initialLink) win.webContents.once('did-finish-load', () => broadcast('app:open-url', { url: initialLink, source: 'system' }));
    if (argv.includes('--paste')) win.webContents.once('did-finish-load', () => broadcast('app:navigate', { view: 'download', section: 'paste' }));

    // Browser extension bridge
    const startBridge = () => bridge.start({
      window: mainWindow,
      onCapture: async (c, signal) => {
        // Downloads the browser started go straight to the queue; menu and popup picks open Lumina to choose a format.
        log.info(`Capture from browser (${c.kind}): ${c.filename ?? ''} ${c.url.slice(0, 160)} [${c.request.cookies.length} cookies, headers: ${Object.keys(c.request.headers).join(',')}]`);
        if (c.kind === 'file' && settings.get().extension.browserDownloads === 'auto') return takeOverDownload(c, signal);
        openLink(c.url, 'extension', c.request);
        return { accepted: true };
      },
      onPaired: () => broadcast('extension:changed', extensionStatus()),
    });
    startBridge();

    applyGlobalShortcut((url) => (url ? openLink(url, 'clipboard') : showWindow('downloader')));
    watchClipboard((url) => {
      const w = mainWindow();
      if (w?.isVisible() && w.isFocused()) broadcast('app:clipboard-link', { url });
      else notify('Download copied link?', url.length > 90 ? `${url.slice(0, 87)}…` : url, () => openLink(url, 'clipboard'));
    });
    watchQueuePower();

    await tools.probeAll();
    queue.schedule();
    void library.scan().then(() => library.watch());
    void tools.autoUpdate();

    queue.on('completed', (job) => {
      markFromInternet(job);
      for (const p of job.outputPaths) void library.ingest(p);
      // With "send new downloads to the drive" on, copy the finished file across now that it's
      // whole — never during the download, which a USB stick is too slow to keep up with.
      void routeFinishedToDrive(job.outputPaths).catch(() => {});
      const cur = settings.get();
      const target = job.outputPaths[0] ?? job.outputDir;
      const quietBrowserFile = job.origin === 'browser' && (job.progress.totalBytes ?? 0) < 25 * 1024 * 1024;
      if (cur.downloads.afterDownload === 'reveal' && target && job.origin !== 'browser') shell.showItemInFolder(target);
      const w = mainWindow();
      if (cur.general.notifyOnComplete && !quietBrowserFile && (!w || !w.isVisible() || !w.isFocused())) {
        notify('Download complete', job.title, () => (target ? shell.showItemInFolder(target) : showWindow('downloader')));
      }
    });
    queue.on('failed', (job) => {
      const w = mainWindow();
      if (settings.get().general.notifyOnFail && (!w || !w.isVisible() || !w.isFocused())) {
        notify('Download failed', `${job.title}: ${job.error?.message ?? 'unknown error'}`, () => {
          showWindow('downloader');
          broadcast('app:navigate', { view: 'queue' });
        });
      }
    });

    let previous = s;
    settings.on('changed', (next) => {
      if (next.general.startWithSystem !== previous.general.startWithSystem) applyLoginItem(next.general.startWithSystem);
      if (next.appearance.colorMode !== previous.appearance.colorMode) refreshWindowChrome();
      if (next.general.globalShortcut !== previous.general.globalShortcut || next.general.globalShortcutEnabled !== previous.general.globalShortcutEnabled) {
        applyGlobalShortcut((url) => (url ? openLink(url, 'clipboard') : showWindow('downloader')));
      }
      if (next.extension.enabled !== previous.extension.enabled || next.extension.port !== previous.extension.port) startBridge();
      if (next.library.watchFolders !== previous.library.watchFolders || next.storage.libraryRoots.join() !== previous.storage.libraryRoots.join()) {
        void library.scan().then(() => library.watch());
      }
      if (next.torrents !== previous.torrents || next.network !== previous.network) {
        // Most aria2 options only apply at start; restart it when idle, otherwise update what can change live.
        if (!queue.list().some((j) => j.engine === 'aria2' && (j.status === 'running' || j.status === 'processing'))) aria2.stop();
        else void aria2.applySettings();
      }
      if (next.downloads !== previous.downloads) void aria2.applySettings();
      setVerboseLogging(next.advanced.verboseLogs);
      queue.schedule();
      previous = next;
    });
  }).catch((err) => {
    log.error('Startup failed', err);
    app.exit(1);
  });

  // Closing the last window keeps Lumina in the tray; quitting happens from the tray menu.
  app.on('window-all-closed', () => {
    if (!settings.get().general.closeToTray) app.quit();
  });

  app.on('activate', () => showWindow());

  let confirmedQuit = false;
  app.on('before-quit', (event) => {
    const active = queue.list().filter((j) => j.status === 'running' || j.status === 'processing').length;
    if (!confirmedQuit && active > 0 && settings.get().general.confirmQuitWithDownloads && !process.env.LUMINA_CAPTURE && !process.env.LUMINA_METRICS) {
      event.preventDefault();
      const win = mainWindow();
      const opts = {
        type: 'question' as const, buttons: ['Quit', 'Keep downloading'], defaultId: 1, cancelId: 1, noLink: true,
        title: 'Quit Lumina?', message: `${active} download${active > 1 ? 's are' : ' is'} still running.`,
        detail: 'They’ll pick up where they left off next time you open Lumina.',
      };
      void (win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts)).then(({ response }) => {
        if (response !== 0) return;
        confirmedQuit = true;
        app.quit();
      });
      return;
    }
    setQuitting();
    queue.shutdown();
    aria2.stop();
    bridge.stop();
  });

  app.on('will-quit', () => {
    // MCP servers are real child processes; kill them so quitting Lumina doesn't orphan them.
    shutdownMcp();
    shutdownTerminals();
    closeDatabase();
  });
}
