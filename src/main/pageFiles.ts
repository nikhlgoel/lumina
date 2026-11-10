import type { RequestInfo } from '../shared/types';
import { extractFileLinks, githubAssets, githubReleaseApi, githubReleaseRef, isDirectoryIndex, type PageFile } from '../core/pageFiles';
import { cookieHeaderFor } from '../core/cookies';
import { settings } from './settings';
import { logger } from './log';

const log = logger('pagefiles');

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
/** A page bigger than this is not a list of links; reading it would only cost memory. */
const MAX_PAGE_BYTES = 3 * 2 ** 20;

export interface PageFilesResult {
  files: PageFile[];
  /** Where the list came from, for the screen to say so: a GitHub release, an open folder, or a page's own download links. */
  source: 'github' | 'folder' | 'page';
  title: string | null;
}

/** Headers worth passing on when reading a page. Not `authorization` or the like: the link may point at a host that is not the one they belong to. */
const PASS_ON = new Set(['user-agent', 'accept-language', 'referer']);

/** What to send to `url`: the cookies that belong to that address only, never the whole jar the extension collected for a different site. */
const headersFor = (url: string, request?: RequestInfo, accept = 'text/html,application/xhtml+xml'): Record<string, string> => {
  const h: Record<string, string> = { 'User-Agent': settings.get().network.userAgent || BROWSER_UA, Accept: accept };
  for (const [k, v] of Object.entries(request?.headers ?? {})) if (PASS_ON.has(k.toLowerCase()) && !/[\r\n]/.test(v)) h[k] = v;
  if (request?.pageUrl && !Object.keys(h).some((k) => k.toLowerCase() === 'referer')) h.Referer = request.pageUrl;
  const cookie = request?.cookies?.length ? cookieHeaderFor(url, request.cookies) : '';
  if (cookie) h.Cookie = cookie;
  return h;
};

const MAX_HOPS = 5;

/** A GET that follows redirects itself, so each hop gets only its own cookies (a redirect to another site must not carry this site's). */
async function getFollowing(start: string, request: RequestInfo | undefined, accept?: string): Promise<{ res: Response; finalUrl: string }> {
  let current = start;
  for (let hop = 0; ; hop++) {
    const res = await fetch(current, { redirect: 'manual', headers: headersFor(current, request, accept), signal: AbortSignal.timeout(15_000) });
    const where = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && where) {
      void res.body?.cancel();
      if (hop >= MAX_HOPS) throw new Error('Too many redirects');
      const next = new URL(where, current);
      if (!/^https?:$/.test(next.protocol)) throw new Error('Redirect to a non-web address');
      current = next.toString();
      continue;
    }
    return { res, finalUrl: current };
  }
}

/** The text of a page, or null when it is not a web page or is too big. Reads at most MAX_PAGE_BYTES. */
async function readPage(url: string, request?: RequestInfo): Promise<{ html: string; finalUrl: string } | null> {
  const { res, finalUrl: landed } = await getFollowing(url, request);
  const drop = () => void res.body?.cancel().catch(() => undefined); // an unread body holds its connection open
  if (!res.ok) { drop(); return null; }
  const type = res.headers.get('content-type') ?? '';
  if (!/text\/html|application\/xhtml/i.test(type)) { drop(); return null; }
  const length = Number(res.headers.get('content-length'));
  if (length && length > MAX_PAGE_BYTES) { drop(); return null; }
  const reader = res.body?.getReader();
  if (!reader) return { html: await res.text(), finalUrl: landed };
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_PAGE_BYTES) { void reader.cancel().catch(() => undefined); return null; }
    chunks.push(value);
  }
  return { html: Buffer.concat(chunks).toString('utf8'), finalUrl: landed };
}

/**
 * The files a web page offers, for a link that is a page and not a file or a video: a GitHub release, an open folder on a web server,
 * a page of download links. Empty when it offers none. Never throws for "nothing there": a network failure is an empty answer too,
 * because this is only asked after the link could not be opened any other way.
 */
export async function findPageFiles(rawUrl: string, request?: RequestInfo): Promise<PageFilesResult> {
  const none: PageFilesResult = { files: [], source: 'page', title: null };
  let url: URL;
  try { url = new URL(rawUrl); } catch { return none; }
  if (!/^https?:$/.test(url.protocol)) return none;

  try {
    const release = githubReleaseRef(url.toString());
    if (release) {
      const { res } = await getFollowing(githubReleaseApi(release), request, 'application/vnd.github+json');
      if (res.ok) {
        const json: unknown = await res.json();
        const named = json && typeof json === 'object' ? json as { name?: unknown; tag_name?: unknown } : {};
        const title = [named.name, named.tag_name].find((v): v is string => typeof v === 'string' && v.length > 0) ?? null;
        return { files: githubAssets(json), source: 'github', title };
      }
      log.debug('GitHub release lookup failed', { status: res.status, url: url.toString() });
      // rate limited or private: fall through to reading the page itself
    }
    const page = await readPage(url.toString(), request);
    if (!page) return none;
    const title = /<title[^>]{0,200}>([\s\S]{0,300}?)<\/title>/i.exec(page.html)?.[1]?.replace(/\s+/g, ' ').trim() || null;
    return { files: extractFileLinks(page.html, page.finalUrl), source: isDirectoryIndex(page.html) ? 'folder' : 'page', title };
  } catch (err) {
    log.debug('Reading the page for files failed', { url: url.toString(), err: String(err) });
    return none;
  }
}
