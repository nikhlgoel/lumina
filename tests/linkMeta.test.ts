import { describe, it, expect } from 'vitest';
import type { MediaInfo } from '@shared/types';
import { canPlayLink, linkMetaLine } from '@core/linkMeta';

const base: MediaInfo = {
  url: 'https://example.com/v', sourceKind: 'media', site: 'Example', title: 'T', uploader: 'U', thumbnail: null, durationSec: null,
  isLive: false, isMusic: false, videoStreams: [], audioStreams: [], subtitles: [], entries: [],
};
const video = (height: number, ext = 'mp4', sizeBytes: number | null = null) => ({
  id: String(height), width: height * 16 / 9, height, fps: 30, codec: 'h264' as const, codecRaw: 'avc1', hdr: false, bitrateKbps: null, sizeBytes, ext,
});
const audio = (sizeBytes: number | null = null) => ({
  id: 'a', codec: 'aac' as const, codecRaw: 'mp4a', bitrateKbps: 128, sampleRate: 44100, sizeBytes, ext: 'm4a', lossless: false,
});

describe('the line under a link’s title', () => {
  it('reads like the one in the design: site, length, container, best height, size', () => {
    const info = { ...base, durationSec: 10, videoStreams: [video(1080, 'mp4', 900_000), video(720)], audioStreams: [audio(100_000)] };
    expect(linkMetaLine(info)).toBe('Example · 0:10 · MP4 · up to 1080p · about 977 KB');
  });

  it('uses the tallest stream even when the list is not sorted', () => {
    expect(linkMetaLine({ ...base, videoStreams: [video(480), video(2160), video(720)] })).toBe('Example · MP4 · up to 4K');
  });

  it('leaves out whatever the site did not say instead of guessing', () => {
    expect(linkMetaLine(base)).toBe('Example');
    expect(linkMetaLine({ ...base, videoStreams: [video(720)] })).toBe('Example · MP4 · up to 720p');
  });

  it('names the codec for a song, and the type and size for a plain file', () => {
    expect(linkMetaLine({ ...base, durationSec: 215, isMusic: true, audioStreams: [audio()] })).toBe('Example · 3:35 · AAC');
    const file: MediaInfo = { ...base, sourceKind: 'direct', direct: { filename: 'clip.mp4', sizeBytes: 5 * 1024 * 1024, resumable: true } };
    expect(linkMetaLine(file)).toBe('Example · MP4 · 5.0 MB');
  });

  it('counts the chosen items of a playlist and the files of a torrent', () => {
    const entries = [1, 2, 3].map((i) => ({ index: i, id: String(i), title: 't', uploader: '', durationSec: null, url: 'u', thumbnail: null }));
    expect(linkMetaLine({ ...base, sourceKind: 'playlist', entries }, 2)).toBe('Example · 2 of 3 items');
    expect(linkMetaLine({ ...base, sourceKind: 'torrent', torrent: { name: 'n', files: ['a', 'b'], infoHash: null } })).toBe('Example · 2 files');
  });
});

describe('when Play is offered', () => {
  it('is offered for pages, playlists and plain files', () => {
    expect(canPlayLink({ sourceKind: 'media' })).toBe(true);
    expect(canPlayLink({ sourceKind: 'playlist' })).toBe(true);
    expect(canPlayLink({ sourceKind: 'direct', direct: { filename: 'a.mp3', sizeBytes: null, resumable: true } })).toBe(true);
  });

  it('is not offered for a torrent or a file host’s download page, which have nothing to stream yet', () => {
    expect(canPlayLink({ sourceKind: 'torrent' })).toBe(false);
    expect(canPlayLink({ sourceKind: 'direct', direct: { filename: 'a.zip', sizeBytes: null, resumable: false, hosted: true } })).toBe(false);
  });
});
