// What this build actually contains.
//
// Lumina ships in more than one shape: the full app, and smaller builds for people who want the
// downloader and player without an editor or a browser bolted on. These are decided at build time
// by Vite's `define`, so an excluded feature is not hidden behind a flag at runtime — the code is
// never bundled. That matters twice over: the editor is about 13 MB of Monaco and its workers, and
// a feature that is present but unreachable is exactly the "for show" thing this project refuses to
// ship.
//
// Set by `vite.config.ts` from `LUMINA_NO_IDE` / `LUMINA_NO_BROWSER`. Both default to included.

declare const __LUMINA_IDE__: boolean;
declare const __LUMINA_BROWSER__: boolean;

// Written as a bare reference, not guarded with `typeof`: the guard stopped Rollup folding the
// constant across module boundaries, and a no-IDE build still shipped every byte of Monaco.
// Both are supplied by vite.config.ts and vitest.config.ts, so there is no case where they are
// genuinely missing.

/** The built-in code editor, terminal, source control and MCP client. */
export const HAS_IDE = __LUMINA_IDE__;

/** The in-app browser and its shield. */
export const HAS_BROWSER = __LUMINA_BROWSER__;

/**
 * The name of this build, for the About screen and the log.
 *
 * Said plainly so a bug report says which build it came from — "the Code tab is missing" is a very
 * different report depending on the answer.
 */
export function buildVariant(): string {
  if (HAS_IDE && HAS_BROWSER) return 'full';
  if (HAS_BROWSER) return 'standard';
  if (HAS_IDE) return 'no-browser';
  return 'player';
}
