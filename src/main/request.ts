import fs from 'node:fs';
import path from 'node:path';
import type { CapturedCookie, RequestInfo } from '../shared/types';
import type { RequestContext } from '../core/ytdlpArgs';
import { settings } from './settings';
import { dataDir } from './paths';

/** Cookies captured by Lumina's own sign-in window (Settings › Accounts). */
export const accountCookiesFile = () => path.join(dataDir(), 'accounts', 'cookies.txt');

/** Netscape cookie file, the format yt-dlp and aria2 read. Written with owner-only permissions. */
export function writeNetscapeCookies(file: string, cookies: CapturedCookie[]) {
  const lines = ['# Netscape HTTP Cookie File', '# Written by Lumina. Do not share this file.', ''];
  for (const c of cookies) {
    if (/[\t\r\n]/.test(c.name + c.value + c.domain + c.path)) continue;
    const includeSub = c.domain.startsWith('.') ? 'TRUE' : 'FALSE';
    const expiry = Math.round(c.expirationDate ?? Date.now() / 1000 + 86_400 * 30);
    lines.push([c.httpOnly ? `#HttpOnly_${c.domain}` : c.domain, includeSub, c.path || '/', c.secure ? 'TRUE' : 'FALSE', String(expiry), c.name, c.value].join('\t'));
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join('\n')}\n`, { mode: 0o600 });
}

/**
 * Would this run send the saved sign-in (Lumina's account cookies, or a cookie file), as opposed to cookies the extension
 * captured with the link or none at all? A saved sign-in that has gone stale can make an otherwise public download fail, so a
 * run that used one and failed is worth repeating once without it.
 */
export function usesSavedSignIn(request: RequestInfo | undefined): boolean {
  if (request?.cookies.length) return false;
  const s = settings.get();
  return (s.network.cookiesFrom === 'lumina' && fs.existsSync(accountCookiesFile()))
    || (s.network.cookiesFrom === 'file' && Boolean(s.network.cookiesFile) && fs.existsSync(s.network.cookiesFile));
}

/**
 * Build the request identity for a yt-dlp run.
 * Cookies captured with the request (from the extension) win; otherwise the Accounts setting applies.
 */
export function requestContext(request: RequestInfo | undefined, workDir: string | null, opts: { withBrowserCookies?: boolean; withAccountCookies?: boolean } = {}): RequestContext {
  const s = settings.get();
  let cookies: RequestContext['cookies'] = {};

  if (request?.cookies.length && workDir) {
    const file = path.join(workDir, 'site-cookies.txt');
    writeNetscapeCookies(file, request.cookies);
    cookies = { file };
  } else if (s.network.cookiesFrom === 'lumina' && opts.withAccountCookies !== false && fs.existsSync(accountCookiesFile())) {
    cookies = { file: accountCookiesFile() };
  } else if (s.network.cookiesFrom === 'file' && opts.withAccountCookies !== false && s.network.cookiesFile && fs.existsSync(s.network.cookiesFile)) {
    cookies = { file: s.network.cookiesFile };
  } else if (['chrome', 'edge', 'firefox', 'brave'].includes(s.network.cookiesFrom) && opts.withBrowserCookies !== false) {
    cookies = { browser: s.network.cookiesFrom };
  }

  const headers = { ...(request?.headers ?? {}) };
  // The page a stream came from is usually required as Referer.
  if (request?.pageUrl && !Object.keys(headers).some((h) => h.toLowerCase() === 'referer')) headers.Referer = request.pageUrl;
  const userAgent = Object.entries(headers).find(([k]) => k.toLowerCase() === 'user-agent')?.[1] ?? s.network.userAgent;
  for (const k of Object.keys(headers)) if (k.toLowerCase() === 'user-agent' || k.toLowerCase() === 'cookie') delete headers[k];

  return { headers, userAgent, proxy: s.network.proxy, forceIpv4: s.network.forceIpv4, cookies };
}
