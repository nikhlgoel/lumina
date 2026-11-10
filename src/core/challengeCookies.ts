// Cookies that prove a bot check was passed. They do not travel from the person's browser to Lumina.
//
// The person solves a check themselves, in Lumina's own download page or in their browser. The extension used to read every cookie for a page
// and its links and send them all to Lumina, clearance included, so a check solved in the browser was quietly replayed from Lumina. These
// names are dropped at both ends: the extension does not send them, and the bridge does not accept them (so an older extension cannot either).
// What Lumina's own download pages do with a check solved in one of them (remember it for that site's other files, in memory, for a short
// while) is core/clearance.ts.
//
// The extension cannot import this file; `extension/lib.js` keeps the same list, and a test holds the two together.

/** Cloudflare's clearance and bot-management cookies, its challenge state, and DataDome's token. */
export const CHALLENGE_COOKIE = /^(?:cf_clearance|__cf_bm|__cf_chl_[\w-]*|cf_chl_[\w-]*|datadome)$/i;

export const isChallengeCookie = (name: string): boolean => CHALLENGE_COOKIE.test(name);

/** The same cookies without the ones that prove a check was passed. */
export function withoutChallengeCookies<T extends { name: string }>(cookies: readonly T[]): T[] {
  return cookies.filter((c) => !isChallengeCookie(c.name));
}
