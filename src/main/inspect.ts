import fs from 'node:fs';
import path from 'node:path';
import type { MediaInfo, PlaylistEntry, RequestInfo } from '../shared/types';
import { classifyUrl, cleanUrl, isMusicSite, siteName } from '../core/url';
import { directApiUrl, isPageHost } from '../core/hosts';
import { fileNameFromUrl } from '../core/batch';
import { parseStreams, parseSubtitles, type RawFormat } from '../core/streams';
import { friendlyYtdlpError, isCookieReadError } from '../core/progress';
import { browserCookiesUnreadable, markBrowserCookiesUnreadable } from './cookieHealth';
import { requestArgs } from '../core/ytdlpArgs';
import { parseExtraArgs } from '../shared/settings';
import { tools } from './tools';
import { settings } from './settings';
import { runTool } from './process';
import { requestContext } from './request';
import { inspectSpotify, parseSpotifyUrl } from './services/spotify';
import { tempDir } from './paths';
import { logger } from './log';

const log = logger('inspect');
/** Sites where a link is always a page for yt-dlp, never a file; skips the extra probe request. */
const KNOWN_MEDIA_SITES = /(^|\.)(youtube\.com|youtu\.be|soundcloud\.com|vimeo\.com|twitch\.tv|twitter\.com|x\.com|instagram\.com|tiktok\.com|facebook\.com|reddit\.com|bilibili\.com|dailymotion\.com|bandcamp\.com|mixcloud\.com|kick\.com|rumble\.com)$/i;
const BROWSER_UA ='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const base = (url: string, site: string): Omit<MediaInfo, 'sourceKind' | 'title'> => ({
  url, site, uploader: site, thumbnail: null, durationSec: null, isLive: false, isMusic: false,
  videoStreams: [], audioStreams: [], subtitles: [], entries: [],
});

export async function inspect(rawUrl: string, request?: RequestInfo): Promise<MediaInfo> {
  const url = cleanUrl(rawUrl);
  const kind = classifyUrl(url);
  if (kind === 'invalid') {
    if (fs.existsSync(url) && url.toLowerCase().endsWith('.torrent')) return inspectTorrentFile(url);
    if (/^spotify:/.test(url) && parseSpotifyUrl(url)) return inspectSpotify(url);
    throw new Error('That doesn’t look like a link Lumina can open. Paste an http(s) link, a magnet link or a .torrent file.');
  }
  if (kind === 'magnet') return inspectMagnet(url);
  if (kind === 'torrent-file') {
    return fs.existsSync(url)
      ? inspectTorrentFile(url)
      : { ...base(url, 'BitTorrent'), sourceKind: 'torrent', title: decodeURIComponent(path.basename(new URL(url).pathname)), torrent: { name: '', files: [], infoHash: null }, request };
  }
  if (parseSpotifyUrl(url)) return inspectSpotify(url);
  const api = directApiUrl(url);
  if (api) {
    const direct = await inspectDirect(api, request).catch(() => null);
    if (direct) return { ...direct, url: api };
  }
  // File hosts: the link is a download page; the real file is fetched when the download starts.
  if (isPageHost(url) && !request) return inspectHosted(url);
  if (kind === 'direct') {
    const direct = await inspectDirect(url, request).catch((err) => {
      log.debug('Direct probe failed', err);
      return null;
    });
    if (direct) return direct;
    // Named like a file but answered with a web page: an unknown file host's download page.
    if (fileNameFromUrl(url) && !request) return inspectHosted(url);
  }
  if (kind === 'web' && !KNOWN_MEDIA_SITES.test(new URL(url).hostname)) {
    // Many "download" links don't end in a file extension; ask the server what it is before trying extractors.
    const direct = await inspectDirect(url, request).catch(() => null);
    if (direct) return direct;
  }
  const info = await inspectWithYtdlp(url, request, !browserCookiesUnreadable());
  return kind === 'stream' ? { ...info, stream: { protocol: /\.mpd/i.test(url) ? 'dash' : 'hls', encrypted: false }, request } : info;
}

function inspectHosted(url: string): MediaInfo {
  const filename = fileNameFromUrl(url) || 'download';
  return {
    ...base(url, siteName(url)), sourceKind: 'direct', title: filename,
    direct: { filename, sizeBytes: null, resumable: true, hosted: true },
    notes: ['This file host shows a download page first. Lumina opens it in the background and clicks through when the download starts.'],
  };
}

function inspectMagnet(url: string): MediaInfo {
  const params = new URLSearchParams(url.replace(/^magnet:\?/i, ''));
  const hash = params.get('xt')?.replace(/^urn:btih:/i, '') ?? null;
  const name = params.get('dn') ?? `Torrent ${hash?.slice(0, 8) ?? ''}`.trim();
  return { ...base(url, 'BitTorrent'), sourceKind: 'torrent', title: name, torrent: { name, files: [], infoHash: hash } };
}

async function inspectTorrentFile(file: string): Promise<MediaInfo> {
  const files: string[] = [];
  let name = path.basename(file, '.torrent');
  if (tools.has('aria2c')) {
    const r = await runTool(tools.require('aria2c'), ['--show-files=true', file], { timeoutMs: 30_000 });
    for (const line of r.stdout.split(/\r?\n/)) {
      const m = line.match(/^\s*\d+\|(.+)$/);
      if (m?.[1]) files.push(m[1].trim());
      const n = line.match(/^Name:\s*(.+)$/);
      if (n?.[1]) name = n[1].trim();
    }
  }
  return { ...base(file, 'BitTorrent'), sourceKind: 'torrent', title: name, torrent: { name, files, infoHash: null } };
}

const MEDIA_OR_FILE = /^(video|audio|application\/(octet-stream|zip|x-|pdf|vnd|gzip|java-archive)|image\/(?!svg))/i;

/**
 * Probe a URL for a downloadable file. Uses a 1-byte ranged GET (many servers mishandle HEAD)
 * with the same headers the browser used, if the link came from the extension.
 */
async function inspectDirect(url: string, request?: RequestInfo): Promise<MediaInfo | null> {
  const headers: Record<string, string> = { 'User-Agent': settings.get().network.userAgent || BROWSER_UA, Range: 'bytes=0-0', ...(request?.headers ?? {}) };
  if (request?.pageUrl && !headers.Referer) headers.Referer = request.pageUrl;
  if (request?.cookies.length) headers.Cookie = request.cookies.map((c) => `${c.name}=${c.value}`).join('; ');

  const controller = new AbortController();
  const res = await fetch(url, { method: 'GET', redirect: 'follow', headers, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
  controller.abort(); // we only need the headers
  if (!res.ok && res.status !== 206) return null;
  const type = res.headers.get('content-type') ?? '';
  if (/text\/html|application\/(json|xhtml)/i.test(type)) return null;
  if (/mpegurl|dash\+xml/i.test(type)) return null; // a stream manifest: let yt-dlp handle it
  const disposition = res.headers.get('content-disposition');
  if (!MEDIA_OR_FILE.test(type) && !disposition) return null;

  let filename = decodeURIComponent(path.basename(new URL(res.url || url).pathname)) || 'download';
  const m = disposition?.match(/filename\*=(?:UTF-8'')?([^;]+)|filename="?([^";]+)"?/i);
  const raw = m?.[1] ?? m?.[2];
  if (raw) {
    try {
      filename = decodeURIComponent(raw.trim());
    } catch {
      filename = raw.trim();
    }
  }
  const range = res.headers.get('content-range')?.match(/\/(\d+)$/)?.[1];
  const size = Number(range ?? res.headers.get('content-length')) || null;
  return {
    ...base(url, siteName(request?.pageUrl ?? url)), sourceKind: 'direct', title: filename,
    direct: { filename, sizeBytes: size, resumable: res.status === 206 || res.headers.get('accept-ranges') === 'bytes', mime: type || undefined },
    request,
  };
}

interface YtdlpJson {
  _type?: string;
  id?: string;
  title?: string;
  uploader?: string;
  channel?: string;
  artist?: string;
  creator?: string;
  thumbnail?: string;
  thumbnails?: { url?: string }[];
  duration?: number;
  is_live?: boolean;
  has_drm?: boolean;
  formats?: (RawFormat & { has_drm?: boolean })[];
  subtitles?: Record<string, unknown>;
  automatic_captions?: Record<string, unknown>;
  entries?: YtdlpJson[];
  url?: string;
  webpage_url?: string;
  extractor_key?: string;
}

async function inspectWithYtdlp(url: string, request?: RequestInfo, browserCookies = true): Promise<MediaInfo> {
  const workDir = fs.mkdtempSync(path.join(tempDir(), 'inspect-'));
  try {
    const ctx = requestContext(request, workDir, { withBrowserCookies: browserCookies });
    const args = ['--ignore-config', '--no-warnings', '--js-runtimes', tools.jsRuntime(), ...requestArgs(ctx), ...parseExtraArgs(settings.get().advanced.extraYtdlpArgs).args, '-J', '--flat-playlist', '--', url];
    const r = await runTool(tools.require('yt-dlp'), args, { timeoutMs: 90_000, env: tools.env() });

    if (r.code !== 0 || !r.stdout.trim()) {
      if (browserCookies && ctx.cookies.browser && isCookieReadError(r.stderr)) {
        log.info('Browser cookies unreadable; inspecting without them');
        markBrowserCookiesUnreadable();
        const info = await inspectWithYtdlp(url, request, false);
        return { ...info, notes: [...(info.notes ?? []), `Couldn’t read ${ctx.cookies.browser}’s cookies, so this was opened signed-out. Sign in under Settings › Accounts for private or members-only media.`] };
      }
      const msg = r.stderr.split(/\r?\n/).find((l) => l.startsWith('ERROR:'))?.slice(6).trim() ?? r.stderr.trim().split(/\r?\n/).pop() ?? 'yt-dlp could not read this link.';
      log.warn('Inspect failed', { url, stderr: r.stderr.slice(-2000) });
      throw new Error(friendlyYtdlpError(msg));
    }

    const data = JSON.parse(r.stdout) as YtdlpJson;
    const site = siteName(request?.pageUrl ?? url);
    const thumbnail = data.thumbnail ?? data.thumbnails?.at(-1)?.url ?? null;

    if (data._type === 'playlist') {
      const entries: PlaylistEntry[] = (data.entries ?? []).map((e, i) => ({
        index: i + 1,
        id: e.id ?? String(i + 1),
        title: e.title ?? `Item ${i + 1}`,
        uploader: e.uploader ?? e.channel ?? '',
        durationSec: e.duration ?? null,
        url: e.url ?? e.webpage_url ?? '',
        thumbnail: e.thumbnails?.at(-1)?.url ?? null,
      }));
      return {
        ...base(url, site), sourceKind: 'playlist', title: data.title ?? 'Playlist', uploader: data.uploader ?? data.channel ?? site,
        thumbnail: thumbnail ?? entries[0]?.thumbnail ?? null,
        durationSec: entries.reduce((sum, e) => sum + (e.durationSec ?? 0), 0) || null,
        isMusic: isMusicSite(url), entries, request,
      };
    }

    const formats = data.formats ?? [];
    if (data.has_drm || (formats.length > 0 && formats.every((f) => f.has_drm))) {
      throw new Error('This media is protected by DRM, so it can’t be downloaded.');
    }
    const usable = formats.filter((f) => !f.has_drm);
    const { video, audio } = parseStreams(usable, data.duration ?? null);
    return {
      ...base(url, site), sourceKind: 'media', title: data.title ?? request?.pageTitle ?? 'Untitled',
      uploader: data.artist ?? data.creator ?? data.uploader ?? data.channel ?? site,
      thumbnail, durationSec: data.duration ?? null, isLive: Boolean(data.is_live),
      isMusic: isMusicSite(url) || (video.length === 0 && audio.length > 0),
      videoStreams: video, audioStreams: audio,
      subtitles: parseSubtitles(data.subtitles, data.automatic_captions),
      request,
    };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}
