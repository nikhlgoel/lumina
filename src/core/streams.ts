import type { AudioCodec, AudioStream, SubtitleTrack, VideoCodec, VideoStream } from '../shared/types';

/** Subset of yt-dlp's per-format JSON we rely on. */
export interface RawFormat {
  format_id?: string;
  vcodec?: string | null;
  acodec?: string | null;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  dynamic_range?: string | null;
  vbr?: number | null;
  abr?: number | null;
  tbr?: number | null;
  asr?: number | null;
  filesize?: number | null;
  filesize_approx?: number | null;
  ext?: string | null;
  protocol?: string | null;
}

export function normalizeVideoCodec(raw: string | null | undefined): VideoCodec {
  const c = (raw ?? '').toLowerCase();
  if (c.startsWith('av01') || c === 'av1') return 'av1';
  if (c.startsWith('vp09') || c.startsWith('vp9')) return 'vp9';
  if (c.startsWith('hev') || c.startsWith('hvc') || c.startsWith('h265')) return 'hevc';
  if (c.startsWith('avc') || c.startsWith('h264')) return 'h264';
  return 'other';
}

export function normalizeAudioCodec(raw: string | null | undefined): AudioCodec {
  const c = (raw ?? '').toLowerCase();
  if (c.startsWith('opus')) return 'opus';
  if (c.startsWith('mp4a') || c.startsWith('aac')) return 'aac';
  if (c.startsWith('mp3') || c === 'mp4a.40.34') return 'mp3';
  if (c.startsWith('flac')) return 'flac';
  if (c.startsWith('alac')) return 'alac';
  if (c.startsWith('vorbis')) return 'vorbis';
  if (c.startsWith('pcm') || c === 'wav') return 'wav';
  return 'other';
}

const has = (codec: string | null | undefined) => Boolean(codec && codec !== 'none');

/**
 * Turn yt-dlp's format list into de-duplicated video and audio stream options.
 * For each (height, fps, codec, hdr) combination keep the highest-bitrate entry.
 */
export function parseStreams(formats: RawFormat[], durationSec: number | null): { video: VideoStream[]; audio: AudioStream[] } {
  const video = new Map<string, VideoStream>();
  const audio = new Map<string, AudioStream>();

  const size = (f: RawFormat, kbps: number | null) =>
    f.filesize ?? f.filesize_approx ?? (kbps && durationSec ? Math.round((kbps * 1000 * durationSec) / 8) : null);

  for (const f of formats) {
    if (!f.format_id || f.protocol === 'mhtml') continue;

    if (has(f.vcodec) && f.height) {
      const codec = normalizeVideoCodec(f.vcodec);
      const hdr = Boolean(f.dynamic_range && f.dynamic_range.toUpperCase() !== 'SDR');
      const fps = Math.round(f.fps ?? 30);
      const kbps = f.vbr ?? f.tbr ?? null;
      const key = `${f.height}-${fps}-${codec}-${hdr}`;
      const prev = video.get(key);
      if (!prev || (kbps ?? 0) > (prev.bitrateKbps ?? 0)) {
        video.set(key, {
          id: f.format_id, width: f.width ?? 0, height: f.height, fps, codec, codecRaw: f.vcodec ?? '',
          hdr, bitrateKbps: kbps ? Math.round(kbps) : null, sizeBytes: size(f, kbps), ext: f.ext ?? '',
        });
      }
    } else if (has(f.acodec) && !has(f.vcodec)) {
      const codec = normalizeAudioCodec(f.acodec);
      const kbps = f.abr ?? f.tbr ?? null;
      const key = `${codec}-${Math.round(kbps ?? 0)}`;
      if (!audio.has(key)) {
        audio.set(key, {
          id: f.format_id, codec, codecRaw: f.acodec ?? '', bitrateKbps: kbps ? Math.round(kbps) : null,
          sampleRate: f.asr ?? null, sizeBytes: size(f, kbps), ext: f.ext ?? '',
          lossless: codec === 'flac' || codec === 'alac' || codec === 'wav',
        });
      }
    }
  }

  const codecRank: Record<VideoCodec, number> = { av1: 4, vp9: 3, hevc: 2, h264: 1, other: 0 };
  return {
    video: [...video.values()].sort((a, b) =>
      b.height - a.height || b.fps - a.fps || Number(b.hdr) - Number(a.hdr) || codecRank[b.codec] - codecRank[a.codec]),
    audio: [...audio.values()].sort((a, b) =>
      Number(b.lossless) - Number(a.lossless) || (b.bitrateKbps ?? 0) - (a.bitrateKbps ?? 0)),
  };
}

export function parseSubtitles(subs: Record<string, unknown> | undefined, auto: Record<string, unknown> | undefined): SubtitleTrack[] {
  const out: SubtitleTrack[] = [];
  const name = (list: unknown, lang: string) =>
    Array.isArray(list) && typeof list[0]?.name === 'string' ? (list[0].name as string) : lang;
  for (const [lang, list] of Object.entries(subs ?? {})) {
    if (lang === 'live_chat') continue;
    out.push({ lang, name: name(list, lang), auto: false });
  }
  for (const [lang, list] of Object.entries(auto ?? {})) {
    if (out.some((s) => s.lang === lang)) continue;
    out.push({ lang, name: name(list, lang), auto: true });
  }
  return out;
}

export const hasEnglishSubtitles = (tracks: SubtitleTrack[]) => tracks.some((t) => /^en(\b|-|$)/i.test(t.lang));
