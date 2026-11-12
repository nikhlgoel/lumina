// Which screens the sidebar offers, in what order, and the keys that go to them.
//
// One rule for both the sidebar and the keyboard, so they cannot disagree: a screen that is not offered has no item AND no shortcut (a shortcut that lands on
// an empty pane is worse than none), and the numbers follow what is shown, so there is never a Ctrl+5 with no Ctrl+4 before it.

export type NavView = 'download' | 'queue' | 'library' | 'browser' | 'ide' | 'settings';

export interface NavOptions {
  /** This build contains the in-app browser at all (a smaller build leaves it out). */
  hasBrowser: boolean;
  /** The person asked for it in the sidebar. Off by default: Lumina's downloads and its site checks do not need it. */
  showBrowser: boolean;
  /** This build contains the code editor. */
  hasIde: boolean;
}

/** The screens in the sidebar, top to bottom. Settings is last. */
export function navViews(o: NavOptions): NavView[] {
  return ['download', 'queue', 'library', ...(o.hasBrowser && o.showBrowser ? (['browser'] as const) : []), ...(o.hasIde ? (['ide'] as const) : []), 'settings'];
}

/** The key (with Ctrl or Command) for each screen: 1, 2, 3 ... in the order shown, and a comma for Settings. */
export function navKeys(o: NavOptions): Record<string, NavView> {
  const keys: Record<string, NavView> = {};
  // Settings is always last and has its comma instead of a number, so the numbers run 1..n over everything before it.
  navViews(o).forEach((view, i) => { keys[view === 'settings' ? ',' : String(i + 1)] = view; });
  return keys;
}

/** The key shown beside a screen in the sidebar ("1", "4", ","), or '' for a screen that has none. */
export function keyFor(view: NavView, o: NavOptions): string {
  for (const [key, v] of Object.entries(navKeys(o))) if (v === view) return key;
  return '';
}
