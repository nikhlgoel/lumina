import fs from 'node:fs';
import path from 'node:path';
import type { AudioFormatChoice, FormatChoice, Job } from '../../shared/types';
import { mediaKindOf } from '../../core/playlists';
import { compatibility, probe } from '../media/probe';
import { convertAudio, transcodeTvSafe } from '../media/ffmpeg';
import { applySubtitleOutputs, findEnglishSidecar, generateEnglishSubtitles } from '../subtitles';
import { settings } from '../settings';
import { queue, type Runner } from './queue';

/** Queue conversion jobs for existing files (e.g. make old downloads TV-safe). */
export function queueConversion(paths: string[], format: FormatChoice): Job[] {
  return paths.map((p) => queue.add({
    url: p, title: path.basename(p), thumbnail: null, uploader: 'Convert', engine: 'convert', outputDir: path.dirname(p),
    options: {
      contentType: format.kind === 'audio' ? 'music' : 'video', format, englishSubtitles: false, subtitleOutput: [],
      embedMetadata: true, embedLyrics: false, sponsorBlock: false, playlistItems: [],
    },
    source: { sourceKind: 'media', site: 'Local file', entries: [] },
  }));
}

export function queueSubtitleGeneration(file: string): Job {
  const s = settings.get();
  return queue.add({
    url: file, title: path.basename(file), thumbnail: null, uploader: 'English subtitles', engine: 'subtitles', outputDir: path.dirname(file),
    options: {
      contentType: 'video', format: { kind: 'video', maxHeight: null, codec: 'any', container: 'mkv', maxFps: null, allowHdr: true, tvSafe: false },
      englishSubtitles: true, subtitleOutput: s.subtitles.output, embedMetadata: false, embedLyrics: false, sponsorBlock: false, playlistItems: [],
    },
    source: { sourceKind: 'media', site: 'Local file', entries: [] },
  });
}

function uniquePath(p: string): string {
  if (!fs.existsSync(p)) return p;
  const ext = path.extname(p);
  const stem = p.slice(0, -ext.length);
  for (let i = 2; ; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!fs.existsSync(candidate)) return candidate;
  }
}

export const convertRunner: Runner = (ctx) => {
  const job = ctx.job();
  const cancels = new Set<() => void>();
  let stopped = false;
  const register = (c: () => void) => cancels.add(c);

  (async () => {
    const input = job.url;
    if (!fs.existsSync(input)) throw new Error('The file no longer exists.');
    const info = await probe(input);
    const f = job.options.format;
    const stem = path.join(path.dirname(input), path.basename(input, path.extname(input)));
    ctx.progress({ stage: 'Converting', percent: 0 }, 'processing');

    let output: string;
    if (f.kind === 'video') {
      if (mediaKindOf(input) !== 'video' || !info.video) throw new Error('This file has no video to convert.');
      output = uniquePath(`${stem} (TV).mp4`);
      await transcodeTvSafe({
        input, output, durationSec: info.durationSec, maxHeight: f.maxHeight ?? 1080, maxFps: f.maxFps ?? 60,
        onProgress: (x) => ctx.progress({ percent: x * 100, stage: 'Converting for TV playback' }, 'processing'), register,
      });
      ctx.patch({ compat: compatibility(await probe(output)) });
    } else {
      const chosen = (f as AudioFormatChoice).target;
      const target = chosen === 'original' ? 'm4a' : chosen;
      output = uniquePath(`${stem}.${target}`);
      const run = convertAudio(input, output, target, f.bitrateKbps, info.durationSec, (x) => ctx.progress({ percent: x * 100, stage: `Converting to ${target.toUpperCase()}` }, 'processing'));
      register(run.cancel);
      await run.promise;
    }
    if (stopped) {
      fs.rmSync(output, { force: true });
      return;
    }
    ctx.patch({ outputPaths: [output], outputDir: path.dirname(output), title: path.basename(output) });
    ctx.complete();
  })().catch((err) => {
    if (!stopped) ctx.fail(err instanceof Error ? err.message : String(err));
  });

  return {
    stop: () => {
      stopped = true;
      for (const c of cancels) c();
    },
  };
};

export const subtitlesRunner: Runner = (ctx) => {
  const job = ctx.job();
  const cancels = new Set<() => void>();
  let stopped = false;
  const control = { register: (c: () => void) => cancels.add(c) };

  (async () => {
    const file = job.url;
    if (!fs.existsSync(file)) throw new Error('The file no longer exists.');
    const info = await probe(file);
    let srt = findEnglishSidecar(file);
    if (!srt) {
      srt = await generateEnglishSubtitles(file, info.durationSec, ctx.workDir, (f, stage) => ctx.progress({ percent: f * 95, stage }, 'processing'), control);
    }
    if (stopped) return;
    if (job.options.subtitleOutput.includes('embed')) {
      ctx.progress({ percent: 96, stage: 'Adding subtitles to the file' }, 'processing');
      await applySubtitleOutputs(file, srt, job.options.subtitleOutput.filter((o) => o !== 'burn'), control);
    }
    ctx.patch({ outputPaths: [file, ...(fs.existsSync(srt) ? [srt] : [])], outputDir: path.dirname(file) });
    ctx.complete();
  })().catch((err) => {
    if (!stopped) ctx.fail(err instanceof Error ? err.message : String(err));
  });

  return {
    stop: () => {
      stopped = true;
      for (const c of cancels) c();
    },
  };
};
