import { protocol } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { parseFile, selectCover } from 'music-metadata';
import { library } from '../library';
import { artworkCacheDir } from '../paths';
import { runTool, spawnTool, killTree } from '../process';
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

async function artwork(id: string): Promise<Response> {
  const item = library.getById(id);
  if (!item || !fs.existsSync(item.path)) return new Response(null, { status: 404 });
  const cached = path.join(artworkCacheDir(), `${id}-${item.mtimeMs}.jpg`);
  if (fs.existsSync(cached)) return new Response(fs.readFileSync(cached), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=86400' } });

  try {
    if (item.kind === 'audio') {
      const meta = await parseFile(item.path, { duration: false });
      const cover = selectCover(meta.common.picture);
      if (cover) {
        fs.writeFileSync(cached, cover.data);
        return new Response(Buffer.from(cover.data), { headers: { 'Content-Type': cover.format || 'image/jpeg', 'Cache-Control': 'max-age=86400' } });
      }
      for (const name of ['cover.jpg', 'folder.jpg', 'front.jpg', 'cover.png', 'folder.png']) {
        const p = path.join(path.dirname(item.path), name);
        if (fs.existsSync(p)) return fileResponse(p, new Request('lumina-media://x'));
      }
      return new Response(null, { status: 404 });
    }
    // Video: embedded cover if present, otherwise a frame from 10% in.
    const at = item.durationSec ? Math.max(1, item.durationSec * 0.1) : 5;
    const args = item.hasArtwork
      ? ['-v', 'error', '-i', item.path, '-map', '0:v:m:disposition:attached_pic', '-frames:v', '1', '-y', cached]
      : ['-v', 'error', '-ss', String(at), '-i', item.path, '-frames:v', '1', '-vf', 'scale=640:-2', '-y', cached];
    const r = await runTool(tools.require('ffmpeg'), args, { timeoutMs: 30_000 });
    if (r.code === 0 && fs.existsSync(cached)) return new Response(fs.readFileSync(cached), { headers: { 'Content-Type': 'image/jpeg' } });
  } catch (err) {
    log.debug(`No artwork for ${item.path}`, err);
  }
  return new Response(null, { status: 404 });
}

/** Repackage media Chromium can't open (AVI, WMV, MKV with AC-3…) into fragmented MP4 on the fly. */
function remux(id: string, startSec: number): Response {
  const item = library.getById(id);
  if (!item || !fs.existsSync(item.path)) return new Response(null, { status: 404 });
  const child = spawnTool(tools.require('ffmpeg'), [
    '-v', 'error', '-ss', String(Math.max(0, startSec)), '-i', item.path,
    '-map', '0:v:0?', '-map', '0:a:0?', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-ac', '2',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1',
  ], { detached: false });
  const stream = new ReadableStream({
    start(controller) {
      child.stdout?.on('data', (c: Buffer) => controller.enqueue(new Uint8Array(c)));
      child.stdout?.on('end', () => controller.close());
      child.on('error', (err) => controller.error(err));
    },
    cancel() {
      killTree(child);
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });
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
      if (kind === 'art') return await artwork(id);
      if (kind === 'subs') {
        const item = library.getById(id);
        const srt = item ? `${item.path.slice(0, -path.extname(item.path).length)}.en.srt` : '';
        if (!item || !fs.existsSync(srt)) return new Response('Not found', { status: 404 });
        const { parseCues, cuesToVtt } = await import('../../core/lyrics');
        return new Response(cuesToVtt(parseCues(fs.readFileSync(srt, 'utf8'))), { headers: { 'Content-Type': 'text/vtt; charset=utf-8' } });
      }
      return new Response('Not found', { status: 404 });
    } catch (err) {
      log.warn('Media request failed', err);
      return new Response('Error', { status: 500 });
    }
  });
}
