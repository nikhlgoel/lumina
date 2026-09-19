import { describe, it, expect } from 'vitest';
import {
  canEmbedArtwork, embedArgs, gradientCss, gradientRgb, gradientStops, isVideoContainer,
  oklchToRgb, rasterizeGradient, seedHash, sidecarNames,
} from '@core/coverArt';

describe('seedHash', () => {
  it('is deterministic', () => {
    expect(seedHash('Midnight City')).toBe(seedHash('Midnight City'));
  });

  it('separates different seeds', () => {
    expect(seedHash('a')).not.toBe(seedHash('b'));
  });

  it('handles an empty seed and non-ASCII text', () => {
    expect(Number.isFinite(seedHash(''))).toBe(true);
    expect(Number.isFinite(seedHash('サクラ'))).toBe(true);
    expect(Number.isFinite(seedHash('İstanbul'))).toBe(true);
  });

  it('matches the exact FNV-1a the renderer used, so embedded art keeps matching the app', () => {
    // Computed with the original inline implementation from Artwork.tsx.
    let h = 2166136261;
    for (const ch of 'Blue Monday') h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    expect(seedHash('Blue Monday')).toBe(h);
  });
});

describe('gradientStops', () => {
  it('always produces hues in range and the documented lightness/chroma', () => {
    for (const seed of ['', 'a', 'Some Long Album Name', 'サクラ', '12345']) {
      const [a, b] = gradientStops(seed);
      expect(a.h).toBeGreaterThanOrEqual(0);
      expect(a.h).toBeLessThan(360);
      expect(b.h).toBeGreaterThanOrEqual(0);
      expect(b.h).toBeLessThan(360);
      expect(a.l).toBeCloseTo(0.62, 5);
      expect(b.l).toBeCloseTo(0.38, 5);
    }
  });

  it('gives the second stop a different hue from the first', () => {
    const [a, b] = gradientStops('Everything In Its Right Place');
    expect(a.h).not.toBe(b.h);
  });

  it('is stable for the same seed', () => {
    expect(gradientStops('x')).toEqual(gradientStops('x'));
  });
});

describe('gradientCss', () => {
  it('writes the same 135deg two-stop gradient the player uses', () => {
    const css = gradientCss('Kid A');
    expect(css.startsWith('linear-gradient(135deg, oklch(')).toBe(true);
    expect(css.split('oklch(').length - 1).toBe(2);
  });
});

describe('oklchToRgb', () => {
  it('maps oklch white and black to sRGB white and black', () => {
    expect(oklchToRgb({ l: 1, c: 0, h: 0 })).toEqual({ r: 255, g: 255, b: 255 });
    expect(oklchToRgb({ l: 0, c: 0, h: 0 })).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('keeps a neutral grey neutral', () => {
    const grey = oklchToRgb({ l: 0.5, c: 0, h: 120 });
    expect(grey.r).toBe(grey.g);
    expect(grey.g).toBe(grey.b);
  });

  it('always stays inside 0..255', () => {
    for (let h = 0; h < 360; h += 7) {
      for (const l of [0.1, 0.38, 0.62, 0.9]) {
        const rgb = oklchToRgb({ l, c: 0.12, h });
        for (const v of [rgb.r, rgb.g, rgb.b]) {
          expect(Number.isInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(255);
        }
      }
    }
  });

  it('puts a red-ish hue actually red', () => {
    const red = oklchToRgb({ l: 0.62, c: 0.12, h: 29 });
    expect(red.r).toBeGreaterThan(red.g);
    expect(red.r).toBeGreaterThan(red.b);
  });

  it('makes the darker stop darker than the lighter one', () => {
    const [light, dark] = gradientRgb('Any Seed At All');
    const sum = (c: { r: number; g: number; b: number }) => c.r + c.g + c.b;
    expect(sum(light)).toBeGreaterThan(sum(dark));
  });
});

describe('rasterizeGradient', () => {
  it('produces three bytes per pixel', () => {
    expect(rasterizeGradient('x', 8)).toHaveLength(8 * 8 * 3);
  });

  it('starts at the first stop and ends at the second', () => {
    const size = 16;
    const px = rasterizeGradient('Seed', size);
    const [from, to] = gradientRgb('Seed');
    expect([px[0], px[1], px[2]]).toEqual([from.r, from.g, from.b]);
    const last = (size * size - 1) * 3;
    expect([px[last], px[last + 1], px[last + 2]]).toEqual([to.r, to.g, to.b]);
  });

  it('is symmetric across the anti-diagonal, as a 135deg gradient must be', () => {
    const size = 12;
    const px = rasterizeGradient('Seed', size);
    const at = (x: number, y: number) => px[(y * size + x) * 3];
    expect(at(3, 8)).toBe(at(8, 3));
    expect(at(0, 11)).toBe(at(11, 0));
  });

  it('never emits a byte outside 0..255', () => {
    const px = rasterizeGradient('Another Seed', 24);
    for (const v of px) expect(v).toBeLessThanOrEqual(255);
  });

  it('survives a degenerate size instead of dividing by zero', () => {
    expect(rasterizeGradient('x', 1)).toHaveLength(3);
    expect(rasterizeGradient('x', 0)).toHaveLength(3);
    expect(rasterizeGradient('x', -5)).toHaveLength(3);
  });
});

describe('canEmbedArtwork', () => {
  it('accepts the containers ffmpeg can actually tag', () => {
    for (const f of ['song.mp3', 'a.m4a', 'b.flac', 'c.mp4', 'd.mkv', 'e.mov', 'f.m4v']) {
      expect(canEmbedArtwork(f), f).toBe(true);
    }
  });

  it('refuses ogg and opus rather than silently doing nothing', () => {
    expect(canEmbedArtwork('track.opus')).toBe(false);
    expect(canEmbedArtwork('track.ogg')).toBe(false);
  });

  it('refuses things that are not media', () => {
    expect(canEmbedArtwork('notes.txt')).toBe(false);
    expect(canEmbedArtwork('noextension')).toBe(false);
    expect(canEmbedArtwork('')).toBe(false);
    expect(canEmbedArtwork('.hidden')).toBe(false);
  });

  it('ignores case and directory names', () => {
    expect(canEmbedArtwork('C:/My Music/Song.MP3')).toBe(true);
    expect(canEmbedArtwork('/home/me/a.b.c/track.FLAC')).toBe(true);
  });
});

describe('isVideoContainer', () => {
  it('treats m4a and m4b as audio even though they are MP4', () => {
    expect(isVideoContainer('audiobook.m4b')).toBe(false);
    expect(isVideoContainer('song.m4a')).toBe(false);
  });

  it('treats real video containers as video', () => {
    expect(isVideoContainer('clip.mp4')).toBe(true);
    expect(isVideoContainer('clip.mkv')).toBe(true);
  });
});

describe('embedArgs', () => {
  it('copies streams instead of re-encoding, so the audio is untouched', () => {
    const args = embedArgs('in.mp3', 'cover.png', 'out.mp3');
    expect(args).toContain('-c');
    expect(args[args.indexOf('-c') + 1]).toBe('copy');
    expect(args).not.toContain('-b:a');
  });

  it('marks the picture as attached art', () => {
    expect(embedArgs('in.flac', 'c.png', 'out.flac').join(' ')).toContain('attached_pic');
  });

  it('forces ID3v2.3 for mp3, which is what old players read', () => {
    expect(embedArgs('in.mp3', 'c.png', 'out.mp3')).toContain('-id3v2_version');
    expect(embedArgs('in.flac', 'c.png', 'out.flac')).not.toContain('-id3v2_version');
  });

  it('keeps every stream for video but only audio for music', () => {
    const video = embedArgs('in.mp4', 'c.png', 'out.mp4');
    const audio = embedArgs('in.m4a', 'c.png', 'out.m4a');
    expect(video).toContain('0');
    expect(audio).toContain('0:a');
  });

  it('puts the output last and both inputs before it', () => {
    const args = embedArgs('in.mp3', 'cover.png', 'out.mp3');
    expect(args[args.length - 1]).toBe('out.mp3');
    expect(args.indexOf('in.mp3')).toBeLessThan(args.indexOf('cover.png'));
  });

  it('never invents a shell string — every argument is separate', () => {
    for (const a of embedArgs('my file.mp3', 'my cover.png', 'my out.mp3')) {
      expect(typeof a).toBe('string');
    }
    expect(embedArgs('my file.mp3', 'c.png', 'o.mp3')).toContain('my file.mp3');
  });
});

describe('sidecarNames', () => {
  it('names the image after the file and always offers folder.jpg', () => {
    expect(sidecarNames('C:/Music/Artist/Song.mp3')).toEqual({ beside: 'Song.jpg', folder: 'folder.jpg' });
  });

  it('handles a name with dots in it', () => {
    expect(sidecarNames('a.b.c.mp3').beside).toBe('a.b.c.jpg');
  });

  it('handles a file with no extension', () => {
    expect(sidecarNames('plain').beside).toBe('plain.jpg');
  });
});
