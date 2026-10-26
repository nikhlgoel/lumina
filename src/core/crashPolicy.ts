// What to do when something goes wrong that nobody handled. Pure, so the rules are testable without an Electron crash.
//
// Before this existed Lumina had no handler for an unhandled promise rejection, an uncaught exception or a renderer that
// died. Electron's default for the first two is a raw "A JavaScript error occurred in the main process" dialog (and in
// a tray app, a dead background downloader behind it); for the third a blank white window that never recovered, even
// though every download was still running fine in the main process.

/** Electron's `render-process-gone` reasons that mean the page died, not that it was closed. */
const DEAD_REASONS = new Set(['crashed', 'abnormal-exit', 'killed', 'oom', 'launch-failed', 'integrity-failure']);

export const RELOAD_LIMIT = 3;
export const RELOAD_WINDOW_MS = 60_000;

export type RendererAction = 'ignore' | 'reload' | 'give-up';

export interface RendererDecision {
  action: RendererAction;
  /** The crash times still inside the window, to pass back in next time. */
  history: number[];
}

/**
 * A page that dies is reloaded (its downloads live in the main process, so nothing is lost), but a page that dies again
 * and again is not: after [RELOAD_LIMIT] crashes within a minute the person is told instead of the window flashing forever.
 * A clean exit is the window being closed, which is not a crash.
 */
export function decideRendererGone(reason: string, history: number[], now: number): RendererDecision {
  const recent = history.filter((t) => now - t < RELOAD_WINDOW_MS);
  if (!DEAD_REASONS.has(reason)) return { action: 'ignore', history: recent };
  const next = [...recent, now];
  return { action: next.length > RELOAD_LIMIT ? 'give-up' : 'reload', history: next };
}

/**
 * Errors from writing to a console nobody is reading. A GUI app started without a console (autostart, a launcher, a
 * closed terminal) gets EPIPE on its first `console.log`, and unhandled that is an exception in the main process.
 */
export function isHarmlessStreamError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as Error & { code?: string }).code;
  return code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED' || code === 'EIO' || /\bwrite EPIPE\b/.test(err.message);
}

export interface ErrorBurst {
  /** Whether this one should be written to the log in full. */
  log: boolean;
  times: number[];
}

/**
 * One bug in a timer can throw ten times a second; the log (and the disk) should not fill with it. The first [max] per
 * [windowMs] are written, the rest are held back.
 */
export function noteError(times: number[], now: number, max = 20, windowMs = 60_000): ErrorBurst {
  const recent = times.filter((t) => now - t < windowMs);
  return { log: recent.length < max, times: [...recent, now] };
}

/** A line for the log from whatever was thrown, which may not be an Error at all. */
export function describeThrown(value: unknown): string {
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  try {
    return typeof value === 'string' ? value : JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
