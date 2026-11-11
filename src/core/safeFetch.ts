// A GET that follows redirects itself, so that each hop is sent only what belongs to it.
//
// `fetch` with `redirect: 'follow'` carries the headers it was given to wherever a redirect leads. The browser extension hands Lumina the
// cookies it holds for a link and for the page the link was on, plus request headers; a link that redirected to another site would take
// all of that along, and one that redirected to 127.0.0.1 or a router would make Lumina ask that machine on a web page's behalf.
import { cookieHeaderFor } from './cookies';
import { isPrivateHost } from './network';
import type { CapturedCookie } from '../shared/types';

export interface SafeFetchInit {
  headers: Record<string, string>;
  /** Everything the browser held for the link; each hop is sent only the cookies whose domain and path fit it. */
  cookies?: readonly CapturedCookie[];
  signal?: AbortSignal;
  method?: string;
  maxHops?: number;
}

const lower = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));

export async function fetchFollowing(url: string, init: SafeFetchInit, fetchImpl: typeof fetch = fetch): Promise<{ res: Response; finalUrl: string }> {
  const first = new URL(url);
  const startedPrivate = isPrivateHost(first.hostname);
  const maxHops = init.maxHops ?? 5;
  let current = first;
  for (let hop = 0; ; hop++) {
    const headers = lower(init.headers);
    delete headers.cookie; // the one for this address is worked out below, never one carried from the last
    if (current.origin !== first.origin) {
      delete headers.authorization;
      delete headers['proxy-authorization'];
    }
    const cookie = init.cookies?.length ? cookieHeaderFor(current.toString(), [...init.cookies]) : '';
    if (cookie) headers.cookie = cookie;
    const res = await fetchImpl(current, { method: init.method ?? 'GET', redirect: 'manual', headers, signal: init.signal });
    const where = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && where) {
      void res.body?.cancel().catch(() => undefined);
      if (hop >= maxHops) throw new Error('Too many redirects');
      const next = new URL(where, current);
      if (!/^https?:$/.test(next.protocol)) throw new Error('Redirect to a non-web address');
      // From the public internet to this machine or its network is the redirect trick; a link that began on a private address may go there.
      if (!startedPrivate && isPrivateHost(next.hostname)) throw new Error('A public address redirected to a private one, so Lumina did not follow it');
      current = next;
      continue;
    }
    return { res, finalUrl: current.toString() };
  }
}
