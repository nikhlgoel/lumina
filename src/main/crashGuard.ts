// A safety net under the whole main process. See core/crashPolicy for the rules and for why this exists.
import { app, dialog, shell } from 'electron';
import { logger } from './log';
import { logsDir } from './paths';
import { mainWindow } from './window';
import { decideRendererGone, describeThrown, isHarmlessStreamError, noteError } from '../core/crashPolicy';

const log = logger('crash');

let installed = false;
let errorTimes: number[] = [];
let held = 0;
let rendererCrashes: number[] = [];

/** Log an error nobody caught, without letting a loop of them fill the log. */
function report(kind: string, value: unknown) {
  const burst = noteError(errorTimes, Date.now());
  errorTimes = burst.times;
  if (burst.log) {
    if (held) log.warn(`${held} more unhandled errors were held back during the last burst`);
    held = 0;
    log.error(`${kind}: ${describeThrown(value)}`);
  } else {
    held++;
  }
}

function showGiveUp() {
  void dialog.showMessageBox({
    type: 'error',
    title: 'Lumina',
    message: 'The Lumina window keeps closing unexpectedly.',
    detail: 'Your downloads are not affected: they run in the background and carry on. You can restart Lumina, or open the log folder to see what happened.',
    buttons: ['Restart Lumina', 'Open log folder', 'Close'],
    defaultId: 0,
    cancelId: 2,
  }).then(({ response }) => {
    if (response === 0) {
      app.relaunch();
      app.quit();
    } else if (response === 1) {
      void shell.openPath(logsDir());
    }
  });
}

/** Install once, as early as possible. A second call does nothing. */
export function installCrashGuard() {
  if (installed) return;
  installed = true;

  // Electron's default for either of these is a raw error dialog; for a background downloader that is worse than the
  // error. Log it, keep running. (A broken console pipe is not an error worth a line.)
  process.on('uncaughtException', (err, origin) => {
    if (isHarmlessStreamError(err)) return;
    report(`Uncaught exception (${origin})`, err);
  });
  process.on('unhandledRejection', (reason) => {
    if (isHarmlessStreamError(reason)) return;
    report('Unhandled promise rejection', reason);
  });

  app.on('render-process-gone', (_event, contents, details) => {
    log.error(`A page process is gone (${details.reason}, exit code ${details.exitCode})`, { url: contents.isDestroyed() ? '' : contents.getURL() });
    const win = mainWindow();
    // Only Lumina's own window is recovered here; the in-app browser's pages are the browser's business.
    if (!win || contents.isDestroyed() || contents !== win.webContents) return;
    const decision = decideRendererGone(details.reason, rendererCrashes, Date.now());
    rendererCrashes = decision.history;
    if (decision.action === 'reload') {
      log.info('Reloading the window; downloads were running in the main process and are unaffected');
      setTimeout(() => {
        try {
          if (!contents.isDestroyed()) contents.reload();
        } catch (err) {
          log.error('Could not reload the window', err);
        }
      }, 500);
    } else if (decision.action === 'give-up') {
      showGiveUp();
    }
  });

  // The graphics or network helper process dying is recoverable by Chromium itself; the log should still say so.
  app.on('child-process-gone', (_event, details) => {
    log.warn(`A helper process is gone (${details.type}: ${details.reason}, exit code ${details.exitCode})`);
  });

  app.on('browser-window-created', (_event, win) => {
    win.on('unresponsive', () => log.warn('The window stopped responding'));
    win.on('responsive', () => log.info('The window is responding again'));
  });
}
