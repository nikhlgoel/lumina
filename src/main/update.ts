// Checks GitHub Releases for a newer Lumina on launch and on demand.
//
// Scope, deliberately: Lumina *finds* and *announces* an update and opens its release page — it does
// not download or install one over itself. In-place install needs a signed, published update channel
// (electron-updater feed); until releases actually ship that, an installer path here would be a
// feature that can't be verified. See PUBLISHING.md.
import { app, shell } from 'electron';
import { pickUpdate } from '../core/version';
import type { UpdateState } from '../shared/types';
import { settings } from './settings';
import { logger } from './log';

const log = logger('update');
const GITHUB_RELEASES = 'https://api.github.com/repos/nikhlgoel/lumina/releases?per_page=20';
/**
 * Dev-only override so the "an update is available" path can be exercised without publishing a
 * release. Ignored in a packaged build, so a shipped Lumina always asks GitHub and nothing else.
 */
const releasesUrl = () => (!app.isPackaged && process.env.LUMINA_UPDATE_FEED) || GITHUB_RELEASES;
const CHECK_INTERVAL_MS = 6 * 3600_000;

let state: UpdateState = {
  available: null,
  currentVersion: app.getVersion(),
  checking: false,
  lastCheckAt: 0,
  error: null,
};

type Listener = (s: UpdateState) => void;
const listeners = new Set<Listener>();

export const updateState = (): UpdateState => state;
export function onUpdateState(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function set(patch: Partial<UpdateState>) {
  state = { ...state, ...patch };
  for (const fn of listeners) fn(state);
}

/**
 * Ask GitHub what the newest release is. `manual` bypasses the interval throttle and the
 * "skipped version" the user dismissed, because they explicitly asked.
 */
export async function checkForUpdate(manual = false): Promise<UpdateState> {
  const s = settings.get().updates;
  if (state.checking) return state;
  if (!manual && (!s.checkAppOnLaunch || Date.now() - s.lastAppCheck < CHECK_INTERVAL_MS)) return state;

  set({ checking: true, error: null });
  try {
    const res = await fetch(releasesUrl(), {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Lumina/${app.getVersion()}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`GitHub replied ${res.status}`);
    const available = pickUpdate(await res.json(), app.getVersion(), {
      allowPrerelease: s.allowPrereleases,
      skipVersion: manual ? undefined : s.skippedVersion,
    });
    settings.update({ updates: { lastAppCheck: Date.now() } });
    set({ available, checking: false, lastCheckAt: Date.now() });
    log.info(available ? `Update available: ${available.version} (running ${app.getVersion()})` : `Up to date (${app.getVersion()})`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Offline or rate-limited is normal; log it and move on rather than bothering the user.
    log.warn(`Update check failed: ${message}`);
    set({ checking: false, error: message, lastCheckAt: Date.now() });
  }
  return state;
}

/** "Not this one" — remember the version so the launch check stops offering it. */
export function skipVersion(version: string) {
  settings.update({ updates: { skippedVersion: version } });
  set({ available: null });
}

/** Open the release page in the user's real browser, where they choose what to download. */
export async function openReleasePage(): Promise<void> {
  const url = state.available?.url || 'https://github.com/nikhlgoel/lumina/releases/latest';
  await shell.openExternal(url);
}

/** Restart Lumina — also the manual "restart" the update notice offers after an install. */
export function restartApp() {
  log.info('Restarting on request');
  app.relaunch();
  app.exit(0);
}

/** Called once at startup; deliberately fire-and-forget so it never delays the window. */
export function initUpdates() {
  setTimeout(() => void checkForUpdate().catch(() => {}), 8000);
}
