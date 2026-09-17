// Development-only end-to-end check of the download engine inside real Electron.
// Run: LUMINA_SELFTEST=1 electron . (after `vite build`). Never active in packaged builds.
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { Job } from '../shared/types';
import { presetById } from '../core/presets';
import { tools } from './tools';
import { inspect } from './inspect';
import { queue } from './jobs/queue';
import { settings } from './settings';
import { library } from './library';
import { getLyrics } from './lyrics';
import { queueSubtitleGeneration } from './jobs/cpu';
import { matchTracks } from './services/ytmusic';

const out = (m: string) => process.stdout.write(`[selftest] ${m}\n`);

function waitFor(id: string): Promise<Job> {
  return new Promise((resolve) => {
    let last = '';
    const onUpdate = (job: Job) => {
      if (job.id !== id) return;
      const line = `${job.status} ${Math.round(job.progress.percent)}% ${job.progress.stage}`;
      if (line !== last) out(`  ${line}`);
      last = line;
      if (['completed', 'failed', 'cancelled'].includes(job.status)) {
        queue.off('updated', onUpdate);
        resolve(job);
      }
    };
    queue.on('updated', onUpdate);
  });
}

export async function runSelftest(): Promise<void> {
  const dir = process.env.LUMINA_SELFTEST_DIR ?? path.join(app.getPath('temp'), 'lumina-selftest');
  fs.mkdirSync(dir, { recursive: true });
  settings.update({ storage: { musicDir: path.join(dir, 'Music'), videoDir: path.join(dir, 'Videos'), otherDir: path.join(dir, 'Other'), libraryRoots: [dir] } });

  const statuses = await tools.probeAll();
  for (const s of statuses) out(`tool ${s.name}: ${s.ok ? `${s.version} (${s.source})` : `MISSING ${s.error}`}`);

  if (process.env.LUMINA_SELFTEST_HOSTS) {
    const { runHostsSelftest } = await import('./selftestHosts');
    await runHostsSelftest(dir);
    return;
  }

  if (process.env.LUMINA_SELFTEST_BATCH) {
    const { runBatchSelftest } = await import('./selftestBatch');
    await runBatchSelftest(dir);
    return;
  }

  if (process.env.LUMINA_SELFTEST_SPOTIFY) {
    const sp = await inspect(process.env.LUMINA_SELFTEST_SPOTIFY);
    out(`spotify: "${sp.title}" by ${sp.uploader}, ${sp.entries.length} tracks`);
    for (const n of sp.notes ?? []) out(`  note: ${n}`);
    const sample = sp.entries.slice(0, 5);
    const { urls, unmatched } = await matchTracks(sample.map((e) => e.match!), () => undefined, () => false);
    sample.forEach((e, i) => out(`  ${e.uploader} – ${e.title} (${e.durationSec}s) → ${urls[i]}`));
    out(`  unmatched: ${unmatched}`);
    if (process.env.LUMINA_SELFTEST_SPOTIFY_ONLY) return;
  }

  const url = process.env.LUMINA_SELFTEST_URL ?? 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
  out(`inspect ${url}`);
  const info = await inspect(url);
  out(`  "${info.title}" by ${info.uploader}, ${info.durationSec}s, music=${info.isMusic}`);
  out(`  video: ${info.videoStreams.slice(0, 4).map((v) => `${v.height}p${v.fps} ${v.codec}${v.hdr ? ' HDR' : ''}`).join(', ')}`);
  out(`  audio: ${info.audioStreams.slice(0, 3).map((a) => `${a.codec} ${a.bitrateKbps}k`).join(', ')}`);
  out(`  subtitles: ${info.subtitles.filter((t) => t.lang.startsWith('en')).map((t) => `${t.lang}${t.auto ? '(auto)' : ''}`).join(', ') || 'none in English'}`);

  const base = { englishSubtitles: false, subtitleOutput: [] as ('sidecar' | 'embed' | 'burn')[], embedMetadata: true, embedLyrics: false, sponsorBlock: false, playlistItems: [] };

  out('download: TV-safe 720p + English subtitles (sidecar + embed)');
  const tv = queue.addFromInfo(url, info, { ...base, contentType: 'video', format: presetById('video-tv-720')!.format, englishSubtitles: true, subtitleOutput: ['sidecar', 'embed'] }, path.join(dir, 'Videos'));
  const tvDone = await waitFor(tv.id);
  out(`  result: ${tvDone.status} ${tvDone.error?.message ?? ''}`);
  out(`  files: ${tvDone.outputPaths.join(' | ')}`);
  out(`  compat: ${JSON.stringify(tvDone.compat)}`);
  const srt = tvDone.outputPaths[0] ? `${tvDone.outputPaths[0].slice(0, -path.extname(tvDone.outputPaths[0]).length)}.en.srt` : '';
  out(`  sidecar srt: ${srt && fs.existsSync(srt) ? `yes (${fs.statSync(srt).size} bytes)` : 'no'}`);

  if (tvDone.outputPaths[0] && srt) {
    out('whisper: generate English subtitles for the downloaded video');
    fs.rmSync(srt, { force: true });
    const started = Date.now();
    const gen = queueSubtitleGeneration(tvDone.outputPaths[0]);
    const genDone = await waitFor(gen.id);
    out(`  result: ${genDone.status} ${genDone.error?.message ?? ''} in ${Math.round((Date.now() - started) / 1000)}s`);
    if (fs.existsSync(srt)) {
      const head = fs.readFileSync(srt, 'utf8').trim().split(/\r?\n/).slice(0, 8);
      out(`  srt: ${head.join(' / ')}`);
    }
  }

  out('download: Original audio');
  const au = queue.addFromInfo(url, info, { ...base, contentType: 'music', format: presetById('audio-original')!.format }, path.join(dir, 'Music'));
  const auDone = await waitFor(au.id);
  out(`  result: ${auDone.status} ${auDone.error?.message ?? ''}`);
  out(`  files: ${auDone.outputPaths.join(' | ')}`);
  out(`  compat: ${JSON.stringify(auDone.compat)}`);

  await library.scan();
  out(`library: ${JSON.stringify(library.stats())}`);
  for (const item of library.items({})) out(`  ${item.kind} "${item.title}" ${item.codec} ${item.bitrateKbps ?? '?'}kbps ${item.height ? `${item.height}p` : ''}`);

  const lyr = await getLyrics({ title: 'Bohemian Rhapsody', artist: 'Queen', durationSec: 355, path: null });
  out(`lyrics: ${lyr ? `${lyr.source} synced=${lyr.synced} lines=${lyr.lines.length}` : 'none'}`);
}
