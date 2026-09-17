import { dialog, powerSaveBlocker } from 'electron';
import { spawn } from 'node:child_process';
import { settings } from './settings';
import { queue } from './jobs/queue';
import { mainWindow } from './window';
import { logger } from './log';

const log = logger('power');
let blocker: number | null = null;
let hadActive = false;
let pending: AbortController | null = null;

function runPowerAction(action: 'sleep' | 'shutdown') {
  const commands: Record<NodeJS.Platform | string, Record<'sleep' | 'shutdown', [string, string[]]>> = {
    win32: { sleep: ['rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0']], shutdown: ['shutdown.exe', ['/s', '/t', '30', '/c', 'Lumina finished downloading.']] },
    darwin: { sleep: ['pmset', ['sleepnow']], shutdown: ['osascript', ['-e', 'tell app "System Events" to shut down']] },
    linux: { sleep: ['systemctl', ['suspend']], shutdown: ['systemctl', ['poweroff']] },
  };
  const cmd = commands[process.platform]?.[action];
  if (!cmd) return;
  log.info(`Queue finished: ${action}`);
  spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

/** Ask before sleeping or shutting down, with a 60-second countdown the user can cancel. */
async function confirmAndRun(action: 'sleep' | 'shutdown') {
  pending?.abort();
  pending = new AbortController();
  const signal = pending.signal;
  const timeout = setTimeout(() => pending?.abort('timeout'), 60_000);
  const win = mainWindow();
  const opts = {
    type: 'info' as const, buttons: [action === 'sleep' ? 'Sleep now' : 'Shut down now', 'Cancel'], defaultId: 0, cancelId: 1, noLink: true,
    title: 'Downloads finished', message: `All downloads are done. Your computer will ${action === 'sleep' ? 'go to sleep' : 'shut down'} in 60 seconds.`,
    detail: 'Choose Cancel to keep it on. This setting turns itself off after it runs.', signal,
  };
  try {
    const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
    clearTimeout(timeout);
    // Aborted by the timer counts as "go ahead"; Cancel keeps the computer on.
    if (response === 1 && signal.reason !== 'timeout') return;
  } catch {
    // dialog closed by abort
  }
  settings.update({ general: { whenQueueFinishes: 'nothing' } });
  runPowerAction(action);
}

/** Keep the computer awake while downloading, and handle "when downloads finish". */
export function watchQueuePower() {
  queue.on('updated', () => {
    const active = queue.list().some((j) => j.status === 'running' || j.status === 'processing' || j.status === 'queued');
    const s = settings.get();
    if (active && s.downloads.preventSleep && blocker === null) blocker = powerSaveBlocker.start('prevent-app-suspension');
    if ((!active || !s.downloads.preventSleep) && blocker !== null) {
      powerSaveBlocker.stop(blocker);
      blocker = null;
    }
    if (hadActive && !active && s.general.whenQueueFinishes !== 'nothing') void confirmAndRun(s.general.whenQueueFinishes);
    hadActive = active;
  });
}
