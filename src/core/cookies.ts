import type { CapturedCookie } from '../shared/types';

/**
 * The Cookie header a browser would send for this URL: domain, path, secure and expiry rules applied,
 * longest paths first. Cookies for other sites are never included.
 */
export function cookieHeaderFor(url: string, cookies: CapturedCookie[], nowSec = Date.now() / 1000): string {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return '';
  }
  const host = target.hostname.toLowerCase();
  const path = target.pathname || '/';
  const matches = cookies.filter((c) => {
    const domain = c.domain.toLowerCase().replace(/^\./, '');
    const domainOk = c.domain.startsWith('.') ? host === domain || host.endsWith(`.${domain}`) : host === domain;
    const cookiePath = c.path || '/';
    const pathOk = path === cookiePath || (path.startsWith(cookiePath) && (cookiePath.endsWith('/') || path[cookiePath.length] === '/'));
    const secureOk = !c.secure || target.protocol === 'https:';
    const alive = !c.expirationDate || c.expirationDate > nowSec;
    return domainOk && pathOk && secureOk && alive && !/[;\r\n]/.test(c.name + c.value);
  });
  return matches
    .sort((a, b) => (b.path?.length ?? 0) - (a.path?.length ?? 0))
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}
