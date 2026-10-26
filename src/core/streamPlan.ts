/**
 * Playing a link without downloading it.
 *
 * Lumina never hands the player a remote address. A link is resolved to a *plan* held in the main process, and the
 * player is given a `lumina-media://stream/…` address for it, so the site's headers and cookies stay out of the page
 * and a seek or a codec fallback can be answered by the same code that plays a file.
 *
 * Two shapes are enough:
 *  - `proxy`: one progressive file the browser can decode. Passed through with its Range requests, so seeking is the
 *    server's own.
 *  - `pipe`: anything else (an HLS/DASH manifest, video and audio as separate files, a container the browser can't
 *    open). ffmpeg copies it into a fragmented MP4 as it goes. A seek restarts the pipe at an offset, as `remux` does.
 */

export interface StreamSource {
  url: string;
  /** Request headers the site wants (Referer, User-Agent, a Cookie), already stripped of line breaks. */
  headers: Record<string, string>;
}

export type StreamPlan =
  | { mode: 'proxy'; source: StreamSource; mime: string }
  | { mode: 'pipe'; sources: StreamSource[] };

/** The slice of yt-dlp's JSON that planning reads. */
export interface PlayFormat {
  url?: string;
  ext?: string | null;
  protocol?: string | null;
  vcodec?: string | null;
  http_headers?: Record<string, string>;
  cookies?: string;
}

export interface PlayJson extends PlayFormat {
  requested_formats?: PlayFormat[];
  is_live?: boolean;
}

/** What Chromium plays from a plain file, by extension. */
const BROWSER_MIME: Record<string, string> = {
  mp4: 'video/mp4', m4v: 'video/mp4', m4a: 'audio/mp4', webm: 'video/webm', mp3: 'audio/mpeg', ogg: 'audio/ogg',
  oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac', aac: 'audio/aac', mov: 'video/mp4',
};

/** A server-reported type that is safe to trust as "the browser plays this"; matroska, avi and the like are not. */
const BROWSER_PLAYABLE_MIME = /^(audio|video)\/(mp4|webm|mpeg|ogg|wav|flac|aac)/i;

/** Protocols that are a list of segments, not one file. */
const SEGMENTED = /m3u8|dash|f4m|ism|rtmp|rtsp|mms/i;

export const isHttpUrl = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\//i.test(u);

/** Header values are written into ffmpeg's `-headers` text, where a line break would start another header. */
export function cleanHeaders(raw: Record<string, string> | undefined, cookie?: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (typeof v !== 'string' || /[\r\n:]/.test(k) || /[\r\n]/.test(v)) continue;
    out[k] = v;
  }
  if (cookie && !/[\r\n]/.test(cookie) && !Object.keys(out).some((k) => k.toLowerCase() === 'cookie')) out.Cookie = cookie;
  return out;
}

const sourceOf = (f: PlayFormat, extra?: Record<string, string>): StreamSource | null =>
  isHttpUrl(f.url) ? { url: f.url, headers: { ...cleanHeaders(f.http_headers, f.cookies), ...cleanHeaders(extra) } } : null;

/**
 * The yt-dlp format selector for playing. A single progressive MP4 with sound is preferred: it starts at once and seeks
 * by itself. Failing that, the best video and audio that fit (ffmpeg joins them), then anything at all.
 */
export function playFormatSelector(opts: { audioOnly: boolean; maxHeight: number | null }): string {
  if (opts.audioOnly) return 'ba[protocol!*=m3u8][protocol!*=dash]/ba/b';
  const h = opts.maxHeight ? `[height<=?${opts.maxHeight}]` : '';
  const muxed = `b[ext=mp4][protocol!*=m3u8][protocol!*=dash][acodec!=none][vcodec!=none]${h}[height>=?480]`;
  return `${muxed}/bv*${h}+ba/b${h}/b`;
}

/** Turns what yt-dlp resolved into a plan, or says why there is nothing to play. */
export function planFromYtdlp(json: PlayJson, extraHeaders?: Record<string, string>): StreamPlan {
  if (json.is_live) throw new Error('Live streams can’t be played here yet. Open the page in the browser instead.');
  const parts = json.requested_formats?.length ? json.requested_formats : [json];
  const sources = parts.map((p) => sourceOf(p, extraHeaders));
  if (sources.some((s) => !s)) throw new Error('This link has nothing Lumina can play.');
  const ok = sources as StreamSource[];

  const only = parts.length === 1 ? parts[0] : undefined;
  const onlySource = ok[0];
  if (only && onlySource) {
    const mime = BROWSER_MIME[(only.ext ?? '').toLowerCase()];
    if (mime && !SEGMENTED.test(only.protocol ?? '')) return { mode: 'proxy', source: onlySource, mime };
  }
  return { mode: 'pipe', sources: ok };
}

/**
 * Whether what was resolved has a picture. Only an explicit "no video codec" says it hasn't: an HLS variant often reports no
 * codec at all, and a stream of unknown content is shown as video rather than as a music note over a moving picture.
 */
export function hasVideo(json: PlayJson): boolean {
  const parts = json.requested_formats?.length ? json.requested_formats : [json];
  return parts.some((p) => (p.vcodec ?? '').toLowerCase() !== 'none');
}

/** A plan for a link that is itself the file (no yt-dlp involved). */
export function planFromDirect(url: string, opts: { mime?: string; filename?: string; headers?: Record<string, string> } = {}): StreamPlan {
  if (!isHttpUrl(url)) throw new Error('Only web links can be played.');
  const source: StreamSource = { url, headers: cleanHeaders(opts.headers) };
  let named = opts.filename ?? '';
  if (!named) {
    try { named = new URL(url).pathname; } catch { /* a link that parses as no URL has no extension */ }
  }
  const byExt = BROWSER_MIME[named.split('.').pop()?.toLowerCase() ?? ''];
  const byType = opts.mime && BROWSER_PLAYABLE_MIME.test(opts.mime) ? opts.mime : undefined;
  const mime = byExt ?? byType;
  return mime ? { mode: 'proxy', source, mime } : { mode: 'pipe', sources: [source] };
}

/** `-headers` takes one string, one header per CRLF-terminated line. */
export const ffmpegHeaderText = (headers: Record<string, string>): string =>
  Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join('');

/**
 * ffmpeg arguments that copy a plan's sources into a fragmented MP4 on stdout, starting `startSec` in.
 * Video is copied; audio is made AAC because the common web audio codec (Opus in WebM) doesn't fit an MP4 everywhere.
 */
export function pipeArgs(sources: StreamSource[], startSec: number): string[] {
  const args = ['-v', 'error', '-nostdin'];
  for (const s of sources) {
    args.push('-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5');
    const headers = ffmpegHeaderText(s.headers);
    if (headers) args.push('-headers', headers);
    if (startSec > 0) args.push('-ss', String(Math.floor(startSec)));
    args.push('-i', s.url);
  }
  if (sources.length > 1) args.push('-map', '0:v:0', '-map', '1:a:0');
  else args.push('-map', '0:v:0?', '-map', '0:a:0?');
  args.push(
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-ac', '2',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1',
  );
  return args;
}
