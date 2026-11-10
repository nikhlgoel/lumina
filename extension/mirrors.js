// A page that offers the same files on several hosts ("FileDitch | Pixeldrain | Gofile | ...": the same release, one tab per mirror) gives
// the person fifty links where eleven are wanted. Sending them all downloads everything five times. This groups the links by host so the
// popup can offer one mirror at a time, and says which to start with. Plain functions, no browser APIs: the popup uses it, and so does a test.

export const hostOf = (url) => {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
};

// Hosts in the order Lumina handles them best: Pixeldrain has a public direct-file address, so no page, countdown or check is involved.
export const PREFERRED_MIRRORS = ['pixeldrain.com', 'pixeldra.in', 'gofile.io', 'buzzheavier.com', 'bzzhr.co', 'qiwi.gg', 'krakenfiles.com', 'vikingfile.com'];

/** The links grouped by host, the biggest group first. Magnet links are their own group ("magnet"). */
export function groupByHost(links) {
  const groups = new Map();
  for (const l of links) {
    const host = /^magnet:/i.test(l.url) ? 'magnet' : hostOf(l.url);
    if (!host) continue;
    if (!groups.has(host)) groups.set(host, []);
    groups.get(host).push(l);
  }
  return [...groups.entries()].map(([host, list]) => ({ host, links: list })).sort((a, b) => b.links.length - a.links.length);
}

/**
 * Which host to start with, or null when the page is not offering mirrors. It is only a set of mirrors when two or more hosts each hold at
 * least two links; one stray link to another site is not a mirror. Of those, a preferred host wins, then the one with the most links.
 */
export function chooseMirror(groups) {
  const real = groups.filter((g) => g.host !== 'magnet' && g.links.length >= 2);
  if (real.length < 2) return null;
  for (const host of PREFERRED_MIRRORS) if (real.some((g) => g.host === host)) return host;
  return real[0].host;
}

const GENERIC = /^(?:downloads?|download (?:now|here|file|link|part)|get(?: it| file| link)?|click here|here|mirror|link|(?:free|slow|fast|direct) (?:download|link)|start|go|open|view|file)\W*$/i;

/** A readable name for a link: its own words if they say something, otherwise the file name in the address (a host often keeps it after the #). */
export function linkName(l) {
  const text = String(l.text ?? '').trim();
  if (text && text.length <= 80 && !/^https?:|^magnet:/i.test(text) && text.length >= 3 && !GENERIC.test(text)) return text;
  try {
    const u = new URL(l.url);
    const frag = decodeURIComponent(u.hash.slice(1));
    if (/\.[a-z0-9]{2,5}$/i.test(frag)) return frag;
    if (/^magnet:/i.test(l.url)) return new URLSearchParams(l.url.slice(8)).get('dn') || 'Magnet link';
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    if (/\.[a-z0-9]{2,5}$/i.test(last)) return last;
    return last || text || u.hostname;
  } catch {
    return /^magnet:/i.test(l.url) ? (new URLSearchParams(l.url.slice(8)).get('dn') || 'Magnet link') : (text || l.url);
  }
}
