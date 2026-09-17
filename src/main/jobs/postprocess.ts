import fs from 'node:fs';
import path from 'node:path';
import type { Job } from '../../shared/types';
import { writeM3u8, mediaKindOf } from '../../core/playlists';
import { compatibility, probe } from '../media/probe';
import { transcodeTvSafe } from '../media/ffmpeg';
import { applySubtitleOutputs, findEnglishSidecar, generateEnglishSubtitles } from '../subtitles';
import { settings } from '../settings';
import { getLyrics } from '../lyrics';
import { embedLyrics, lyricsToLrc } from '../media/tags';
import { logger } from '../log';
import type { RunnerContext } from './queue';

const log = logger('postprocess');

export interface PostprocessControl {
  register: (cancel: () => void) => void;
  stopped: () => boolean;
}

/**
 * Runs after yt-dlp has written the final files: subtitles (fetch → generate), TV-safe conversion,
 * compatibility report, and a playlist file for multi-item downloads.
 */
export async function postprocess(ctx: RunnerContext, control: PostprocessControl): Promise<void> {
  const job = ctx.job();
  const o = job.options;
  const files = [...new Set(job.outputPaths)].filter((f) => fs.existsSync(f));
  const finalPaths: string[] = [];
  const count = files.length || 1;

  for (const [i, file] of files.entries()) {
    if (control.stopped()) return;
    const step = (fraction: number, stage: string) =>
      ctx.progress({ percent: 100 * ((i + fraction) / count), stage: count > 1 ? `${stage} (${i + 1}/${count})` : stage, speedBps: null, etaSec: null }, 'processing');

    let current = file;
    const isVideo = mediaKindOf(file) === 'video' && o.format.kind === 'video';
    let info = await probe(current).catch(() => null);
    const s = settings.get();

    // 0. Music: synced lyrics into the file and/or a .lrc next to it.
    if (mediaKindOf(file) === 'audio' && info && (s.downloads.embedLyrics || s.downloads.writeLrcFile)) {
      step(0.2, 'Adding lyrics');
      try {
        const lyrics = await getLyrics({ title: info.tags.title ?? path.basename(file, path.extname(file)), artist: info.tags.artist ?? info.tags.album_artist ?? job.uploader, durationSec: info.durationSec, path: null });
        if (lyrics && !control.stopped()) {
          if (s.downloads.writeLrcFile && lyrics.synced) fs.writeFileSync(`${current.slice(0, -path.extname(current).length)}.lrc`, lyricsToLrc(lyrics));
          if (s.downloads.embedLyrics) await embedLyrics(current, lyrics, control.register);
        }
      } catch (err) {
        log.debug('Lyrics step skipped', err);
      }
    }

    // 1. English subtitles: use what the site provided, otherwise generate.
    let srt: string | null = null;
    if (isVideo && o.englishSubtitles) {
      srt = findEnglishSidecar(current);
      if (!srt) {
        try {
          srt = await generateEnglishSubtitles(current, info?.durationSec ?? null, ctx.workDir, (f, stage) => step(f * 0.6, stage), control);
        } catch (err) {
          if (control.stopped()) return;
          log.warn('Subtitle generation failed', err);
          ctx.patch({ compat: { tvSafe: false, summary: `Subtitles could not be generated: ${err instanceof Error ? err.message : err}` } });
        }
      }
    }

    // 2. TV-safe conversion (also burns subtitles when requested).
    const burn = Boolean(srt && o.subtitleOutput.includes('burn'));
    if (isVideo && info && o.format.kind === 'video' && (burn || (o.format.tvSafe && !compatibility(info, o.format.maxHeight ?? 1080).tvSafe))) {
      const maxHeight = o.format.tvSafe ? o.format.maxHeight ?? 1080 : info.video?.height ?? 2160;
      const maxFps = o.format.tvSafe ? o.format.maxFps ?? 60 : 120;
      const out = path.join(path.dirname(current), `${path.basename(current, path.extname(current))}.tv.mp4`);
      step(0.6, burn ? 'Burning in subtitles' : 'Converting for TV playback');
      const encoder = await transcodeTvSafe({
        input: current, output: out, durationSec: info.durationSec, maxHeight, maxFps,
        burnSubtitles: burn ? srt! : undefined,
        onProgress: (f) => step(0.6 + f * 0.35, burn ? 'Burning in subtitles' : 'Converting for TV playback'),
        register: control.register,
      });
      if (control.stopped()) return;
      const stem = path.basename(current, path.extname(current));
      // Keep the untouched download next to the converted copy when asked to.
      const keepOriginal = s.formats.keepOriginalAfterConvert;
      const finalName = path.join(path.dirname(current), keepOriginal ? `${stem} (TV).mp4` : `${stem}.mp4`);
      if (!keepOriginal) fs.rmSync(current, { force: true });
      fs.renameSync(out, finalName);
      if (srt) {
        const srtTarget = path.join(path.dirname(finalName), `${path.basename(finalName, '.mp4')}.en.srt`);
        if (srt !== srtTarget && fs.existsSync(srt)) fs.renameSync(srt, srtTarget);
        srt = srtTarget;
      }
      current = finalName;
      log.info(`Converted with ${encoder}: ${path.basename(current)}`);
      info = await probe(current).catch(() => null);
    }

    // 3. Soft subtitles (embed) and sidecar clean-up.
    if (isVideo && srt && fs.existsSync(srt) && !burn) {
      step(0.95, 'Adding subtitles');
      await applySubtitleOutputs(current, srt, o.subtitleOutput, control);
    } else if (srt && burn && !o.subtitleOutput.includes('sidecar')) {
      fs.rmSync(srt, { force: true });
    }

    if (info) ctx.patch({ compat: compatibility(info, o.format.kind === 'video' ? o.format.maxHeight ?? 1080 : 1080) });
    finalPaths.push(current);
  }

  // 4. A playlist file so the folder plays in order on TVs and other players.
  if (finalPaths.length > 1 && settings.get().downloads.writePlaylistFile) {
    const dir = path.dirname(finalPaths[0]!);
    if (finalPaths.every((p) => path.dirname(p) === dir)) {
      const name = job.title;
      const sorted = [...finalPaths].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      const file = path.join(dir, `${path.basename(dir)}.m3u8`);
      fs.writeFileSync(file, writeM3u8(file, name, sorted.map((p) => ({ path: p, title: path.basename(p, path.extname(p)).replace(/^\d+\s*-\s*/, ''), durationSec: null }))));
    }
  }

  ctx.patch({ outputPaths: finalPaths, outputDir: finalPaths[0] ? path.dirname(finalPaths[0]) : ctx.job().outputDir });
}

export const jobOutputDir = (job: Job) => job.outputDir;
