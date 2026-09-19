// The cover art Lumina shows when a file has none of its own — as real pixels, not just CSS.
//
// The player draws a two-tone gradient derived from the track's name. That looks fine inside the
// app, but it exists only as a CSS `linear-gradient`, so a TV reading the file off a USB stick sees
// nothing at all. To put that same art *into* the file we have to reproduce it exactly, which means
// doing in TypeScript what the browser was doing for us: converting oklch to sRGB and rasterising
// the gradient.
//
// `Artwork.tsx` imports the hash and the stops from here, so what is embedded is by construction
// the same image the user was looking at.

/** Two colours in oklch, the form the CSS gradient is written in. */
export interface Oklch {
  l: number;
  c: number;
  h: number;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * FNV-1a over the seed. Must stay bit-for-bit identical to what the renderer used, or embedded art
 * would no longer match what people see.
 */
export function seedHash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return h;
}

/** The two gradient stops for a seed, in oklch. */
export function gradientStops(seed: string): [Oklch, Oklch] {
  const h = seedHash(seed);
  const hue = Math.abs(h) % 360;
  const hue2 = (hue + 40 + (Math.abs(h >> 8) % 60)) % 360;
  return [{ l: 0.62, c: 0.12, h: hue }, { l: 0.38, c: 0.09, h: hue2 }];
}

/** The CSS the renderer applies. Kept here so the app and the embedded image cannot drift apart. */
export function gradientCss(seed: string): string {
  const [a, b] = gradientStops(seed);
  return `linear-gradient(135deg, oklch(${a.l * 100}% ${a.c} ${a.h}), oklch(${b.l * 100}% ${b.c} ${b.h}))`;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Linear-light channel to sRGB, the standard transfer function. */
function encodeChannel(v: number): number {
  const c = clamp01(v);
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(clamp01(s) * 255);
}

/**
 * oklch → sRGB.
 *
 * oklch is polar oklab, so: polar to cartesian, oklab's cube-root space back to LMS, then the
 * standard LMS→linear-sRGB matrix and the sRGB transfer curve. Out-of-gamut colours are clamped per
 * channel, which is what browsers do for these gentle values anyway.
 */
export function oklchToRgb({ l, c, h }: Oklch): Rgb {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const bb = c * Math.sin(hr);

  const lp = l + 0.3963377774 * a + 0.2158037573 * bb;
  const mp = l - 0.1055613458 * a - 0.0638541728 * bb;
  const sp = l - 0.0894841775 * a - 1.2914855480 * bb;

  const L = lp * lp * lp;
  const M = mp * mp * mp;
  const S = sp * sp * sp;

  return {
    r: encodeChannel(+4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S),
    g: encodeChannel(-1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S),
    b: encodeChannel(-0.0041960863 * L - 0.7034186147 * M + 1.7076147010 * S),
  };
}

/** The two stops as sRGB, which is what actually gets painted. */
export function gradientRgb(seed: string): [Rgb, Rgb] {
  const [a, b] = gradientStops(seed);
  return [oklchToRgb(a), oklchToRgb(b)];
}

/**
 * Rasterise the 135° gradient into raw RGB bytes, row by row, top-left to bottom-right.
 *
 * CSS's 135deg runs from the top-left corner towards the bottom-right, so the position along the
 * gradient is simply how far a pixel is along the (x + y) diagonal.
 */
export function rasterizeGradient(seed: string, size: number): Uint8Array {
  const side = Math.max(1, Math.floor(size));
  const [from, to] = gradientRgb(seed);
  const out = new Uint8Array(side * side * 3);
  const span = (side - 1) * 2 || 1;

  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const t = (x + y) / span;
      const i = (y * side + x) * 3;
      out[i] = Math.round(from.r + (to.r - from.r) * t);
      out[i + 1] = Math.round(from.g + (to.g - from.g) * t);
      out[i + 2] = Math.round(from.b + (to.b - from.b) * t);
    }
  }
  return out;
}

/* ---------- which files can carry art ---------- */

const extensionOf = (file: string): string => {
  const base = file.split(/[\\/]/).pop() ?? file;
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
};

/**
 * Containers ffmpeg can reliably write a cover picture into.
 *
 * Ogg/Opus is deliberately absent: its cover art is a base64 METADATA_BLOCK_PICTURE comment that
 * ffmpeg does not write, so claiming support would produce files with no art and no error.
 */
const EMBEDDABLE_AUDIO = new Set(['.mp3', '.m4a', '.m4b', '.aac', '.flac', '.mp4']);

/** Video containers where a cover survives as an attached picture. */
const EMBEDDABLE_VIDEO = new Set(['.mp4', '.m4v', '.mkv', '.mov']);

/** .m4a and .m4b are MP4 containers but carry audio; tag them the audio way. */
const isAudioOnlyMp4 = (file: string): boolean => {
  const ext = extensionOf(file);
  return ext === '.m4a' || ext === '.m4b';
};

export function canEmbedArtwork(file: string): boolean {
  const ext = extensionOf(file);
  return EMBEDDABLE_AUDIO.has(ext) || EMBEDDABLE_VIDEO.has(ext);
}

export function isVideoContainer(file: string): boolean {
  return EMBEDDABLE_VIDEO.has(extensionOf(file)) && !isAudioOnlyMp4(file);
}

/**
 * The ffmpeg arguments that write `cover` into `source`, producing `dest`.
 *
 * Streams are copied, never re-encoded — this must not touch the audio. The cover is marked as an
 * attached picture so players show it as album art rather than treating it as a video track.
 */
export function embedArgs(source: string, cover: string, dest: string): string[] {
  const video = isVideoContainer(source);
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', source,
    '-i', cover,
  ];

  if (video) {
    // Keep every existing stream and append the picture.
    args.push('-map', '0', '-map', '1', '-c', 'copy', '-disposition:v:1', 'attached_pic');
  } else {
    args.push('-map', '0:a', '-map', '1', '-c', 'copy', '-disposition:v:0', 'attached_pic');
    if (extensionOf(source) === '.mp3') args.push('-id3v2_version', '3');
  }

  args.push('-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)', dest);
  return args;
}

/**
 * Sidecar image names a TV or dumb media player is likely to pick up.
 *
 * Many devices never read embedded tags but do show a picture sitting next to the file, or a
 * `folder.jpg` in the same directory — so Lumina writes both and lets the device choose.
 */
export function sidecarNames(file: string): { beside: string; folder: string } {
  const base = (file.split(/[\\/]/).pop() ?? file).replace(/\.[^.]+$/, '');
  return { beside: `${base}.jpg`, folder: 'folder.jpg' };
}
