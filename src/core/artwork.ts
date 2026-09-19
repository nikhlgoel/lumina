// Artwork sizing: serve covers at the size they are shown, not the size they were embedded.
//
// Why this exists: embedded covers are routinely 1000–3000px square, and Chromium keeps every
// decoded image in GPU memory at full resolution. One 1500×1500 cover is ~9 MB of GPU memory to
// draw a 36px library row. Measured on 2026-09-18: opening the Library grew the GPU process by
// +93 MB. Serving a right-sized copy removes that cost without changing what anyone sees.
//
// Sizes are bucketed (not arbitrary) so the on-disk cache stays small and hits often.

/** The only sizes ever produced. The largest is enough for the full-screen player on a HiDPI display. */
export const ART_BUCKETS = [128, 256, 512, 1024] as const;
export type ArtBucket = (typeof ART_BUCKETS)[number];

export const ART_MAX: ArtBucket = 1024;

/**
 * Map a requested size (from a `?s=` query, so any string at all) to a bucket: the smallest bucket
 * that is at least as large, so images are never upscaled into blur. Anything missing, invalid or
 * oversized gets the maximum — a request can never make Lumina produce a bigger image than 1024px.
 */
export function artBucket(requested: unknown): ArtBucket {
  const n = typeof requested === 'number' ? requested : typeof requested === 'string' && requested.trim() !== '' ? Number(requested) : NaN;
  if (!Number.isFinite(n) || n <= 0) return ART_MAX;
  return ART_BUCKETS.find((b) => b >= n) ?? ART_MAX;
}

/**
 * The dimensions to resize an image to so it fits inside `max`×`max`, keeping its aspect ratio —
 * or null when it already fits, in which case the original bytes are served untouched.
 */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } | null {
  if (!(width > 0) || !(height > 0) || !(max > 0)) return null;
  if (width <= max && height <= max) return null;
  const scale = max / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Cache file name for one size of one item's artwork. The mtime is part of the name so a re-tagged
 * file gets new art automatically; the id is reduced to safe characters so a crafted id can never
 * produce a path outside the cache folder.
 */
export function artCacheName(id: string, mtimeMs: number, size: ArtBucket | 'full'): string {
  const safeId = id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 128) || '_';
  const stamp = Number.isFinite(mtimeMs) ? Math.trunc(mtimeMs) : 0;
  return size === 'full' ? `${safeId}-${stamp}.jpg` : `${safeId}-${stamp}-${size}.jpg`;
}

/**
 * The bucket to ask for, for an image drawn `cssPx` wide on a screen with `dpr` device pixels per
 * CSS pixel — so a 36px row on a 2× laptop asks for 128, not 1024.
 */
export const bucketForDisplay = (cssPx: number, dpr = 2): ArtBucket => artBucket(Math.ceil(cssPx * Math.max(1, dpr)));

/**
 * Ask for artwork at a display size. Only Lumina's own `lumina-media://art/…` URLs are changed —
 * anything else (a remote thumbnail, null) passes through — and an existing size is replaced
 * rather than repeated, so the helper is safe to apply twice.
 */
export function withArtSize(url: string | null | undefined, cssPx: number, dpr = 2): string | null {
  if (!url) return null;
  if (!url.startsWith('lumina-media://art/')) return url;
  // The URL parser, not string surgery: stripping `s=` by regex breaks `?s=2&a=1` into `&a=1`.
  try {
    const u = new URL(url);
    u.searchParams.set('s', String(bucketForDisplay(cssPx, dpr)));
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Images that count as the cover for the folder they sit in — the usual convention for a library
 * of ripped or organised albums, where the art is a file beside the tracks rather than a tag.
 */
export const FOLDER_IMAGE_NAMES = ['cover.jpg', 'folder.jpg', 'front.jpg', 'cover.png', 'folder.png'] as const;

/* ---------- Video thumbnails ---------- */

/**
 * The ffmpeg runs that get a picture out of a video, in the order to try them.
 *
 * Lives in core so the stream specifier is pinned by a test. It was wrong for a long time and
 * nothing noticed: `0:v:m:disposition:attached_pic` looks like it selects the attached cover, but
 * `m:` selects by *metadata tag*, so it read as "metadata key 'disposition' equals 'attached_pic'"
 * and matched no stream. ffmpeg exited with "Stream map '' matches no streams", artwork came back
 * empty, and every video with an embedded thumbnail — which is every video yt-dlp downloads — showed
 * a placeholder gradient in the Library. The disposition specifier is `disp:`.
 *
 * The frame grab is always appended, never replaced: a cover that is missing, mislabelled or corrupt
 * still ends up with a picture rather than nothing.
 */
export function videoThumbnailAttempts(o: {
  input: string;
  output: string;
  durationSec: number | null;
  hasArtwork: boolean;
}): string[][] {
  const attempts: string[][] = [];
  if (o.hasArtwork) {
    attempts.push(['-v', 'error', '-i', o.input, '-map', '0:v:disp:attached_pic', '-frames:v', '1', '-y', o.output]);
  }
  // A tenth of the way in, so a title card or a fade from black is not what represents the video.
  const at = o.durationSec && o.durationSec > 0 ? Math.max(1, o.durationSec * 0.1) : 5;
  attempts.push(['-v', 'error', '-ss', String(at), '-i', o.input, '-frames:v', '1', '-vf', 'scale=640:-2', '-y', o.output]);
  return attempts;
}
