import fs from 'node:fs';
import path from 'node:path';
import { onLines, runTool, spawnTool, killTree } from '../process';
import { tools } from '../tools';
import { settings } from '../settings';
import { assForceStyle } from '../../core/subtitleStyle';
import { logger } from '../log';

const log = logger('ffmpeg');
let hwEncoders: string[] | null = null;

/** H.264 encoders that actually work on this machine, best first. Tested once with a tiny encode. */
async function workingH264Encoders(): Promise<string[]> {
  if (hwEncoders) return hwEncoders;
  const ffmpeg = tools.require('ffmpeg');
  const candidates = process.platform === 'darwin' ? ['h264_videotoolbox'] : ['h264_nvenc', 'h264_qsv', 'h264_amf'];
  const found: string[] = [];
  for (const enc of candidates) {
    const r = await runTool(ffmpeg, ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=320x240:d=0.2', '-c:v', enc, '-f', 'null', '-'], { timeoutMs: 20_000 }).catch(() => null);
    if (r?.code === 0) found.push(enc);
  }
  hwEncoders = [...found, 'libx264'];
  log.info(`H.264 encoders: ${hwEncoders.join(', ')}`);
  return hwEncoders;
}

function encoderArgs(encoder: string): string[] {
  const q = settings.get().formats.encodeQuality;
  switch (encoder) {
    case 'h264_nvenc': return ['-c:v', 'h264_nvenc', '-preset', q === 'fast' ? 'p3' : q === 'quality' ? 'p7' : 'p5', '-cq', q === 'quality' ? '19' : '22', '-b:v', '0', '-profile:v', 'high'];
    case 'h264_qsv': return ['-c:v', 'h264_qsv', '-global_quality', q === 'quality' ? '20' : '23', '-profile:v', 'high'];
    case 'h264_amf': return ['-c:v', 'h264_amf', '-quality', q === 'fast' ? 'speed' : 'quality', '-rc', 'qvbr', '-qvbr_quality_level', '22'];
    case 'h264_videotoolbox': return ['-c:v', 'h264_videotoolbox', '-q:v', q === 'quality' ? '70' : '60', '-profile:v', 'high'];
    default: return ['-c:v', 'libx264', '-preset', q === 'fast' ? 'veryfast' : q === 'quality' ? 'slow' : 'medium', '-crf', q === 'quality' ? '18' : '21', '-profile:v', 'high', '-level', '4.1'];
  }
}

export interface FfmpegRun {
  promise: Promise<void>;
  cancel: () => void;
}

/** Run ffmpeg with progress reporting (0–1) based on the input duration. */
export function runFfmpeg(args: string[], durationSec: number | null, onProgress: (fraction: number) => void): FfmpegRun {
  const child = spawnTool(tools.require('ffmpeg'), ['-hide_banner', '-nostdin', '-y', '-progress', 'pipe:1', '-nostats', ...args]);
  let stderr = '';
  child.stderr?.on('data', (c: Buffer) => {
    stderr = (stderr + c.toString()).slice(-8000);
  });
  onLines(child.stdout, (line) => {
    const m = line.match(/^out_time_us=(\d+)/);
    if (m?.[1] && durationSec) onProgress(Math.min(1, Number(m[1]) / 1e6 / durationSec));
  });
  const promise = new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed (${code}): ${stderr.split('\n').filter(Boolean).slice(-3).join(' ')}`))));
  });
  return { promise, cancel: () => killTree(child) };
}

export interface TranscodeOptions {
  input: string;
  output: string;
  durationSec: number | null;
  maxHeight: number;
  maxFps: number;
  burnSubtitles?: string;
  onProgress: (fraction: number) => void;
  register: (cancel: () => void) => void;
}

/** Convert to TV-safe MP4: H.264 8-bit ≤maxHeight, AAC stereo. Tries GPU encoders first. */
export async function transcodeTvSafe(o: TranscodeOptions): Promise<string> {
  const encoders = settings.get().formats.hardwareEncoding ? await workingH264Encoders() : ['libx264'];
  const filters = [`scale=-2:'min(${o.maxHeight},ih)'`, `fps='min(${o.maxFps},source_fps)'`, 'format=yuv420p'];
  if (o.burnSubtitles) filters.push(`subtitles='${escapeFilterPath(o.burnSubtitles)}':force_style='${assForceStyle(settings.get().subtitles.style)}'`);

  let lastError: unknown;
  for (const encoder of encoders) {
    const args = [
      '-i', o.input, '-map', '0:v:0', '-map', '0:a:0?', '-vf', filters.join(','),
      ...encoderArgs(encoder), '-c:a', 'aac', '-b:a', '192k', '-ac', '2',
      '-map_metadata', '0', '-movflags', '+faststart', o.output,
    ];
    const run = runFfmpeg(args, o.durationSec, o.onProgress);
    o.register(run.cancel);
    try {
      await run.promise;
      return encoder;
    } catch (err) {
      lastError = err;
      log.warn(`Encoder ${encoder} failed, trying next`, err);
      fs.rmSync(o.output, { force: true });
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Conversion failed');
}

/** Add subtitle files as soft tracks without re-encoding. */
export async function embedSubtitles(video: string, subs: string[], register: (c: () => void) => void): Promise<void> {
  const ext = path.extname(video).toLowerCase();
  const tmp = `${video}.subs${ext}`;
  const args = ['-i', video];
  for (const s of subs) args.push('-i', s);
  args.push('-map', '0');
  subs.forEach((_, i) => args.push('-map', `${i + 1}:0`));
  args.push('-c', 'copy', '-c:s', ext === '.mp4' || ext === '.m4v' || ext === '.mov' ? 'mov_text' : ext === '.webm' ? 'webvtt' : 'srt');
  subs.forEach((_, i) => args.push(`-metadata:s:s:${i}`, 'language=eng', `-metadata:s:s:${i}`, 'title=English'));
  args.push(tmp);
  const run = runFfmpeg(args, null, () => undefined);
  register(run.cancel);
  try {
    await run.promise;
    fs.renameSync(tmp, video);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** Extract 16 kHz mono WAV for Whisper. */
export function extractSpeechAudio(input: string, output: string, durationSec: number | null, onProgress: (f: number) => void): FfmpegRun {
  return runFfmpeg(['-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', output], durationSec, onProgress);
}

/** Convert audio to another format, keeping tags and cover art where the container allows. */
export function convertAudio(input: string, output: string, target: 'mp3' | 'm4a' | 'flac' | 'opus' | 'wav', bitrateKbps: number | null, durationSec: number | null, onProgress: (f: number) => void): FfmpegRun {
  const codec: Record<typeof target, string[]> = {
    mp3: ['-c:a', 'libmp3lame', '-b:a', `${bitrateKbps ?? 320}k`, '-id3v2_version', '3'],
    m4a: ['-c:a', 'aac', '-b:a', `${bitrateKbps ?? 256}k`],
    flac: ['-c:a', 'flac'],
    opus: ['-c:a', 'libopus', '-b:a', `${bitrateKbps ?? 192}k`],
    wav: ['-c:a', 'pcm_s16le'],
  };
  const keepArt = target === 'mp3' || target === 'm4a' || target === 'flac';
  const args = ['-i', input, '-map', '0:a:0', ...(keepArt ? ['-map', '0:v?', '-c:v', 'copy', '-disposition:v', 'attached_pic'] : []), ...codec[target], '-map_metadata', '0', output];
  return runFfmpeg(args, durationSec, onProgress);
}

/** ffmpeg filter arguments need ':' and '\' escaped, and single quotes handled. */
function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}
