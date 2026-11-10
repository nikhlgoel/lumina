// Turning an ordinary web page into the files it offers.
//
// Measured in the real app (2026-11-10): a GitHub release page, a GitHub file page and an open directory index each ended in
// "Lumina doesn't recognise media on this page", although every one of them is a place people download files from. This file
// holds the pure parts of the cure: rewriting share links to the file itself, reading a GitHub release, and finding the
// file links in a page (an open directory, a downloads page). Nothing here touches the network.

export interface PageFile { url: string; name: string; sizeBytes?: number }

/** The wording the Download screen sees when yt-dlp has no extractor for a page. Only then is the page worth reading for files. */
export const isNoMediaMessage = (message: string): boolean => /doesn.t recognise media on this page/i.test(message);

const decode = (s: string): string => { try { return decodeURIComponent(s); } catch { return s; } };

/**
 * A share or "view" link that has an address of the file itself.
 *
 * GitHub/GitLab file pages are HTML pages about the file; the raw address is the file. Dropbox hands out `dl=0` (a preview page) and
 * answers `dl=1` with the file. A Google Drive "view" link is a preview page; the download address is built from the file id.
 * Returns null when the link is not one of these, so callers can leave it alone.
 */
export function rewriteShareLink(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');

  if (host === 'github.com') {
    const m = /^\/([^/]+)\/([^/]+)\/blob\/(.+)$/.exec(u.pathname);
    if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`;
    return null;
  }
  if (host === 'gitlab.com') {
    const m = /^(\/.+?)\/-\/blob\/(.+)$/.exec(u.pathname);
    if (m) return `https://gitlab.com${m[1]}/-/raw/${m[2]}`;
    return null;
  }
  if (host === 'huggingface.co') {
    // A model or dataset file page ("blob") and the file itself ("resolve") differ by one word.
    const m = /^(\/(?:datasets\/|spaces\/)?[^/]+\/[^/]+)\/blob\/(.+)$/.exec(u.pathname);
    if (m) return `https://huggingface.co${m[1]}/resolve/${m[2]}${u.search}`;
    return null;
  }
  if (host === 'codeberg.org') {
    const m = /^\/([^/]+)\/([^/]+)\/src\/(branch|tag|commit)\/(.+)$/.exec(u.pathname);
    if (m) return `https://codeberg.org/${m[1]}/${m[2]}/raw/${m[3]}/${m[4]}`;
    return null;
  }
  if (host === 'dropbox.com') {
    if (!/^\/(s|scl|sh)\//.test(u.pathname)) return null;
    if (u.searchParams.get('dl') === '1') return null;
    u.searchParams.delete('dl');
    u.searchParams.delete('raw');
    u.searchParams.set('dl', '1');
    return u.toString();
  }
  if (host === 'drive.google.com') {
    const id = /^\/file\/d\/([\w-]{10,})/.exec(u.pathname)?.[1]
      ?? (/^\/(open|uc)$/.test(u.pathname) ? u.searchParams.get('id') : null);
    if (id && /^[\w-]{10,}$/.test(id)) return `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;
    return null;
  }
  return null;
}

export interface GithubReleaseRef { owner: string; repo: string; tag: string | null }

/** `github.com/o/r/releases/tag/v1`, `/releases/latest` (tag null) or `/releases`: the release whose files are wanted. */
export function githubReleaseRef(raw: string): GithubReleaseRef | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.hostname.toLowerCase().replace(/^www\./, '') !== 'github.com') return null;
  const m = /^\/([^/]+)\/([^/]+)\/releases(?:\/(tag)\/(.+?)|\/(latest))?\/?$/.exec(u.pathname);
  const [, owner, repo, kind, name] = m ?? [];
  if (!owner || !repo) return null;
  return { owner, repo, tag: kind === 'tag' && name ? decode(name) : null };
}

/** The API address that describes that release (the page itself loads its file list with a script, so its HTML has none). */
export const githubReleaseApi = (r: GithubReleaseRef): string =>
  `https://api.github.com/repos/${r.owner}/${r.repo}/releases/${r.tag ? `tags/${encodeURIComponent(r.tag)}` : 'latest'}`;

/** The downloadable files of a GitHub release API answer, with their sizes. Source archives are included: they are files people want too. */
export function githubAssets(json: unknown): PageFile[] {
  const rel = json as { assets?: { name?: string; browser_download_url?: string; size?: number }[]; zipball_url?: string; tarball_url?: string; tag_name?: string } | null;
  if (!rel || typeof rel !== 'object') return [];
  const out: PageFile[] = [];
  for (const a of rel.assets ?? []) {
    if (a?.browser_download_url && a.name) out.push({ url: a.browser_download_url, name: a.name, sizeBytes: typeof a.size === 'number' ? a.size : undefined });
  }
  return out;
}

/** Extensions of things people download. Pages and images are left out on purpose: a page full of links to pages is not a file list. */
const FILE_EXT = [
  'zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'xz', 'bz2', 'zst', 'iso', 'img', 'cab',
  'exe', 'msi', 'msix', 'dmg', 'pkg', 'deb', 'rpm', 'appimage', 'apk', 'jar',
  'pdf', 'epub', 'mobi', 'azw3', 'djvu', 'cbz', 'cbr',
  'mp3', 'flac', 'm4a', 'm4b', 'ogg', 'opus', 'wav', 'aac', 'wma',
  'mp4', 'mkv', 'webm', 'avi', 'mov', 'm4v', 'wmv', 'ts',
  'torrent', 'sig', 'asc', 'sha256', 'sha512', 'md5',
];
const EXT_RE = new RegExp(`\\.(${FILE_EXT.join('|')})(\\.\\d{3})?$`, 'i');

/** A link that ends in a file extension, ignoring its query. Multi-part names (.7z.001, .tar.gz) count. */
export const looksLikeFileLink = (url: string): boolean => {
  try { return EXT_RE.test(new URL(url).pathname); } catch { return false; }
};

const stripTags = (s: string): string => s.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, '\'').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

/** Is this the automatic listing a web server makes for a folder (Apache, nginx, lighttpd, Caddy, python http.server)? */
export const isDirectoryIndex = (html: string): boolean =>
  /<title>\s*Index of\s/i.test(html) || /<h1>\s*Index of\s/i.test(html) || /<title>\s*Directory listing for\s/i.test(html);

/**
 * The file links in a page, in page order, each once. Relative links are resolved against `base`.
 *
 * In a directory index only links that stay in that folder count (the parent link, and the sort links "?C=N;O=D", are not files).
 * In an ordinary page a link counts when it ends in a file extension, on any host (downloads usually sit on a CDN).
 * `max` keeps a page of thousands of links from flooding the batch screen.
 */
export function extractFileLinks(html: string, base: string, max = 300): PageFile[] {
  if (html.length > MAX_SCANNED_HTML) html = html.slice(0, MAX_SCANNED_HTML);
  const out: PageFile[] = [];
  const seen = new Set<string>();
  const index = isDirectoryIndex(html);
  let baseUrl: URL;
  try { baseUrl = new URL(base); } catch { return out; }
  // Every part is bounded: a page of unclosed tags made the unbounded form rescan to the end of the page from each one (quadratic), and this
  // runs in the main process on up to 3 MB of someone else's HTML.
  const re = /<a\b[^<>]{0,2000}?\bhref\s*=\s*(?:"([^"]{0,4000})"|'([^']{0,4000})')[^<>]{0,2000}>([\s\S]{0,600}?)<\/a>/gi;
  for (let m = re.exec(html); m && out.length < max; m = re.exec(html)) {
    const href = (m[1] ?? m[2] ?? '').replace(/&amp;/g, '&').trim();
    if (!href || href.startsWith('#') || /^(javascript|mailto|data):/i.test(href)) continue;
    let abs: URL;
    try { abs = new URL(href, baseUrl); } catch { continue; }
    if (!/^https?:$/.test(abs.protocol)) continue;
    abs.hash = '';
    if (index) {
      if (abs.origin !== baseUrl.origin || abs.search) continue;
      if (abs.pathname.endsWith('/')) continue; // a sub-folder or the parent
      if (!abs.pathname.startsWith(baseUrl.pathname.replace(/[^/]*$/, ''))) continue;
    } else if (!looksLikeFileLink(abs.toString())) {
      continue;
    }
    const url = abs.toString();
    if (seen.has(url)) continue;
    seen.add(url);
    const fromPath = decode(abs.pathname.split('/').filter(Boolean).pop() ?? '');
    const text = stripTags(m[3] ?? '');
    // The link's own text wins only when it is itself a file name (a "Download" button says nothing about the file).
    const name = EXT_RE.test(text) && !/\s{2,}/.test(text) && text.length < 200 ? text : fromPath || text || url;
    out.push({ url, name });
  }
  // A page can draw its links with script from lists kept in data attributes (a tab per file host), leaving no links in the HTML at all.
  // Only when there are none: otherwise the links the person sees are the ones they chose, and the other tabs are alternatives.
  if (!out.length) {
    const first = embeddedLinkLists(html, base)[0];
    if (first) out.push(...first.files.slice(0, max));
  }
  return out;
}

/** More than this of a page is not read for links; real link pages are a few tens of kilobytes. */
const MAX_SCANNED_HTML = 2_000_000;
const URL_KEYS = ['direct_link', 'url', 'href', 'link', 'download_url'];
const NAME_KEYS = ['file_name', 'filename', 'name'];
const unescapeAttr = (s: string): string => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/**
 * Lists of files a page keeps as JSON in a data attribute: `<div data-links='[{"direct_link": "...", "file_name": "..."}]'>Pixeldrain</div>`.
 * Hoster pages use one per file host and show only the selected one, so the others never appear as links. Each list is labelled by the text
 * of the element that holds it. An entry the page itself marks `is_dangerous` is left out: the page is warning about it.
 */
export function embeddedLinkLists(html: string, base: string): { label: string; files: PageFile[] }[] {
  let baseUrl: URL;
  try { baseUrl = new URL(base); } catch { return []; }
  const out: { label: string; files: PageFile[] }[] = [];
  if (html.length > MAX_SCANNED_HTML) html = html.slice(0, MAX_SCANNED_HTML);
  // Bounded for the same reason as the anchor pattern above; the list stops at the next quote, so a start cannot rescan the page.
  const re = /<[a-z][\w-]*\b[^<>]{0,2000}?\sdata-[\w-]+\s*=\s*(?:'(\[[^']{0,60000}\])'|"(\[[^"]{0,60000}\])")[^<>]{0,2000}>([^<]{0,80})/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    let parsed: unknown;
    try { parsed = JSON.parse(m[1] ?? unescapeAttr(m[2] ?? '')); } catch { continue; }
    if (!Array.isArray(parsed)) continue;
    const files: PageFile[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      if (rec.is_dangerous === true) continue;
      const raw = URL_KEYS.map((k) => rec[k]).find((v): v is string => typeof v === 'string' && v.length > 0);
      if (!raw) continue;
      let abs: URL;
      try { abs = new URL(raw, baseUrl); } catch { continue; }
      if (!/^https?:$/.test(abs.protocol)) continue;
      const given = NAME_KEYS.map((k) => rec[k]).find((v): v is string => typeof v === 'string' && v.trim().length > 0);
      files.push({ url: abs.toString(), name: given?.trim() || decode(abs.pathname.split('/').filter(Boolean).pop() ?? '') || abs.toString() });
    }
    if (files.length) out.push({ label: stripTags(m[3] ?? ''), files });
  }
  return out;
}
