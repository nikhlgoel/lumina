import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildDownloadArgs, outputTemplate } from '../../core/ytdlpArgs';
import { diskCacheMb } from '../../core/tuning';
import { friendlyYtdlpError, isCookieReadError, parseYtdlpLine, postprocessLabel } from '../../core/progress';
import { browserCookiesUnreadable, markBrowserCookiesUnreadable } from '../cookieHealth';
import { parseExtraArgs, speedLimitActive } from '../../shared/settings';
import { killTree, onLines, spawnTool } from '../process';
import { tools } from '../tools';
import { settings } from '../settings';
import { archiveFile } from '../paths';
import { requestContext } from '../request';
import { matchTracks } from '../services/ytmusic';
import { logger } from '../log';
import { postprocess } from './postprocess';
import type { Runner } from './queue';

const log = logger('ytdlp');

export const ytdlpRunner: Runner = (ctx) => {
  const job = ctx.job();
  const s = settings.get();
  let child: ReturnType<typeof spawnTool> | null = null;
  let stopped: 'pause' | 'cancel' | null = null;
  const cancels = new Set<() => void>();

  const isPlaylist = job.source.sourceKind === 'playlist';
  // Tracks from Spotify are matched to YouTube Music first, then downloaded as a list of URLs.
  const needsMatching = isPlaylist && job.source.entries.some((e) => e.match);
  const chosenEntries = job.options.playlistItems.length
    ? job.source.entries.filter((e) => job.options.playlistItems.includes(e.index))
    : job.source.entries;

  let outputDir = job.options.targetDir || job.outputDir || s.storage.otherDir;
  let template = outputTemplate(job.options, isPlaylist, s.downloads.playlistNumbering, s.downloads.filenameTemplate, {
    music: s.downloads.musicLayout, video: s.downloads.videoLayout,
  });
  if (needsMatching) {
    outputDir = path.join(outputDir, job.title.replace(/[\\/:*?"<>|]/g, '_').replace(/[. ]+$/, '').slice(0, 120) || 'Playlist');
    template = `${s.downloads.playlistNumbering ? '%(autonumber)02d - ' : ''}%(title)s.%(ext)s`;
  }
  fs.mkdirSync(outputDir, { recursive: true });
  ctx.patch({ outputDir });

  // If the work dir is on a different drive than the output, a separate temp forces a slow cross-drive copy when
  // the download finishes. In that case download straight into the output folder (same-volume rename on finish).
  const sameVolume = (a: string, b: string): boolean => {
    try {
      return fs.statSync(a).dev === fs.statSync(b).dev;
    } catch {
      return true; // can't tell → keep the default temp behaviour
    }
  };
  const downloadTemp = sameVolume(ctx.workDir, outputDir) ? ctx.workDir : '';

  const { args: extraArgs } = parseExtraArgs(s.advanced.extraYtdlpArgs);
  // The bundled aria2c powers the multi-connection accelerator for plain HTTP downloads (missing tool → native path).
  let aria2cPath: string | null = null;
  if (s.downloads.accelerate) {
    try {
      aria2cPath = tools.require('aria2c');
    } catch {
      aria2cPath = null;
    }
  }
  // One structured line so a stuck/slow download can be diagnosed from the log alone: which engine, how many
// connections, the RAM write-buffer size, whether we avoided a cross-drive copy, and — a real cause of
// "stuck at N GB" — how much room is left on the destination volume.
  const freeSpaceGb = (dir: string): number | null => {
    try {
      const { bavail, bsize } = fs.statfsSync(dir);
      return Math.round((Number(bavail) * Number(bsize)) / 2 ** 30 * 10) / 10;
    } catch {
      return null;
    }
  };
  log.info(`Download plan for ${job.title}`, {
    engine: aria2cPath && s.downloads.accelerate ? 'yt-dlp+aria2c' : 'yt-dlp native',
    accelerate: s.downloads.accelerate,
    connectionsPerServer: s.network.connectionsPerServer,
    diskCacheMb: diskCacheMb(os.totalmem()),
    temp: downloadTemp ? 'same-volume temp' : 'direct-to-output (cross-drive avoided)',
    outputDir,
    freeSpaceGb: freeSpaceGb(outputDir),
    speedLimitKbps: speedLimitActive(s) ? s.downloads.speedLimitKbps : 0,
  });

  const buildArgs = (opts: { batchFile?: string; browserCookies: boolean }) => buildDownloadArgs({
    url: job.url, batchFile: opts.batchFile, options: job.options, outputDir, tempDir: downloadTemp, outputTemplate: template,
    ffmpegDir: tools.ffmpegDir(), jsRuntime: tools.jsRuntime(),
    archiveFile: isPlaylist && s.downloads.skipExisting ? archiveFile() : null,
    isPlaylist: isPlaylist && !needsMatching,
    request: requestContext(job.source.request, ctx.workDir, { withBrowserCookies: opts.browserCookies }),
    speedLimitKbps: speedLimitActive(s) ? s.downloads.speedLimitKbps : 0,
    retries: s.downloads.retries,
    concurrentFragments: s.downloads.concurrentFragments,
    aria2cPath,
    connectionsPerServer: s.network.connectionsPerServer,
    diskCacheMb: diskCacheMb(os.totalmem()),
    accelerate: s.downloads.accelerate,
    sponsorBlock: s.downloads.sponsorBlock,
    sponsorCategories: s.downloads.sponsorCategories,
    embedThumbnail: s.downloads.embedThumbnail,
    squareMusicArtwork: s.downloads.squareMusicArtwork,
    includeAutoSubs: s.subtitles.includeAutoGenerated,
    windowsFilenames: process.platform === 'win32',
    extraArgs,
  });

  // Progress model: each item has one or two stream downloads (video then audio).
  const streamsPerItem = job.options.format.kind === 'video' ? 2 : 1;
  let itemsSeen = 0;
  let itemCount = isPlaylist ? chosenEntries.length || 1 : 1;
  let itemIndex = 0;
  let streamIndex = 0;
  let lastFraction = 0;
  const outputs: string[] = [...job.outputPaths];
  let errors: string[] = [];
  let stderrTail = '';

  const overall = (fraction: number) => {
    const itemFraction = Math.min(1, (streamIndex + fraction) / streamsPerItem);
    return Math.min(99, (100 * (itemIndex + itemFraction)) / Math.max(1, itemCount));
  };

  const handleLine = (line: string) => {
    const ev = parseYtdlpLine(line);
    if (!ev) {
      if (/^(ERROR|WARNING):/.test(line)) stderrTail = `${stderrTail}\n${line}`.slice(-6000);
      return;
    }
    switch (ev.type) {
      case 'item': {
        // Count items as they start; playlist_index can skip numbers when items are selected.
        itemsSeen++;
        itemIndex = itemsSeen - 1;
        if (ev.count && !job.options.playlistItems.length && !needsMatching) itemCount = ev.count;
        streamIndex = 0;
        lastFraction = 0;
        if (itemCount > 1) {
          ctx.progress({ item: { index: Math.min(itemsSeen, itemCount), count: itemCount, title: ev.title }, stage: ev.title }, 'running');
        }
        break;
      }
      case 'progress': {
        if (ev.status === 'finished') {
          streamIndex = Math.min(streamsPerItem - 1, streamIndex + 1);
          lastFraction = 0;
          return;
        }
        const fraction = ev.total ? ev.downloaded! / ev.total : ev.fragment ? ev.fragment[0] / ev.fragment[1] : lastFraction;
        lastFraction = fraction;
        ctx.progress({
          percent: overall(fraction), speedBps: ev.speed, etaSec: ev.eta, downloadedBytes: ev.downloaded, totalBytes: ev.total,
          stage: itemCount > 1 ? ctx.job().progress.item?.title ?? 'Downloading' : streamsPerItem === 2 ? (streamIndex === 0 ? 'Downloading video' : 'Downloading audio') : 'Downloading',
        }, 'running');
        break;
      }
      case 'postprocess':
        if (ev.status === 'started') ctx.progress({ stage: postprocessLabel(ev.name), speedBps: null, etaSec: null }, 'running');
        break;
      case 'file':
        outputs.push(ev.path);
        ctx.patch({ outputPaths: [...outputs], engineState: { ...ctx.job().engineState, finishedItems: outputs.length } });
        break;
      case 'error':
        errors.push(ev.message);
        break;
    }
  };

  const run = (opts: { batchFile?: string; browserCookies: boolean }) => {
    log.info(`Starting ${job.title}${opts.browserCookies ? '' : ' (without browser cookies)'}`);
    errors = [];
    stderrTail = '';
    child = spawnTool(tools.require('yt-dlp'), buildArgs(opts), { env: tools.env(), cwd: outputDir });
    onLines(child.stdout, handleLine);
    onLines(child.stderr, handleLine);
    child.on('error', (err) => ctx.fail(`Could not start yt-dlp: ${err.message}`));
    child.on('close', async (code) => {
      child = null;
      if (stopped) return;
      const allErrors = `${errors.join('\n')}\n${stderrTail}`;

      // A locked or encrypted browser cookie store shouldn't sink public downloads: retry once without it.
      if (code !== 0 && opts.browserCookies && isCookieReadError(allErrors) && !outputs.length) {
        markBrowserCookiesUnreadable();
        ctx.patch({ engineState: { ...ctx.job().engineState, cookieFallback: true } });
        ctx.progress({ stage: 'Couldn’t read browser cookies, retrying without them' }, 'running');
        run({ ...opts, browserCookies: false });
        return;
      }

      // Playlists: yt-dlp exits 1 if some items failed but others succeeded.
      const partial = isPlaylist && outputs.length > 0;
      if (code !== 0 && !partial) {
        const msg = errors.at(-1) ?? stderrTail.split('\n').filter(Boolean).at(-1) ?? `yt-dlp exited with code ${code}`;
        ctx.fail(friendlyYtdlpError(msg.replace(/^ERROR:\s*/, '')), stderrTail || errors.join('\n'));
        return;
      }
      if (!outputs.length && !(isPlaylist && s.downloads.skipExisting)) {
        ctx.fail('yt-dlp finished without producing a file.', stderrTail);
        return;
      }
      try {
        await postprocess(ctx, { register: (c) => cancels.add(c), stopped: () => stopped !== null });
        if (stopped) return;
        if (errors.length && partial) {
          ctx.patch({ compat: { ...(ctx.job().compat ?? { tvSafe: false }), summary: `${errors.length} item(s) could not be downloaded: ${friendlyYtdlpError(errors[0]!)}` } });
        }
        log.info(`Completed ${job.title}`, { files: outputs.length, partial, failedItems: errors.length });
        ctx.complete();
      } catch (err) {
        if (!stopped) ctx.fail(err instanceof Error ? err.message : String(err));
      }
    });
  };

  (async () => {
    let batchFile: string | undefined;
    if (needsMatching) {
      ctx.progress({ stage: `Finding songs on YouTube Music (0/${chosenEntries.length})`, percent: 0 }, 'running');
      const { urls, unmatched } = await matchTracks(
        chosenEntries.map((e) => e.match ?? { title: e.title, artist: e.uploader, durationSec: e.durationSec }),
        (done) => ctx.progress({ stage: `Finding songs on YouTube Music (${done}/${chosenEntries.length})` }, 'running'),
        () => stopped !== null,
      );
      if (stopped) return;
      if (unmatched) log.info(`${unmatched} of ${urls.length} tracks had no exact YouTube Music match; using search`);
      batchFile = path.join(ctx.workDir, 'batch.txt');
      fs.writeFileSync(batchFile, urls.join('\n'), 'utf8');
    }
    run({ batchFile, browserCookies: !browserCookiesUnreadable() });
  })().catch((err) => ctx.fail(err instanceof Error ? err.message : String(err)));

  return {
    stop: (reason) => {
      stopped = reason;
      killTree(child);
      for (const c of cancels) c();
    },
  };
};
