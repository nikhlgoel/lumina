import type { AudioFormatChoice, ContentType, FormatChoice, MediaInfo, Preset, VideoFormatChoice } from '../shared/types';

const video = (p: Partial<VideoFormatChoice>): VideoFormatChoice => ({
  kind: 'video', maxHeight: null, codec: 'any', container: 'mkv', maxFps: null, allowHdr: true, tvSafe: false, ...p,
});
const audio = (p: Partial<AudioFormatChoice>): AudioFormatChoice => ({ kind: 'audio', target: 'original', bitrateKbps: null, ...p });

export const BUILT_IN_PRESETS: Preset[] = [
  { id: 'video-source-max', name: 'Source max', description: 'Best available, up to 8K and HDR. No re-encoding.', appliesTo: ['video', 'series'], format: video({}), builtIn: true },
  { id: 'video-4320', name: '8K', description: 'Up to 4320p, original codec', appliesTo: ['video', 'series'], format: video({ maxHeight: 4320 }), builtIn: true },
  { id: 'video-2160', name: '4K', description: 'Up to 2160p, original codec', appliesTo: ['video', 'series'], format: video({ maxHeight: 2160 }), builtIn: true },
  { id: 'video-1440', name: '1440p', description: 'Up to 1440p, original codec', appliesTo: ['video', 'series'], format: video({ maxHeight: 1440 }), builtIn: true },
  { id: 'video-1080', name: '1080p', description: 'Up to 1080p, original codec', appliesTo: ['video', 'series'], format: video({ maxHeight: 1080 }), builtIn: true },
  { id: 'video-720', name: '720p', description: 'Up to 720p, smaller files', appliesTo: ['video', 'series'], format: video({ maxHeight: 720 }), builtIn: true },
  { id: 'video-tv-1080', name: 'TV-safe 1080p', description: 'MP4 · H.264 · AAC. Plays on older TVs and devices.', appliesTo: ['video', 'series'], format: video({ maxHeight: 1080, codec: 'h264', container: 'mp4', maxFps: 60, allowHdr: false, tvSafe: true }), builtIn: true },
  { id: 'video-tv-720', name: 'TV-safe 720p', description: 'MP4 · H.264 · AAC at 720p for HD-ready screens', appliesTo: ['video', 'series'], format: video({ maxHeight: 720, codec: 'h264', container: 'mp4', maxFps: 30, allowHdr: false, tvSafe: true }), builtIn: true },
  { id: 'audio-original', name: 'Original audio', description: 'Best stream as served by the source. No re-encoding.', appliesTo: ['music'], format: audio({}), builtIn: true },
  { id: 'audio-flac', name: 'FLAC', description: 'Lossless container. Only adds quality if the source is lossless.', appliesTo: ['music'], format: audio({ target: 'flac' }), builtIn: true },
  { id: 'audio-m4a', name: 'M4A (AAC)', description: 'Plays everywhere, including Apple devices', appliesTo: ['music'], format: audio({ target: 'm4a', bitrateKbps: 256 }), builtIn: true },
  { id: 'audio-mp3', name: 'MP3', description: 'Maximum compatibility with old players and cars', appliesTo: ['music'], format: audio({ target: 'mp3', bitrateKbps: 320 }), builtIn: true },
];

export const presetById = (id: string) => BUILT_IN_PRESETS.find((p) => p.id === id);

/** Apply the user's format preferences (container, MP3 bitrate) to a preset's format. TV-safe presets stay MP4. */
export function applyFormatPreferences(format: FormatChoice, prefs: { videoContainer: 'mkv' | 'mp4'; mp3Bitrate: string }): FormatChoice {
  if (format.kind === 'video') return format.tvSafe || format.container === 'webm' ? format : { ...format, container: prefs.videoContainer };
  if (format.target === 'mp3') return { ...format, bitrateKbps: Number(prefs.mp3Bitrate) };
  return format;
}

export function defaultPresetFor(content: ContentType, configured: Record<ContentType, string>): Preset {
  return presetById(configured[content]) ?? presetById(content === 'music' ? 'audio-original' : 'video-source-max')!;
}

/** Decide music/video/series from the inspected source. */
export function guessContentType(info: MediaInfo): ContentType {
  if (info.isMusic || info.videoStreams.length === 0) return 'music';
  return 'video';
}

/** Highest height the source offers, used to disable tiers it cannot reach. */
export const sourceMaxHeight = (info: MediaInfo) => info.videoStreams.reduce((m, s) => Math.max(m, s.height), 0);

/**
 * Honest note about what a format choice does with this source.
 * Returns null when there is nothing worth warning about.
 */
export function qualityNote(format: FormatChoice, info: MediaInfo): string | null {
  if (format.kind === 'audio') {
    const best = info.audioStreams[0];
    if (!best) return null;
    const srcLossless = best.lossless;
    const kbps = best.bitrateKbps ? `${best.bitrateKbps} kbps` : 'lossy';
    if (format.target === 'flac' || format.target === 'wav') {
      return srcLossless ? null : `Source is ${best.codec.toUpperCase()} ${kbps}. Converting to ${format.target.toUpperCase()} makes the file larger but cannot add quality.`;
    }
    if (format.target === 'mp3' || format.target === 'm4a') {
      return `Source is ${best.codec.toUpperCase()} ${kbps}. This converts it for compatibility; "Original audio" keeps the best quality.`;
    }
    return null;
  }
  const max = sourceMaxHeight(info);
  if (format.maxHeight && max && format.maxHeight > max) {
    return `This source goes up to ${max}p, so you'll get ${max}p.`;
  }
  if (format.tvSafe) {
    const h264 = info.videoStreams.some((s) => s.codec === 'h264' && s.height <= (format.maxHeight ?? 1080));
    return h264 ? null : 'No H.264 stream at this size, so Lumina will re-encode after downloading (slower).';
  }
  return null;
}
