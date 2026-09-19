// The renderer's view of the active editor theme.
//
// Monaco and xterm both need the same colours, and both are created imperatively outside React, so
// a tiny observable module serves them better than context. It holds the loaded theme list, works
// out which one is active, and tells subscribers when that changes.
//
// "auto" means follow the app's own light/dark mode, which is the default and what most people
// want: switch the app to light and the editor and terminal follow.
import { BUILT_IN_THEMES, type EditorTheme } from '@core/theme';
import { call } from '@/lib/bridge';

let available: EditorTheme[] = BUILT_IN_THEMES;
let selectedId = 'auto';

type Listener = (theme: EditorTheme) => void;
const listeners = new Set<Listener>();

/** True when the app is in dark mode, by the same signal the rest of the UI uses. */
const appIsDark = () => document.documentElement.dataset.theme !== 'light';

const fallback = (): EditorTheme =>
  BUILT_IN_THEMES.find((t) => t.id === (appIsDark() ? 'lumina-dark' : 'lumina-light')) ?? BUILT_IN_THEMES[0]!;

/**
 * The theme to render with right now.
 *
 * A selection that no longer exists (its file was deleted, or it came from another machine) falls
 * back to the automatic pair rather than leaving the editor unstyled.
 */
export function activeTheme(): EditorTheme {
  if (selectedId === 'auto') return fallback();
  return available.find((t) => t.id === selectedId) ?? fallback();
}

export const availableThemes = (): EditorTheme[] => available;

function publish() {
  const theme = activeTheme();
  for (const fn of listeners) fn(theme);
}

/** Subscribe to theme changes; fires immediately with the current theme. */
export function onThemeChange(fn: Listener): () => void {
  listeners.add(fn);
  fn(activeTheme());
  return () => { listeners.delete(fn); };
}

/** Called when the app's light/dark mode flips, so "auto" can follow it. */
export function notifyColorModeChanged() {
  if (selectedId === 'auto') publish();
}

export function setSelectedTheme(id: string) {
  if (id === selectedId) return;
  selectedId = id;
  publish();
}

/** Pull the list from main. Safe to call repeatedly; keeps the current selection. */
export async function loadThemes(): Promise<EditorTheme[]> {
  try {
    const list = await call('theme:list');
    if (list.length > 0) {
      available = list;
      publish();
    }
  } catch {
    // Keep the built-ins: an editor with slightly wrong colours beats an editor that won't open.
  }
  return available;
}

export function setThemes(list: EditorTheme[]) {
  available = list.length > 0 ? list : BUILT_IN_THEMES;
  publish();
}
