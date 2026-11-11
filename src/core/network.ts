// Addresses that belong to this computer or its own network, as opposed to the public internet.
//
// Used where a page on the public internet could send Lumina somewhere it should not go: a link that redirects to 127.0.0.1 or a router's
// address would make Lumina ask that machine on the page's behalf. Only the literal address or name is judged here (no DNS lookup), which
// stops the redirect trick; it is not a firewall.

const ipv4 = (h: string): number[] | null => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n <= 255) ? parts : null;
};

/** Is this host name or address the local machine or a private network? Accepts a bracketed IPv6 literal. */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!h) return false;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan') || h.endsWith('.home.arpa')) return true;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(h)?.[1];
  const v4 = ipv4(mapped ?? h);
  if (v4) {
    const [a = 0, b = 0] = v4;
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (h.includes(':')) {
    return h === '::' || h === '::1' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h);
  }
  return false;
}
