import { describe, expect, it } from 'vitest';
import type { MediaInfo } from '@shared/types';
import { guessContentType } from '@core/presets';

describe('guessing whether a link is music or video', () => {
  const info = (over: Partial<MediaInfo>) => ({ isMusic: false, videoStreams: [], audioStreams: [], ...over }) as MediaInfo;
  const video = [{ id: '1', width: 1920, height: 1080, fps: 30, codec: 'h264', codecRaw: 'avc1', hdr: false, bitrateKbps: 4000, sizeBytes: null, ext: 'mp4' }] as MediaInfo['videoStreams'];
  const audio = [{ id: 'a', codec: 'aac', codecRaw: 'mp4a', bitrateKbps: 128, sampleRate: 44100, sizeBytes: null, ext: 'm4a', lossless: false }] as MediaInfo['audioStreams'];

  it('is video when a picture is listed', () => {
    expect(guessContentType(info({ videoStreams: video, audioStreams: audio }))).toBe('video');
  });

  it('is music for a music site, or when only audio is listed', () => {
    expect(guessContentType(info({ isMusic: true, videoStreams: video }))).toBe('music');
    expect(guessContentType(info({ audioStreams: audio }))).toBe('music');
  });

  it('is video when the source lists no tracks at all: an HLS playlist with no codec details from a video page is not music', () => {
    // The owner's capture of a 45-minute episode (index-s1080p-v1-a1.m3u8) came out as a FLAC soundtrack.
    expect(guessContentType(info({}))).toBe('video');
  });
});
