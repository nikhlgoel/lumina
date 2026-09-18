import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AiModelStatus, SubtitleOutput } from '../shared/types';
import { killTree, onLines, spawnTool } from './process';
import { tools } from './tools';
import { settings } from './settings';
import { downloadedModelsDir } from './paths';
import { embedSubtitles, extractSpeechAudio } from './media/ffmpeg';
import { logger } from './log';

const log = logger('subtitles');

export interface Cancellable {
  register: (cancel: () => void) => void;
}

/** Find an English .srt next to a media file (what yt-dlp writes: "name.en.srt", "name.en-US.srt"). */
export function findEnglishSidecar(mediaPath: string): string | null {
  const dir = path.dirname(mediaPath);
  const stem = path.basename(mediaPath, path.extname(mediaPath));
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const candidates = files.filter((f) => f.startsWith(`${stem}.`) && /\.(en|eng|english)([.-][\w-]+)?\.srt$/i.test(f));
  // Prefer an official track (en) over auto/original (en-orig) and regional variants.
  const rank = (f: string) => (/\.en\.srt$/i.test(f) ? 0 : /\.en-(us|gb)\.srt$/i.test(f) ? 1 : /orig/i.test(f) ? 3 : 2);
  candidates.sort((a, b) => rank(a) - rank(b));
  const best = candidates[0];
  if (!best) return null;

  // Normalize to "name.en.srt" and drop the extra variants so the folder stays tidy.
  const target = path.join(dir, `${stem}.en.srt`);
  if (path.join(dir, best) !== target) fs.renameSync(path.join(dir, best), target);
  for (const other of candidates.slice(1)) fs.rmSync(path.join(dir, other), { force: true });
  return target;
}

export const whisperModelSizes = { base: 147_951_465, small: 487_601_967 } as const;
/**
 * Working memory whisper.cpp needs while transcribing, measured from the model's own requirements.
 * Only ever used while a subtitle job runs — nothing is resident when Lumina is idle.
 */
export const whisperRamHints = { base: 500 << 20, small: 1024 << 20 } as const;

/** What's on disk, what it costs, and which one is selected — for the Settings model manager. */
export function aiModelStatus(): AiModelStatus[] {
  const selected = settings.get().subtitles.whisperModel;
  return (['base', 'small'] as const).map((id) => {
    const p = tools.whisperModelPath(id);
    let sizeBytes: number = whisperModelSizes[id];
    if (p) {
      try {
        sizeBytes = fs.statSync(p).size;
      } catch {
        // Fall back to the expected size; a stat failure isn't worth failing the whole list.
      }
    }
    return {
      id,
      label: id === 'base' ? 'Base' : 'Small',
      present: Boolean(p),
      sizeBytes,
      ramHintBytes: whisperRamHints[id],
      // Base ships inside Lumina; only a downloaded copy can be removed.
      bundled: id === 'base' && Boolean(p) && !p!.startsWith(downloadedModelsDir()),
      selected: id === selected,
    };
  });
}

/** Delete a downloaded model to reclaim the disk. Bundled models are refused, not silently ignored. */
export function removeAiModel(id: 'base' | 'small'): boolean {
  const dest = path.join(downloadedModelsDir(), `ggml-${id}.bin`);
  if (!fs.existsSync(dest)) return false;
  fs.rmSync(dest, { force: true });
  log.info(`Removed the ${id} speech model`);
  // Fall back to a model that still exists so the next job doesn't fail on a missing file.
  if (settings.get().subtitles.whisperModel === id && tools.whisperModelPath('base')) {
    settings.update({ subtitles: { whisperModel: 'base' } });
  }
  return true;
}

/** Thrown before any model is touched when the user has turned on-device AI off. */
export function assertLocalAiEnabled() {
  if (!settings.get().subtitles.localAi) {
    throw new Error('On-device subtitle generation is turned off. Turn it back on in Settings › Subtitles.');
  }
}

export function whisperModelPath(): string {
  assertLocalAiEnabled();
  const model = settings.get().subtitles.whisperModel;
  const p = tools.whisperModelPath(model) ?? (model === 'small' ? null : tools.whisperModelPath('base'));
  if (!p) throw new Error(model === 'small'
    ? 'The Small subtitle model isn’t downloaded yet. Download it in Settings › Subtitles, or switch back to Base.'
    : 'The subtitle model is missing. Reinstall Lumina to restore it.');
  return p;
}

/** Download the Small Whisper model on request. */
export async function downloadSmallModel(onProgress: (fraction: number) => void): Promise<string> {
  const dest = path.join(downloadedModelsDir(), 'ggml-small.bin');
  if (fs.existsSync(dest) && fs.statSync(dest).size >= whisperModelSizes.small * 0.98) return dest;
  const res = await fetch('https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin');
  if (!res.ok || !res.body) throw new Error(`Model download failed (${res.status}).`);
  const total = Number(res.headers.get('content-length')) || whisperModelSizes.small;
  const tmp = `${dest}.part`;
  const out = fs.createWriteStream(tmp);
  let done = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    done += chunk.length;
    if (!out.write(chunk)) await new Promise<void>((r) => out.once('drain', () => r()));
    onProgress(done / total);
  }
  await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
  if (fs.statSync(tmp).size < total * 0.98) throw new Error('Model download was incomplete.');
  fs.renameSync(tmp, dest);
  return dest;
}

/**
 * Generate English subtitles with whisper.cpp. Non-English speech is translated to English.
 * Writes "<media>.en.srt" and returns its path.
 */
export async function generateEnglishSubtitles(
  mediaPath: string, durationSec: number | null, workDir: string,
  onProgress: (fraction: number, stage: string) => void, c: Cancellable,
): Promise<string> {
  const wav = path.join(workDir, `${path.basename(mediaPath)}.16k.wav`);
  onProgress(0, 'Preparing audio for subtitles');
  const extract = extractSpeechAudio(mediaPath, wav, durationSec, (f) => onProgress(f * 0.1, 'Preparing audio for subtitles'));
  c.register(extract.cancel);
  await extract.promise;

  const outBase = path.join(path.dirname(mediaPath), path.basename(mediaPath, path.extname(mediaPath)));
  const args = [
    '-m', whisperModelPath(), '-f', wav, '-l', 'auto', '-tr', '-osrt', '-of', `${outBase}.en`, '-pp',
    '-t', String(Math.max(2, Math.min(8, os.availableParallelism() - 1))),
  ];
  if (!settings.get().subtitles.useGpu) args.push('-ng');

  await new Promise<void>((resolve, reject) => {
    const child = spawnTool(tools.require('whisper-cli'), args, { cwd: path.dirname(tools.require('whisper-cli')) });
    c.register(() => killTree(child));
    let tail = '';
    const handle = (line: string) => {
      tail = `${tail}\n${line}`.slice(-4000);
      const m = line.match(/progress\s*=\s*(\d+)%/);
      if (m?.[1]) onProgress(0.1 + (Number(m[1]) / 100) * 0.9, 'Generating English subtitles');
    };
    onLines(child.stdout, handle);
    onLines(child.stderr, handle);
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Subtitle generation failed. ${tail.split('\n').filter(Boolean).slice(-2).join(' ')}`))));
  });
  fs.rmSync(wav, { force: true });

  const srt = `${outBase}.en.srt`;
  if (!fs.existsSync(srt)) throw new Error('Whisper finished but produced no subtitles.');
  log.info(`Generated subtitles for ${path.basename(mediaPath)}`);
  return srt;
}

/** Apply the chosen outputs to a video that has "<name>.en.srt" next to it. */
export async function applySubtitleOutputs(videoPath: string, srt: string, outputs: SubtitleOutput[], c: Cancellable): Promise<void> {
  if (outputs.includes('embed')) await embedSubtitles(videoPath, [srt], c.register);
  // Burning is done by the TV-safe transcode step; nothing to do here.
  if (!outputs.includes('sidecar') && !outputs.includes('burn')) fs.rmSync(srt, { force: true });
}
