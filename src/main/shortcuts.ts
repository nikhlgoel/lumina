import { clipboard, globalShortcut } from 'electron';
import { extractLinks } from '../core/url';
import { settings } from './settings';
import { logger } from './log';

const log = logger('shortcuts');
let registered: string | null = null;
let lastError: string | null = null;

/** System-wide shortcut that downloads the link currently on the clipboard. */
export function applyGlobalShortcut(onTrigger: (url: string | null) => void) {
  const g = settings.get().general;
  if (registered) {
    globalShortcut.unregister(registered);
    registered = null;
  }
  lastError = null;
  if (!g.globalShortcutEnabled || !g.globalShortcut) return;
  try {
    const ok = globalShortcut.register(g.globalShortcut, () => {
      void Promise.resolve(clipboard.readText()).then((text) => onTrigger(extractLinks(text)[0] ?? null));
    });
    if (ok) registered = g.globalShortcut;
    else lastError = 'Another app is already using this shortcut.';
  } catch {
    lastError = 'That isn’t a valid shortcut.';
  }
  if (lastError) log.warn(`Shortcut ${g.globalShortcut}: ${lastError}`);
}

export function shortcutStatus() {
  const g = settings.get().general;
  return { ok: Boolean(registered) || !g.globalShortcutEnabled, accelerator: g.globalShortcut, error: lastError };
}

/**
 * Notice links copied anywhere on the system. Repeats are ignored,
 * and only links Lumina can actually download are reported.
 */
export function watchClipboard(onLink: (url: string) => void): () => void {
  let last: string | null = null;
  let busy = false;
  const timer = setInterval(async () => {
    if (busy || !settings.get().general.clipboardWatcher) return;
    busy = true;
    try {
      const text = await Promise.resolve(clipboard.readText());
      // The first read only records what was already there when Lumina started.
      if (last === null || text === last || text.length > 20_000) {
        last = text;
        return;
      }
      last = text;
      const link = extractLinks(text)[0];
      if (link && (link.startsWith('magnet:') || /^https?:\/\/[^/]+\/.+/.test(link))) onLink(link);
    } finally {
      busy = false;
    }
  }, 1200);
  return () => clearInterval(timer);
}
