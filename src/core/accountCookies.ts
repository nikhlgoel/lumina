// Using the sign-in the person already has in their own browser.
//
// Lumina's own sign-in window cannot sign in to Google: Google refuses embedded browsers (the Electron window is one, whatever it says its
// name is), so "Sign in to YouTube" ended in an error no setting could fix. The person's real browser is already signed in, and the Lumina
// extension is already connected to the app. So the extension hands over the cookies of that one site, when the person presses a button,
// and Lumina keeps them exactly as it keeps a session from its own window. This file decides which cookies those are.

import type { CapturedCookie } from '../shared/types';

/** Sites that can be signed in to this way: the domains their sign-in cookies live on, and the cookies that mean "signed in". */
export const LOGIN_SITES = {
  youtube: {
    domains: ['youtube.com', 'google.com'],
    // The session cookies Google sets after a sign-in. Any one of them being present and unexpired means a live session.
    session: /^(?:SID|SAPISID|__Secure-1PSID|__Secure-3PSID|__Secure-1PAPISID|__Secure-3PAPISID)$/,
  },
} as const;

export type LoginSite = keyof typeof LOGIN_SITES;

export const isLoginSite = (s: unknown): s is LoginSite => typeof s === 'string' && Object.prototype.hasOwnProperty.call(LOGIN_SITES, s);

const bare = (domain: string) => domain.replace(/^\./, '').toLowerCase();

const onSite = (domain: string, site: LoginSite) => LOGIN_SITES[site].domains.some((d) => bare(domain) === d || bare(domain).endsWith(`.${d}`));

/**
 * The cookies that belong to this site's sign-in. Anything on another domain is dropped, whatever the extension sent: Lumina takes the
 * login of the site the person chose and nothing else from their browser.
 */
export function loginCookies(cookies: readonly CapturedCookie[], site: LoginSite): CapturedCookie[] {
  return cookies.filter((c) => c && typeof c.name === 'string' && c.name && typeof c.value === 'string' && typeof c.domain === 'string' && onSite(c.domain, site));
}

/** Do these cookies hold a live session (a sign-in cookie that has not expired)? A cookie with no expiry lasts as long as the browser. */
export function hasLiveSession(cookies: readonly CapturedCookie[], site: LoginSite, nowSec = Date.now() / 1000): boolean {
  return loginCookies(cookies, site).some((c) => LOGIN_SITES[site].session.test(c.name) && c.value !== '' && (!c.expirationDate || c.expirationDate > nowSec));
}

/** The address Electron's cookie store wants alongside a cookie: its scheme, its domain without the leading dot, and its path. */
export function cookieUrl(c: Pick<CapturedCookie, 'domain' | 'path' | 'secure'>): string {
  return `http${c.secure ? 's' : ''}://${bare(c.domain)}${c.path || '/'}`;
}
