import { nativeImage, protocol } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { parseFile, selectCover } from 'music-metadata';
import { library } from '../library';
import { FOLDER_IMAGE_NAMES, artBucket, artCacheName, fitWithin, videoThumbnailAttempts } from '../../core/artwork';
import { artworkCacheDir } from '../paths';
import { runTool, spawnTool, killTree } from '../process';
import { pipeArgs } from '../../core/streamPlan';
import { isStreamId, streamPlan } from './streams';
import { tools } from '../tools';
import { logger } from '../log';

const log = logger('protocol');
export const MEDIA_SCHEME = 'lumina-media';

const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.opus': 'audio/ogg', '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg', '.wav': 'audio/wav', '.webm': 'video/webm', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime', '.vtt': 'text/vtt', '.jpg': 'image/jpeg', '.png': 'image/png',
};

/** Must run before app 'ready'. */
export function registerMediaScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  ]);
}

function fileResponse(file: string, request: Request): Response {
  const stat = fs.statSync(file);
  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  const range = request.headers.get('range');
  // ACAO makes the stream CORS-clean so the player's Web Audio equalizer graph can tap it without muting.
  const headers: Record<string, string> = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    let start = m?.[1] ? Number(m[1]) : 0;
    let end = m?.[2] ? Number(m[2]) : stat.size - 1;
    if (!m?.[1] && m?.[2]) {
      start = Math.max(0, stat.size - Number(m[2]));
      end = stat.size - 1;
    }
    if (start >= stat.size || end < start) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
    end = Math.min(end, stat.size - 1);
    const stream = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream;
    return new Response(stream, { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': String(end - start + 1) } });
  }
  const stream = Readable.toWeb(fs.createReadStream(file)) as ReadableStream;
  return new Response(stream, { status: 200, headers: { ...headers, 'Content-Length': String(stat.size) } });
}

/** The original artwork bytes for an item — embedded cover, folder image or a video frame — cached once. */
async function sourceArt(item: NonNullable<ReturnType<typeof library.getById>>): Promise<Buffer | null> {
  const full = path.join(artworkCacheDir(), artCacheName(item.id, item.mtimeMs, 'full'));
  // Size-checked, not merely existence-checked: a truncated cache entry (a write interrupted by a
  // full disk or a kill) would otherwise be served as a broken image for ever.
  if (fs.existsSync(full) && fs.statSync(full).size > 0) return fs.readFileSync(full);

  if (item.kind === 'audio') {
    // A tag that cannot be read (a corrupt base64 picture block in an .opus or .flac threw "The string to be decoded is
    // not correctly encoded" 491 times in the log) must not cost the file its folder cover as well.
    let cover: ReturnType<typeof selectCover> = null;
    try {
      cover = selectCover((await parseFile(item.path, { duration: false })).common.picture);
    } catch (err) {
      log.debug(`Could not read the tags of ${item.path}; trying its folder for a cover`, err);
    }
    if (cover) {
      const bytes = Buffer.from(cover.data);
      fs.writeFileSync(full, bytes);
      return bytes;
    }
    for (const name of FOLDER_IMAGE_NAMES) {
      const p = path.join(path.dirname(item.path), name);
      if (fs.existsSync(p)) return fs.readFileSync(p);
    }
    return null;
  }
  // Video: the embedded cover if there is one, otherwise a frame from 10% in. The commands (and the
  // reason the specifier is spelled the way it is) live in core/artwork.ts, where a test pins them.
  for (const args of videoThumbnailAttempts({ input: item.path, output: full, durationSec: item.durationSec, hasArtwork: item.hasArtwork })) {
    const r = await runTool(tools.require('ffmpeg'), args, { timeoutMs: 30_000 });
    // A zero-byte file counts as a failure: ffmpeg can create the output before it gives up.
    if (r.code === 0 && fs.existsSync(full) && fs.statSync(full).size > 0) return fs.readFileSync(full);
    fs.rmSync(full, { force: true });
  }
  return null;
}

const imageType = (b: Buffer) => (b[0] === 0x89 && b[1] === 0x50 ? 'image/png' : 'image/jpeg');

const imageResponse = (bytes: Buffer) =>
  new Response(new Uint8Array(bytes), { headers: { 'Content-Type': imageType(bytes), 'Cache-Control': 'max-age=86400' } });

/**
 * Artwork at the size it will be shown (see core/artwork.ts for why this matters so much for GPU
 * memory). Every request goes through here — with or without `?s=` — so no request can hand the
 * renderer an image larger than ART_MAX.
 */
async function artwork(id: string, requested: string | null): Promise<Response> {
  const item = library.getById(id);
  if (!item || !fs.existsSync(item.path)) return new Response(null, { status: 404 });

  const size = artBucket(requested);
  const sized = path.join(artworkCacheDir(), artCacheName(item.id, item.mtimeMs, size));
  if (fs.existsSync(sized)) return imageResponse(fs.readFileSync(sized));

  // A file with no usable artwork was re-opened and re-parsed on every request, and a list shows it many times.
  // Remembered per file version (id + mtime) for this run; the cap keeps it from growing with a huge library.
  const missKey = `${item.id}:${item.mtimeMs}`;
  if (noArtwork.has(missKey)) return new Response(null, { status: 404 });
  const miss = () => {
    if (noArtwork.size >= 5000) noArtwork.clear();
    noArtwork.add(missKey);
    return new Response(null, { status: 404 });
  };

  try {
    const source = await sourceArt(item);
    if (!source) return miss();
    const image = nativeImage.createFromBuffer(source);
    // An image Chromium can't decode is passed through untouched rather than dropped.
    if (image.isEmpty()) return imageResponse(source);
    const { width, height } = image.getSize();
    const fit = fitWithin(width, height, size);
    if (!fit) return imageResponse(source);
    const resized = image.resize({ width: fit.width, height: fit.height, quality: 'good' }).toJPEG(84);
    fs.writeFileSync(sized, resized);
    return imageResponse(resized);
  } catch (err) {
    log.debug(`No artwork for ${item.path}`, err);
    return miss();
  }
}

/** Files (by id and modification time) already found to have no artwork, so they are not parsed again on every request. */
const noArtwork = new Set<string>();

/**
 * ffmpeg's output as a response body. The pipe is paused whenever the player has all it asked for: a link can be read
 * far faster than it plays, and an unpaused pipe would pile the whole film up in memory.
 */
function ffmpegResponse(args: string[]): Response {
  const child = spawnTool(tools.require('ffmpeg'), args, { detached: false });
  let stderr = '';
  child.stderr?.on('data', (c: Buffer) => { stderr = (stderr + c.toString()).slice(-1500); });
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      child.stdout?.on('data', (c: Buffer) => {
        if (!open) return;
        controller.enqueue(new Uint8Array(c));
        if ((controller.desiredSize ?? 1) <= 0) child.stdout?.pause();
      });
      child.stdout?.on('end', () => { if (open) controller.close(); });
      child.on('error', (err) => { if (open) controller.error(err); });
      child.on('close', (code) => { if (code && open) log.warn(`ffmpeg stopped with code ${code}`, stderr.trim()); });
    },
    pull() {
      child.stdout?.resume();
    },
    cancel() {
      open = false;
      killTree(child);
    },
  }, { highWaterMark: 64 });
  return new Response(stream, { headers: { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });
}

function remux(id: string, startSec: number): Response {
  if (isStreamId(id)) {
    const plan = streamPlan(id);
    if (!plan) return new Response(null, { status: 404 });
    return ffmpegResponse(pipeArgs(plan.mode === 'pipe' ? plan.sources : [plan.source], Math.max(0, startSec)));
  }
  const item = library.getById(id);
  if (!item || !fs.existsSync(item.path)) return new Response(null, { status: 404 });
  return ffmpegResponse([
    '-v', 'error', '-ss', String(Math.max(0, startSec)), '-i', item.path,
    '-map', '0:v:0?', '-map', '0:a:0?', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-ac', '2',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1',
  ]);
}

/** A progressive file somewhere on the web, passed through with the player's Range requests. */
async function proxyStream(token: string, request: Request): Promise<Response> {
  const plan = streamPlan(token);
  if (!plan || plan.mode !== 'proxy') return new Response('Not found', { status: 404 });
  const headers = new Headers(plan.source.headers);
  const range = request.headers.get('range');
  if (range) headers.set('Range', range);
  let upstream: Response;
  try {
    upstream = await fetch(plan.source.url, { headers, redirect: 'follow', signal: request.signal });
  } catch (err) {
    log.warn('A stream could not be reached', err);
    return new Response('Bad gateway', { status: 502 });
  }
  if (!upstream.ok) return new Response(null, { status: upstream.status });
  const out = new Headers({ 'Content-Type': plan.mime, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  if (upstream.status === 206 || /bytes/i.test(upstream.headers.get('accept-ranges') ?? '')) out.set('Accept-Ranges', 'bytes');
  for (const name of ['content-length', 'content-range']) {
    const v = upstream.headers.get(name);
    if (v) out.set(name, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

const VTT_HEADERS = { 'Content-Type': 'text/vtt; charset=utf-8', 'Access-Control-Allow-Origin': '*' };

/**
 * Subtitles for the player, as WebVTT. Finds any English `.srt`/`.vtt` sidecar (whatever the lang-code variant),
 * and if none exists falls back to extracting an embedded subtitle track with ffmpeg — so embed-only downloads and
 * imported videos with baked-in subtitle streams still show captions.
 */
async function subtitles(id: string): Promise<Response> {
  const item = library.getById(id);
  if (!item || !fs.existsSync(item.path)) return new Response('Not found', { status: 404 });
  const { parseCues, cuesToVtt } = await import('../../core/lyrics');
  const { pickSubtitleSidecar } = await import('../../core/subtitleFiles');

  const dir = path.dirname(item.path);
  const stem = path.basename(item.path, path.extname(item.path));
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir);
  } catch {
    // fall through to embedded extraction
  }
  const sidecar = pickSubtitleSidecar(stem, files);
  if (sidecar) {
    const text = fs.readFileSync(path.join(dir, sidecar), 'utf8');
    const vtt = /\.vtt$/i.test(sidecar) ? text : cuesToVtt(parseCues(text));
    return new Response(vtt, { headers: VTT_HEADERS });
  }

  // No sidecar: pull the first embedded subtitle track out as WebVTT (empty output → the file has none).
  try {
    const r = await runTool(tools.require('ffmpeg'), ['-v', 'error', '-i', item.path, '-map', '0:s:0?', '-f', 'webvtt', 'pipe:1'], { timeoutMs: 30_000 });
    if (r.code === 0 && r.stdout.trim()) return new Response(r.stdout, { headers: VTT_HEADERS });
  } catch (err) {
    log.debug(`No embedded subtitles for ${item.path}`, err);
  }
  return new Response('Not found', { status: 404 });
}

export function handleMediaProtocol() {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      const [kind, id] = [url.hostname, decodeURIComponent(url.pathname.replace(/^\//, ''))];
      if (kind === 'media') {
        const item = library.getById(id);
        if (!item || !fs.existsSync(item.path)) return new Response('Not found', { status: 404 });
        return fileResponse(item.path, request);
      }
      if (kind === 'remux') return remux(id, Number(url.searchParams.get('t') ?? 0));
      if (kind === 'stream') return await proxyStream(id, request);
      if (kind === 'art') return await artwork(id, url.searchParams.get('s'));
      if (kind === 'subs') return await subtitles(id);
      return new Response('Not found', { status: 404 });
    } catch (err) {
      log.warn('Media request failed', err);
      return new Response('Error', { status: 500 });
    }
  });
}
