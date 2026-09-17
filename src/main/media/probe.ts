import type { CompatReport } from '../../shared/types';
import { runTool } from '../process';
import { tools } from '../tools';

export interface ProbeResult {
  durationSec: number | null;
  formatName: string;
  bitrateKbps: number | null;
  video: { codec: string; profile: string | null; width: number; height: number; fps: number; pixFmt: string | null; hdr: boolean } | null;
  audio: { codec: string; bitrateKbps: number | null; sampleRate: number | null; channels: number | null; bitDepth: number | null } | null;
  hasAttachedPic: boolean;
  subtitleCodecs: string[];
  tags: Record<string, string>;
}

interface RawStream {
  codec_type?: string;
  codec_name?: string;
  profile?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  pix_fmt?: string;
  color_transfer?: string;
  bit_rate?: string;
  sample_rate?: string;
  channels?: number;
  bits_per_raw_sample?: string;
  bits_per_sample?: number;
  disposition?: { attached_pic?: number };
  tags?: Record<string, string>;
}

const fps = (rate?: string) => {
  if (!rate) return 0;
  const [n, d] = rate.split('/').map(Number);
  return n && d ? Math.round((n / d) * 100) / 100 : 0;
};

export async function probe(file: string): Promise<ProbeResult> {
  const r = await runTool(tools.require('ffprobe'), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '--', file], { timeoutMs: 60_000 });
  if (r.code !== 0) throw new Error(`Could not read media file: ${r.stderr.trim().slice(0, 200)}`);
  const data = JSON.parse(r.stdout) as { streams?: RawStream[]; format?: { duration?: string; format_name?: string; bit_rate?: string; tags?: Record<string, string> } };
  const streams = data.streams ?? [];
  const v = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const a = streams.find((s) => s.codec_type === 'audio');
  const lowerTags: Record<string, string> = {};
  for (const [k, val] of Object.entries({ ...data.format?.tags, ...a?.tags })) lowerTags[k.toLowerCase()] = val;

  return {
    durationSec: Number(data.format?.duration) || null,
    formatName: data.format?.format_name ?? '',
    bitrateKbps: Number(data.format?.bit_rate) ? Math.round(Number(data.format?.bit_rate) / 1000) : null,
    video: v ? {
      codec: v.codec_name ?? 'unknown', profile: v.profile ?? null, width: v.width ?? 0, height: v.height ?? 0,
      fps: fps(v.avg_frame_rate) || fps(v.r_frame_rate), pixFmt: v.pix_fmt ?? null,
      hdr: ['smpte2084', 'arib-std-b67'].includes(v.color_transfer ?? ''),
    } : null,
    audio: a ? {
      codec: a.codec_name ?? 'unknown',
      bitrateKbps: Number(a.bit_rate) ? Math.round(Number(a.bit_rate) / 1000) : null,
      sampleRate: Number(a.sample_rate) || null,
      channels: a.channels ?? null,
      bitDepth: Number(a.bits_per_raw_sample) || a.bits_per_sample || null,
    } : null,
    hasAttachedPic: streams.some((s) => s.disposition?.attached_pic === 1),
    subtitleCodecs: streams.filter((s) => s.codec_type === 'subtitle').map((s) => s.codec_name ?? ''),
    tags: lowerTags,
  };
}

/** Whether a file plays on typical TVs and older devices: H.264 8-bit ≤1080p in MP4 with AAC/MP3 audio. */
export function compatibility(p: ProbeResult, maxHeight = 1080): CompatReport {
  if (!p.video && p.audio) {
    const kbps = p.audio.bitrateKbps ?? p.bitrateKbps;
    const lossless = ['flac', 'alac', 'pcm_s16le', 'pcm_s24le'].includes(p.audio.codec);
    return {
      tvSafe: ['aac', 'mp3'].includes(p.audio.codec),
      summary: `${p.audio.codec.toUpperCase()}${lossless ? ' · lossless' : kbps ? ` · ${kbps} kbps` : ''}${p.audio.sampleRate ? ` · ${(p.audio.sampleRate / 1000).toFixed(1)} kHz` : ''}`,
      audio: { codec: p.audio.codec, bitrateKbps: kbps, sampleRate: p.audio.sampleRate },
    };
  }
  const problems: string[] = [];
  if (p.video) {
    if (p.video.codec !== 'h264') problems.push(`${p.video.codec.toUpperCase()} video`);
    if (p.video.height > maxHeight) problems.push(`${p.video.height}p`);
    if (p.video.fps > 60) problems.push(`${Math.round(p.video.fps)} fps`);
    if (p.video.hdr || (p.video.pixFmt ?? '').includes('10')) problems.push('10-bit/HDR');
  }
  if (p.audio && !['aac', 'mp3', 'ac3', 'eac3'].includes(p.audio.codec)) problems.push(`${p.audio.codec.toUpperCase()} audio`);
  if (p.video && !p.formatName.includes('mp4')) problems.push('not MP4');

  const summary = p.video
    ? `${p.video.codec.toUpperCase()} ${p.video.height}p${Math.round(p.video.fps)}${p.audio ? ` · ${p.audio.codec.toUpperCase()}` : ''}`
    : p.audio ? `${p.audio.codec.toUpperCase()}${p.audio.bitrateKbps ? ` ${p.audio.bitrateKbps} kbps` : ''}` : 'Unknown';

  return {
    tvSafe: problems.length === 0,
    summary: problems.length ? `${summary} — needs conversion for TVs (${problems.join(', ')})` : summary,
    video: p.video ? { codec: p.video.codec, width: p.video.width, height: p.video.height, fps: p.video.fps } : undefined,
    audio: p.audio ? { codec: p.audio.codec, bitrateKbps: p.audio.bitrateKbps, sampleRate: p.audio.sampleRate } : undefined,
  };
}
