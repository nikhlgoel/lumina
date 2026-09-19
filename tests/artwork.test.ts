import { describe, it, expect } from 'vitest';
import { ART_BUCKETS, ART_MAX, artBucket, artCacheName, bucketForDisplay, fitWithin, videoThumbnailAttempts, withArtSize } from '@core/artwork';

/** Small deterministic PRNG (mulberry32) so property tests are reproducible run to run. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('artBucket', () => {
  it('rounds up to the next bucket so images are never upscaled into blur', () => {
    expect(artBucket(1)).toBe(128);
    expect(artBucket(128)).toBe(128);
    expect(artBucket(129)).toBe(256);
    expect(artBucket(300)).toBe(512);
    expect(artBucket(1024)).toBe(1024);
  });

  it('caps anything larger at the maximum', () => {
    expect(artBucket(5000)).toBe(ART_MAX);
    expect(artBucket(Number.MAX_SAFE_INTEGER)).toBe(ART_MAX);
  });

  it('treats a missing, empty or invalid request as the maximum, never as zero', () => {
    for (const bad of [null, undefined, '', '   ', 'abc', 'NaN', '-5', 0, -1, Number.NaN, Number.POSITIVE_INFINITY, {}, [], true]) {
      expect(artBucket(bad), String(bad)).toBe(ART_MAX);
    }
  });

  it('reads the query-string form', () => {
    expect(artBucket('64')).toBe(128);
    expect(artBucket('256')).toBe(256);
    expect(artBucket(' 200 ')).toBe(256);
  });

  it('property: always returns a real bucket that is >= the request (or the max)', () => {
    const r = rng(1);
    for (let i = 0; i < 5000; i++) {
      const n = r() * 4000 - 200;
      const b = artBucket(n);
      expect(ART_BUCKETS).toContain(b);
      if (n > 0 && n <= ART_MAX) expect(b).toBeGreaterThanOrEqual(n);
    }
  });
});

describe('fitWithin', () => {
  it('leaves an image that already fits alone', () => {
    expect(fitWithin(100, 100, 128)).toBeNull();
    expect(fitWithin(128, 64, 128)).toBeNull();
  });

  it('shrinks a large square cover to exactly the bucket', () => {
    expect(fitWithin(3000, 3000, 256)).toEqual({ width: 256, height: 256 });
  });

  it('keeps the aspect ratio of wide and tall images', () => {
    expect(fitWithin(1920, 1080, 512)).toEqual({ width: 512, height: 288 });
    expect(fitWithin(1080, 1920, 512)).toEqual({ width: 288, height: 512 });
  });

  it('never produces a zero dimension for an extreme strip', () => {
    expect(fitWithin(10_000, 1, 128)).toEqual({ width: 128, height: 1 });
  });

  it('refuses nonsense input rather than producing nonsense output', () => {
    for (const [w, h, m] of [[0, 10, 10], [10, 0, 10], [10, 10, 0], [-1, 10, 10], [Number.NaN, 10, 10], [10, 10, Number.NaN]]) {
      expect(fitWithin(w!, h!, m!)).toBeNull();
    }
  });

  it('property: the result always fits, and keeps the shape within one pixel of rounding', () => {
    const r = rng(2);
    for (let i = 0; i < 10_000; i++) {
      const w = 1 + Math.floor(r() * 6000);
      const h = 1 + Math.floor(r() * 6000);
      const max = ART_BUCKETS[Math.floor(r() * ART_BUCKETS.length)]!;
      const fit = fitWithin(w, h, max);
      if (w <= max && h <= max) {
        expect(fit).toBeNull();
        continue;
      }
      expect(fit).not.toBeNull();
      expect(fit!.width).toBeLessThanOrEqual(max);
      expect(fit!.height).toBeLessThanOrEqual(max);
      expect(Math.max(fit!.width, fit!.height)).toBe(max);
      // The long side is exact, so the short side is off by at most one pixel from the true ratio.
      const ideal = w >= h ? (h * max) / w : (w * max) / h;
      const short = w >= h ? fit!.height : fit!.width;
      expect(Math.abs(short - Math.max(1, ideal))).toBeLessThanOrEqual(1);
    }
  });
});

describe('artCacheName', () => {
  it('names each size separately, and the original on its own', () => {
    expect(artCacheName('abc', 1700000000123.7, 256)).toBe('abc-1700000000123-256.jpg');
    expect(artCacheName('abc', 1700000000123.7, 'full')).toBe('abc-1700000000123.jpg');
  });

  it('changes when the file changes, so re-tagged art is picked up', () => {
    expect(artCacheName('abc', 1, 128)).not.toBe(artCacheName('abc', 2, 128));
  });

  it('cannot be steered outside the cache folder by a crafted id', () => {
    for (const id of ['../../etc/passwd', '..\\..\\windows\\system32', 'a/b', 'C:\\x', '/abs', '\0nul', '']) {
      const name = artCacheName(id, 1, 128);
      expect(name).not.toMatch(/[/\\\0:]/);
      expect(name).not.toContain('..');
    }
  });

  it('survives a non-finite mtime', () => {
    expect(artCacheName('a', Number.NaN, 128)).toBe('a-0-128.jpg');
  });

  it('property: random ids never produce a separator, a parent reference or an overlong name', () => {
    const r = rng(3);
    const alphabet = 'abcXYZ019-_./\\:*?"<>|\0 ~%$é漢🙂';
    for (let i = 0; i < 5000; i++) {
      const len = Math.floor(r() * 300);
      let id = '';
      for (let j = 0; j < len; j++) id += alphabet[Math.floor(r() * alphabet.length)];
      const name = artCacheName(id, r() * 1e13, 512);
      expect(name).not.toMatch(/[/\\\0:*?"<>|]/);
      expect(name).not.toContain('..');
      expect(name.length).toBeLessThan(200);
    }
  });
});

describe('bucketForDisplay', () => {
  it('asks for enough pixels for a HiDPI screen and no more', () => {
    expect(bucketForDisplay(36)).toBe(128);
    expect(bucketForDisplay(96)).toBe(256);
    expect(bucketForDisplay(256)).toBe(512);
    expect(bucketForDisplay(36, 1)).toBe(128);
    expect(bucketForDisplay(200, 3)).toBe(1024);
  });

  it('never treats a sub-1 device ratio as shrinking the request', () => {
    expect(bucketForDisplay(200, 0.5)).toBe(256);
  });
});

describe('withArtSize', () => {
  it('adds a size to a Lumina artwork URL', () => {
    expect(withArtSize('lumina-media://art/abc', 36)).toBe('lumina-media://art/abc?s=128');
  });

  it('replaces an existing size instead of repeating it — safe to apply twice', () => {
    const once = withArtSize('lumina-media://art/abc', 36)!;
    expect(withArtSize(once, 36)).toBe(once);
    expect(withArtSize('lumina-media://art/abc?s=1024', 36)).toBe('lumina-media://art/abc?s=128');
  });

  it('keeps other query parameters intact, wherever the size sits', () => {
    expect(withArtSize('lumina-media://art/abc?s=2&v=1', 36)).toBe('lumina-media://art/abc?s=128&v=1');
    expect(withArtSize('lumina-media://art/abc?v=1&s=2', 36)).toBe('lumina-media://art/abc?v=1&s=128');
  });

  it('leaves anything that is not Lumina artwork alone', () => {
    expect(withArtSize('https://i.ytimg.com/vi/x/hq.jpg', 36)).toBe('https://i.ytimg.com/vi/x/hq.jpg');
    expect(withArtSize('lumina-media://media/abc', 36)).toBe('lumina-media://media/abc');
    expect(withArtSize(null, 36)).toBeNull();
    expect(withArtSize(undefined, 36)).toBeNull();
    expect(withArtSize('', 36)).toBeNull();
  });
});

describe('videoThumbnailAttempts — the Library showed gradients instead of thumbnails', () => {
  const base = { input: 'C:/Videos/Welcome to C++.mp4', output: 'C:/cache/abc.jpg', durationSec: 424, hasArtwork: true };

  it('selects the attached cover by DISPOSITION, not by metadata tag', () => {
    const [cover] = videoThumbnailAttempts(base);
    const map = cover![cover!.indexOf('-map') + 1];
    expect(map).toBe('0:v:disp:attached_pic');
  });

  it('never uses the metadata form again — it matches no stream and ffmpeg exits non-zero', () => {
    // `m:` selects by metadata tag, so `m:disposition:attached_pic` asks for a tag called
    // "disposition". Every video with an embedded thumbnail silently lost its artwork to this.
    for (const args of videoThumbnailAttempts(base)) {
      expect(args.join(' ')).not.toContain('m:disposition');
    }
  });

  it('always offers a frame grab as well, so a bad cover still yields a picture', () => {
    const attempts = videoThumbnailAttempts(base);
    expect(attempts).toHaveLength(2);
    expect(attempts[1]!.join(' ')).toContain('-ss');
  });

  it('skips the cover attempt entirely when there is no embedded artwork', () => {
    const attempts = videoThumbnailAttempts({ ...base, hasArtwork: false });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.join(' ')).not.toContain('attached_pic');
  });

  it('grabs a tenth of the way in, away from title cards and fades from black', () => {
    const [frame] = videoThumbnailAttempts({ ...base, hasArtwork: false });
    expect(Number(frame![frame!.indexOf('-ss') + 1])).toBeCloseTo(42.4, 6);
  });

  it('never seeks to zero, whatever the duration claims', () => {
    for (const durationSec of [null, 0, -1, 1, Number.NaN]) {
      const [frame] = videoThumbnailAttempts({ ...base, hasArtwork: false, durationSec });
      const at = Number(frame![frame!.indexOf('-ss') + 1]);
      expect(at, String(durationSec)).toBeGreaterThanOrEqual(1);
    }
  });

  it('passes the paths through untouched, spaces and all', () => {
    for (const args of videoThumbnailAttempts(base)) {
      expect(args).toContain(base.input);
      expect(args[args.length - 1]).toBe(base.output);
    }
  });
});
