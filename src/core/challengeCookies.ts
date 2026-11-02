// Cookies that prove a bot check was passed. Lumina never carries them from one place to another.
//
// AGENTS.md rule 1: no `cf_clearance` harvesting or replay. When a site puts up a check, the only supported path is the person solving it
// themselves, in the in-app browser or through the extension. The extension used to read every cookie for a page and its links and send
// them all to Lumina, clearance included, so a check solved in the browser was quietly replayed from Lumina. These names are dropped at
// both ends: the extension does not send them, and the bridge does not accept them (so an older extension cannot either).
//
// The extension cannot import this file; `extension/lib.js` keeps the same list, and a test holds the two together.

/** Cloudflare's clearance and bot-management cookies, its challenge state, and DataDome's token. */
export const CHALLENGE_COOKIE = /^(?:cf_clearance|__cf_bm|__cf_chl_[\w-]*|cf_chl_[\w-]*|datadome)$/i;

export const isChallengeCookie = (name: string): boolean => CHALLENGE_COOKIE.test(name);

/** The same cookies without the ones that prove a check was passed. */
export function withoutChallengeCookies<T extends { name: string }>(cookies: readonly T[]): T[] {
  return cookies.filter((c) => !isChallengeCookie(c.name));
}
