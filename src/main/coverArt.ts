// Writing cover art into media files, so a device that never opens Lumina still shows a picture.
//
// The problem this solves: a track with no embedded art looks fine in Lumina (the player draws a
// gradient from the title) but shows a blank tile on a TV reading the file off a USB stick. Here we
// turn that same gradient into a real image and put it into the file.
//
// Three deliberate choices:
//   * Streams are copied, never re-encoded. Embedding art must not touch a single audio sample.
//   * ffmpeg cannot write in place, so we write a sibling temp file and rename over the original
//     only after ffmpeg exits cleanly. A failure leaves the original untouched.
//   * Sidecar `folder.jpg` / `<name>.jpg` are written too, because plenty of TVs ignore tags
//     entirely but will happily show a picture sitting next to the file.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { canEmbedArtwork, embedArgs, rasterizeGradient, sidecarNames } from '../core/coverArt';
import { tools } from './tools';
import { logger } from './log';

const log = logger('cover');

/** Big enough for a TV grid, small enough that adding it to every track costs little. */
const COVER_SIZE = 600;

/* ---------- PNG encoding ---------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/**
 * Minimal PNG encoder for 8-bit RGB.
 *
 * Writing ~40 lines here avoids adding an image library for one gradient. Every scanline uses
 * filter type 0 (none), which compresses perfectly well for a smooth gradient.
 */
export function encodePng(rgb: Uint8Array, size: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;   // bit depth
  header[9] = 2;   // colour type 2 = truecolour RGB
  header[10] = 0;  // deflate
  header[11] = 0;  // adaptive filtering
  header[12] = 0;  // no interlace

  const stride = size * 3;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The generated cover for a title, as PNG bytes. */
export const coverPngFor = (seed: string, size = COVER_SIZE): Buffer =>
  encodePng(rasterizeGradient(seed, size), size);

/* ---------- reading and writing what a file carries ---------- */

function runFfmpeg(args: string[], timeoutMs = 120_000): Promise<{ ok: boolean; stderr: string }> {
  return new Promise((resolve) => {
    let bin: string;
    try {
      bin = tools.require('ffmpeg');
    } catch (err) {
      resolve({ ok: false, stderr: err instanceof Error ? err.message : String(err) });
      return;
    }
    const child = spawn(bin, args, { windowsHide: true });
    let stderr = '';
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString('utf8'); });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on('error', (err) => { clearTimeout(timer); resolve({ ok: false, stderr: err.message }); });
    child.on('exit', (code) => { clearTimeout(timer); resolve({ ok: code === 0, stderr }); });
  });
}

/** True when the file already carries a picture, so we leave it alone. */
export async function hasEmbeddedArtwork(file: string): Promise<boolean> {
  let bin: string;
  try {
    bin = tools.require('ffprobe');
  } catch {
    return false;
  }
  return new Promise((resolve) => {
    const child = spawn(bin, [
      '-v', 'error',
      '-select_streams', 'v',
      '-show_entries', 'stream=codec_name',
      '-of', 'csv=p=0',
      file,
    ], { windowsHide: true });
    let out = '';
    child.stdout?.on('data', (d: Buffer) => { out += d.toString('utf8'); });
    child.on('error', () => resolve(false));
    child.on('exit', () => resolve(out.trim().length > 0));
  });
}

export interface ArtworkResult {
  embedded: boolean;
  sidecars: number;
  reason?: string;
}

export interface ArtworkOptions {
  /** Replace a cover the file already has. */
  force?: boolean;
  /** Write `folder.jpg` next to it — one per album folder, which is what most TVs look for. */
  folderImage?: boolean;
  /** Write `<name>.jpg` next to it — right for loose videos, noisy for a 12-track album. */
  besideImage?: boolean;
  /**
   * Skip the tagging step.
   *
   * Set for video: adding a cover means ffmpeg rewrites the entire container, so a 2 GB film would
   * be copied twice for a thumbnail most TVs ignore anyway. The sidecar image does the job.
   */
  sidecarOnly?: boolean;
}

/**
 * Make sure `file` shows a picture on a dumb player.
 *
 * `seed` is what the gradient is derived from — pass the same string the library shows, usually the
 * album or the title, so the embedded art matches the app. When `force` is false an existing cover
 * is left alone.
 */
export async function ensureArtwork(file: string, seed: string, options: ArtworkOptions = {}): Promise<ArtworkResult> {
  const { force = false, folderImage = true, besideImage = false, sidecarOnly = false } = options;
  if (!fs.existsSync(file)) return { embedded: false, sidecars: 0, reason: 'The file is gone.' };

  const png = coverPngFor(seed);
  let sidecars = 0;

  // Written first: even if tagging fails, the TV still has something to show.
  const { beside, folder } = sidecarNames(file);
  const dir = path.dirname(file);
  const wanted = [
    ...(besideImage ? [beside] : []),
    ...(folderImage ? [folder] : []),
  ];
  for (const name of wanted) {
    const target = path.join(dir, name);
    try {
      // folder.jpg is shared by everything in the directory; the first track to arrive wins.
      if (name === folder && fs.existsSync(target)) continue;
      fs.writeFileSync(target, png);
      sidecars++;
    } catch (err) {
      log.debug(`Could not write ${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (sidecarOnly) return { embedded: false, sidecars, reason: 'Sidecar image only.' };

  if (!canEmbedArtwork(file)) {
    return { embedded: false, sidecars, reason: `${path.extname(file) || 'That format'} can’t carry embedded art.` };
  }
  if (!force && await hasEmbeddedArtwork(file)) {
    return { embedded: false, sidecars, reason: 'It already has a cover.' };
  }

  const ext = path.extname(file);
  const coverFile = path.join(dir, `.lumina-cover-${process.pid}.png`);
  const tempOut = path.join(dir, `.lumina-art-${process.pid}${ext}`);

  try {
    fs.writeFileSync(coverFile, png);
    const { ok, stderr } = await runFfmpeg(embedArgs(file, coverFile, tempOut));
    if (!ok || !fs.existsSync(tempOut)) {
      return { embedded: false, sidecars, reason: stderr.trim().split('\n').pop() || 'ffmpeg could not write the cover.' };
    }
    // Only now is the original replaced; a failure above leaves it exactly as it was.
    fs.renameSync(tempOut, file);
    log.info(`Embedded artwork into ${path.basename(file)}`);
    return { embedded: true, sidecars };
  } catch (err) {
    return { embedded: false, sidecars, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    fs.rmSync(coverFile, { force: true });
    fs.rmSync(tempOut, { force: true });
  }
}
