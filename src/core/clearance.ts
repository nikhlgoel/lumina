// A check the person solved, remembered for the rest of that site's files.
//
// Every download page opens with a fresh, empty cookie jar on purpose: hosts keep the file being downloaded in a cookie (`file_code`), so pages
// that shared a jar handed out the wrong file. The cost was that a bot check the person had just solved was forgotten, and the next part of
// the same release asked again, fifty times for fifty parts. This keeps ONLY the cookies that say "a person passed the check" (not the file
// cookie, not the session, not the check's working state) in memory, for that site alone, for a short while, and puts them in the next page's
// jar. Nothing is solved or faked: the person did the check, and this is a browser remembering that they did.
//
// This stays inside Lumina's own download pages. The extension still never sends these cookies (core/challengeCookies.ts).
import { CHALLENGE_COOKIE } from './challengeCookies';
import { siteOf } from './hosts';

/** Cloudflare's and DataDome's "this visitor passed" cookies. `cf_chl_*` is the check's working state and is deliberately not here. */
export const CLEARANCE_PROOF = /^(?:cf_clearance|__cf_bm|datadome)$/i;

/** However long the site says a clearance lasts, Lumina stops using it after this: an old one only buys a second check. */
export const CLEARANCE_MAX_AGE_MS = 30 * 60_000;

export interface ClearanceCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  /** Seconds since the epoch, as Electron reports it. Absent for a session cookie. */
  expirationDate?: number;
}

export const isClearanceProof = (name: string): boolean => CLEARANCE_PROOF.test(name) && CHALLENGE_COOKIE.test(name);

/** Does a cookie's domain belong to this site? (".host.example" and "www.host.example" belong to "host.example"; ".ads.example" does not.) */
const belongsTo = (domain: string, site: string): boolean => {
  const d = domain.replace(/^\./, '').toLowerCase();
  return d === site || d.endsWith(`.${site}`);
};

const expired = (c: ClearanceCookie, now: number): boolean => c.expirationDate !== undefined && c.expirationDate * 1000 <= now;

interface Entry { cookie: ClearanceCookie; at: number }

export class ClearanceJar {
  private readonly bySite = new Map<string, Entry[]>();

  /** Keep the proof-of-check cookies among `cookies` for `site`. Returns how many were kept. */
  remember(site: string, cookies: readonly ClearanceCookie[], now: number): number {
    const fresh = cookies.filter((c) => isClearanceProof(c.name) && belongsTo(c.domain, site) && !expired(c, now));
    if (!fresh.length) return 0;
    const same = (a: ClearanceCookie, b: ClearanceCookie) => a.name === b.name && a.domain === b.domain && a.path === b.path;
    const kept = (this.bySite.get(site) ?? []).filter((e) => !fresh.some((f) => same(f, e.cookie)));
    this.bySite.set(site, [...kept, ...fresh.map((cookie) => ({ cookie, at: now }))]);
    return fresh.length;
  }

  /** The proof still good for `site`, oldest dropped. */
  recall(site: string, now: number): ClearanceCookie[] {
    const live = (this.bySite.get(site) ?? []).filter((e) => now - e.at < CLEARANCE_MAX_AGE_MS && !expired(e.cookie, now));
    if (live.length) this.bySite.set(site, live);
    else this.bySite.delete(site);
    return live.map((e) => e.cookie);
  }

  has(site: string, now: number): boolean {
    return this.recall(site, now).length > 0;
  }

  forget(site: string): void {
    this.bySite.delete(site);
  }

  clear(): void {
    this.bySite.clear();
  }
}

/**
 * The key a solved check is kept under. `siteOf` assumes a name with a registrable domain, so on an IP address it would answer "0.1" for
 * 127.0.0.1 and make unrelated machines share a clearance; an address or a one-word host is its own site.
 */
export function clearanceSite(hostname: string): string {
  const h = hostname.toLowerCase();
  if (!h.includes('.') || h.includes(':') || /^[\d.]+$/.test(h)) return h;
  // Where strangers each get a name under one domain, "the site" is the name they got, not the platform.
  const shared = SHARED_SUFFIXES.find((s) => h.endsWith(`.${s}`));
  if (shared) return h.split('.').slice(-(shared.split('.').length + 1)).join('.');
  return siteOf(h);
}

const SHARED_SUFFIXES = [
  'github.io', 'gitlab.io', 'pages.dev', 'workers.dev', 'netlify.app', 'vercel.app', 'herokuapp.com', 'onrender.com', 'web.app',
  'firebaseapp.com', 'blogspot.com', 'wordpress.com', 'glitch.me', 'repl.co', 'fly.dev', 'surge.sh', 'neocities.org', 'azurewebsites.net',
];
