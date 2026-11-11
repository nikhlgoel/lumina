// File hosts: links that open a download page (buttons, countdowns, sometimes a captcha) rather than the file.
// Lumina opens those pages in a hidden browser, clicks through, and catches the real download.

/** Hosts known to put a download page in front of every file (XFileSharing-style and similar). */
export const PAGE_HOSTS = [
  'datanodes.to', 'ddownload.com', 'ddl.to', 'rapidgator.net', 'rg.to', 'nitroflare.com', 'katfile.com', 'uploadrar.com',
  'mega4upload.net', 'hexload.com', 'usersdrive.com', 'dropapk.to', 'drop.download', 'filespayouts.com', 'clicknupload.click',
  'clicknupload.org', 'clickndownload.org', 'userupload.net', 'uptobox.com', 'send.cm', 'krakenfiles.com', 'mediafire.com',
  '1fichier.com', 'turbobit.net', 'hitfile.net', 'uploadhaven.com', 'buzzheavier.com', 'bzzhr.co', 'qiwi.gg', 'fuckingfast.co',
  'filecrypt.cc', 'filedot.to', 'megaup.net', 'upload.ee', 'dailyuploads.net', 'workupload.com', 'sendspace.com', 'uploady.io',
  'up-4ever.net', 'file-upload.org', 'dbree.me', 'anonfiles.me', 'bayfiles.com', 'uploadev.org', 'vikingfile.com', 'akirabox.com',
  // yt-dlp has no extractor for it (checked in the bundled 2026.10.26: 1755 extractors, none), so its pages go through the download-page flow.
  'gofile.io',
];

/**
 * Did the server answer with a bot check (a Cloudflare challenge page) instead of the file? Such a link is not broken: a person passes the
 * check in Lumina's own page, and the file is fetched after. Says nothing about a plain 403, which can mean a real refusal.
 */
export function isBotCheckResponse(status: number, header: (name: string) => string | null): boolean {
  return (status === 403 || status === 503 || status === 429) && /challenge/i.test(header('cf-mitigated') ?? '');
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** True when the link belongs to a file host that serves a download page first. */
export function isPageHost(url: string): boolean {
  const host = hostOf(url);
  return Boolean(host && PAGE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)));
}

/**
 * Was this link typed, pasted or picked on a page, as opposed to being the address of a file the browser was already fetching?
 *
 * A request is attached to anything the extension sends, so "has a request" cannot tell the two apart: a file host's page link picked in
 * the browser arrived with one, skipped the click-through, and was probed as if it were the file (pasting the same link worked).
 */
export const isLinkFromPage = (request?: { fromLink?: boolean } | null): boolean => !request || request.fromLink === true;

/** Hosts with a public direct-file API: rewrite the share link to the file itself, no page needed. */
export function directApiUrl(url: string, devHost?: string): string | null {
  const host = hostOf(url);
  if (!host) return null;
  const path = new URL(url).pathname;
  // `devHost` stands in for Pixeldrain in the self-tests (a local server); it is never set in a packaged build.
  const standIn = Boolean(devHost) && host === devHost?.toLowerCase();
  if (host === 'pixeldrain.com' || host === 'pixeldra.in' || standIn) {
    const id = path.match(/^\/(?:u|api\/file)\/([A-Za-z0-9]+)/)?.[1];
    return id ? `${standIn ? new URL(url).origin : 'https://pixeldrain.com'}/api/file/${id}?download` : null;
  }
  return null;
}

/**
 * The address a download is queued under. A direct file is read at one address and its page is at another (a Pixeldrain share link is a web
 * page; the file is at its API address), and the probe returns the one that is the file. Queued under the pasted link, every Pixeldrain
 * download saved the share page (4 KB of HTML) and failed with "the server sent a web page instead of the file". Only a direct file is
 * redirected this way: for everything else the address the person gave is the one to keep.
 */
export function queueUrlFor(info: { sourceKind: string; url?: string; direct?: { hosted?: boolean } }, pasted: string): string {
  if (info.sourceKind !== 'direct' || info.direct?.hosted || !info.url || !/^https?:\/\//i.test(info.url)) return pasted;
  return info.url;
}

/** "example.co.uk" style registrable domain, close enough to tell a host's own pages from ad redirects. */
export function siteOf(hostname: string): string {
  const parts = hostname.toLowerCase().replace(/^www\./, '').split('.');
  const twoLevel = parts.length > 2 && /^(co|com|net|org|gov|ac|edu)$/.test(parts[parts.length - 2]!) && parts[parts.length - 1]!.length === 2;
  return parts.slice(twoLevel ? -3 : -2).join('.');
}

export interface PageScan {
  /** A captcha or interactive challenge is showing: a person has to finish the page. */
  captcha: boolean;
  /** Which kind of check, so Lumina can name it for the person (e.g. "reCAPTCHA"). */
  captchaKind: string | null;
  /** Where to click next (CSS pixels in the viewport), so the click arrives as real input. */
  target: { x: number; y: number; label: string } | null;
  /** Label of a control the page script clicked itself (after real clicks did nothing). */
  clicked: string | null;
  /** Seconds left on a visible countdown. */
  countdown: number | null;
  /** The host refuses: file gone, wait or limit messages. */
  blocked: string | null;
  /** The last click a person (not Lumina) made in the page, described, so it can be learned from. */
  lastClick: { sig: unknown; at: number; control: boolean } | null;
}

// The script that finds the download control lives in hostsDriver.ts (tests/hostsDriver.test.ts).
export { PAGE_DRIVER, pageDriver } from './hostsDriver';
