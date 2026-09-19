import { describe, it, expect } from 'vitest';
import {
  CONVERT_COST, TV_PROFILE, describeMedia, isHighBitDepth, isTvSafe, tvSafeName, tvSafeReasons,
  tvSummary, weightedBytes, type MediaFacts,
} from '@core/tvSafe';

const video = (over: Partial<NonNullable<MediaFacts['video']>> = {}, container = 'mov,mp4,m4a'): MediaFacts => ({
  container,
  video: { codec: 'h264', width: 1920, height: 1080, fps: 30, pixFmt: 'yuv420p', hdr: false, ...over },
  audio: { codec: 'aac', channels: 2, bitrateKbps: 192, sampleRate: 48000 },
});

const audio = (over: Partial<NonNullable<MediaFacts['audio']>> = {}, container = 'mp3'): MediaFacts => ({
  container,
  video: null,
  audio: { codec: 'mp3', channels: 2, bitrateKbps: 320, sampleRate: 44100, ...over },
});

describe('isHighBitDepth', () => {
  it('spots the common 10-bit formats', () => {
    for (const fmt of ['yuv420p10le', 'yuv422p10le', 'yuv444p12le', 'p010le']) {
      expect(isHighBitDepth(fmt), fmt).toBe(true);
    }
  });

  it('leaves ordinary 8-bit alone', () => {
    for (const fmt of ['yuv420p', 'yuvj420p', 'nv12', 'rgb24']) {
      expect(isHighBitDepth(fmt), fmt).toBe(false);
    }
  });

  it('handles a missing pixel format', () => {
    expect(isHighBitDepth(null)).toBe(false);
    expect(isHighBitDepth('')).toBe(false);
  });
});

describe('tvSafeReasons', () => {
  it('passes the safe baseline: H.264 1080p30 AAC in MP4', () => {
    expect(tvSafeReasons(video())).toEqual([]);
    expect(isTvSafe(video())).toBe(true);
  });

  it('flags a codec a TV cannot decode', () => {
    expect(tvSafeReasons(video({ codec: 'hevc' }))).toContain('HEVC video');
    expect(tvSafeReasons(video({ codec: 'vp9' }))).toContain('VP9 video');
    expect(tvSafeReasons(video({ codec: 'av1' }))).toContain('AV1 video');
  });

  it('flags resolutions above the profile', () => {
    expect(tvSafeReasons(video({ height: 2160 }))).toContain('2160p');
    expect(tvSafeReasons(video({ height: 1080 }))).not.toContain('1080p');
  });

  it('flags a high frame rate but tolerates 60 and floating-point noise', () => {
    expect(tvSafeReasons(video({ fps: 120 }))).toContain('120 fps');
    expect(tvSafeReasons(video({ fps: 60 }))).toEqual([]);
    expect(tvSafeReasons(video({ fps: 59.94 }))).toEqual([]);
  });

  it('does not invent a frame-rate problem when the probe reports zero', () => {
    expect(tvSafeReasons(video({ fps: 0 }))).toEqual([]);
  });

  it('flags HDR and 10-bit, but reports only one of them', () => {
    const hdr = tvSafeReasons(video({ hdr: true, pixFmt: 'yuv420p10le' }));
    expect(hdr).toContain('HDR');
    expect(hdr).not.toContain('10-bit');
    expect(tvSafeReasons(video({ pixFmt: 'yuv420p10le' }))).toContain('10-bit');
  });

  it('flags a container a TV will not open', () => {
    expect(tvSafeReasons(video({}, 'matroska,webm'))).toContain('not MP4');
    expect(tvSafeReasons(video({}, 'avi'))).toContain('not MP4');
    expect(tvSafeReasons(video({}, 'mov,mp4,m4a,3gp'))).not.toContain('not MP4');
  });

  it('flags audio codecs outside the safe set but accepts AC-3, which TVs do decode', () => {
    expect(tvSafeReasons({ ...video(), audio: { codec: 'dts', channels: 6, bitrateKbps: null, sampleRate: 48000 } }))
      .toContain('DTS audio');
    expect(tvSafeReasons({ ...video(), audio: { codec: 'ac3', channels: 6, bitrateKbps: 448, sampleRate: 48000 } }))
      .toEqual([]);
  });

  it('judges a bare audio file on its codec, not its container', () => {
    expect(tvSafeReasons(audio())).toEqual([]);
    expect(tvSafeReasons(audio({ codec: 'flac' }, 'flac'))).toEqual(['FLAC audio']);
    expect(tvSafeReasons(audio({ codec: 'opus' }, 'ogg'))).toEqual(['OPUS audio']);
  });

  it('collects every problem at once rather than stopping at the first', () => {
    const reasons = tvSafeReasons({
      container: 'matroska,webm',
      video: { codec: 'hevc', width: 3840, height: 2160, fps: 60, pixFmt: 'yuv420p10le', hdr: false },
      audio: { codec: 'dts', channels: 8, bitrateKbps: null, sampleRate: 48000 },
    });
    expect(reasons).toEqual(expect.arrayContaining(['HEVC video', '2160p', '10-bit', 'not MP4', 'DTS audio']));
  });

  it('is case-insensitive about codec names', () => {
    expect(tvSafeReasons(video({ codec: 'H264' }))).toEqual([]);
  });

  it('handles a file with neither stream without throwing', () => {
    expect(tvSafeReasons({ container: 'mp4', video: null, audio: null })).toEqual([]);
  });

  it('respects a custom profile', () => {
    const strict = { ...TV_PROFILE, maxHeight: 720 };
    expect(tvSafeReasons(video({ height: 1080 }), strict)).toContain('1080p');
  });
});

describe('describeMedia', () => {
  it('describes video compactly', () => {
    expect(describeMedia(video())).toBe('H264 1080p30 · AAC');
  });

  it('omits an unknown frame rate', () => {
    expect(describeMedia(video({ fps: 0 }))).toBe('H264 1080p · AAC');
  });

  it('calls lossless audio lossless instead of quoting a bitrate', () => {
    expect(describeMedia(audio({ codec: 'flac' }, 'flac'))).toContain('lossless');
    expect(describeMedia(audio())).toContain('320 kbps');
  });

  it('says Unknown rather than producing an empty string', () => {
    expect(describeMedia({ container: 'mp4', video: null, audio: null })).toBe('Unknown');
  });
});

describe('tvSummary', () => {
  it('is just the description when the file is fine', () => {
    expect(tvSummary(video())).toBe('H264 1080p30 · AAC');
  });

  it('names the problems when it is not', () => {
    const summary = tvSummary(video({ codec: 'hevc' }));
    expect(summary).toContain('needs conversion for TVs');
    expect(summary).toContain('HEVC video');
  });
});

describe('tvSafeName', () => {
  it('swaps the extension for .mp4 and keeps the name', () => {
    expect(tvSafeName('C:/Videos/Some Film.mkv')).toBe('Some Film.mp4');
    expect(tvSafeName('/home/me/clip.webm')).toBe('clip.mp4');
  });

  it('keeps dots inside the name', () => {
    expect(tvSafeName('S01.E02.Title.mkv')).toBe('S01.E02.Title.mp4');
  });

  it('handles a file with no extension', () => {
    expect(tvSafeName('movie')).toBe('movie.mp4');
  });
});

describe('weightedBytes', () => {
  it('counts a copy as its own size', () => {
    expect(weightedBytes(1000, false)).toBe(1000);
  });

  it('weights a conversion so the progress bar does not look stuck', () => {
    expect(weightedBytes(1000, true)).toBe(1000 * CONVERT_COST);
    expect(CONVERT_COST).toBeGreaterThan(1);
  });
});
