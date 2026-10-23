import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildDownloadArgs, outputTemplate } from '../../core/ytdlpArgs';
import { diskCacheMb } from '../../core/tuning';
import { friendlyYtdlpError, isCookieReadError, parseYtdlpLine, splitYtdlpLine } from '../../core/progress';
import { applyProgressEvent, initialProgressState, type ProgressModelOptions, type ProgressModelState } from '../../core/ytdlpProgress';
import { aggregateProgress, allItems, planShards, playlistItemsArg } from '../../core/playlistShards';
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

  const buildArgs = (opts: { batchFile?: string; browserCookies: boolean; playlistItemsArg?: string; archiveFile?: string | null }) => buildDownloadArgs({
    url: job.url, batchFile: opts.batchFile, options: job.options, outputDir, tempDir: downloadTemp, outputTemplate: template,
    ffmpegDir: tools.ffmpegDir(), jsRuntime: tools.jsRuntime(),
    playlistItemsArg: opts.playlistItemsArg,
    archiveFile: opts.archiveFile ?? null,
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

  // Progress model: each item has one or two stream downloads (video then audio). The arithmetic
  // lives in core so it can be replayed against a real capture of yt-dlp's output — the inline
  // version here was blamed and "fixed" three times while being correct. See D15.
  const streamsPerItem: 1 | 2 = job.options.format.kind === 'video' ? 2 : 1;
  const totalItems = isPlaylist ? chosenEntries.length || 1 : 1;

  const outputs: string[] = [...job.outputPaths];

  interface Worker {
    /** Which items this process takes, already formatted; null when it takes everything. */
    playlistItems: string | null;
    batchFile?: string;
    archive: string | null;
    child: ReturnType<typeof spawnTool> | null;
    model: ProgressModelOptions;
    state: ProgressModelState;
    finished: number;
    speedBps: number | null;
    filePercent: number | null;
    title: string;
    errors: string[];
    stderrTail: string;
    closed: boolean;
    code: number | null;
  }

  let workers: Worker[] = [];
  let batchCounts: number[] = [];
  const sharded = () => workers.length > 1;

  /**
   * A worker's own copy of the download archive.
   *
   * Several processes appending to one file is a race nobody should have to reason about, so each
   * gets a copy seeded from the shared one — it still knows what was downloaded before — and the
   * new lines are folded back in when the job finishes.
   */
  const shardArchive = (globalArchive: string | null, index: number | null): string | null => {
    if (!globalArchive || index === null) return globalArchive;
    const file = path.join(ctx.workDir, `archive-${index}.txt`);
    try {
      fs.copyFileSync(globalArchive, file);
    } catch {
      // No archive yet, or unreadable: start this worker with an empty one rather than failing.
      try { fs.writeFileSync(file, '', 'utf8'); } catch { return globalArchive; }
    }
    return file;
  };

  const makeWorker = (items: number[] | null, batchFile: string | undefined, count: number, archive: string | null): Worker => {
    const model: ProgressModelOptions = {
      streamsPerItem,
      itemCount: Math.max(1, count),
      // A shard, a hand-picked selection and a matched Spotify list are all counted here already,
      // and yt-dlp reports NA for `n_entries` on a batch file anyway.
      countIsFixed: items !== null || job.options.playlistItems.length > 0 || needsMatching,
    };
    return {
      playlistItems: items ? playlistItemsArg(items) : null,
      batchFile, archive, child: null, model, state: initialProgressState(model),
      finished: 0, speedBps: null, filePercent: null, title: '',
      errors: [], stderrTail: '', closed: false, code: null,
    };
  };

  /**
   * What the job shows while several processes are running.
   *
   * The speeds add, because they are separate transfers and the sum is what the link is carrying.
   * There is no single "this file" any more, so the headline figure is how far through the files in
   * hand they are between them — which moves constantly, where the job percentage on a 433-item
   * playlist cannot. See D15 and D19.
   */
  const report = () => {
    const agg = aggregateProgress(workers.map((w) => ({ finished: w.finished, total: w.model.itemCount, speedBps: w.closed ? null : w.speedBps })));
    const live = workers.filter((w) => !w.closed);
    const fractions = live.map((w) => w.filePercent).filter((v): v is number => v != null);
    ctx.progress({
      percent: agg.percent,
      filePercent: fractions.length ? fractions.reduce((a, b) => a + b, 0) / fractions.length : null,
      speedBps: agg.speedBps,
      etaSec: null,
      downloadedBytes: null,
      totalBytes: null,
      stage: live.length > 1 ? `Downloading ${live.length} at once` : live[0]?.title || 'Downloading',
      item: { index: Math.min(agg.finished + 1, agg.total), count: agg.total, title: live[0]?.title ?? '' },
    }, 'running');
  };

  const handleLine = (w: Worker) => (raw: string) => {
    for (const line of splitYtdlpLine(raw)) handlePiece(w, line);
  };

  const handlePiece = (w: Worker, line: string) => {
    const ev = parseYtdlpLine(line);
    if (!ev) {
      if (/^(ERROR|WARNING):/.test(line)) w.stderrTail = [w.stderrTail, line].join('\n').slice(-6000);
      return;
    }
    if (ev.type === 'file') {
      outputs.push(ev.path);
      w.finished++;
      ctx.patch({ outputPaths: [...outputs], engineState: { ...ctx.job().engineState, finishedItems: outputs.length } });
      if (sharded()) report();
      return;
    }
    if (ev.type === 'error') {
      w.errors.push(ev.message);
      return;
    }
    const step = applyProgressEvent(w.state, ev, w.model);
    w.state = step.state;
    if (!step.patch) return;
    if (step.patch.speedBps !== undefined) w.speedBps = step.patch.speedBps;
    if (step.patch.filePercent != null) w.filePercent = step.patch.filePercent;
    if (step.patch.item?.title) w.title = step.patch.item.title;
    else if (step.patch.stage) w.title = step.patch.stage;
    if (sharded()) report();
    else ctx.progress(step.patch, 'running');
  };

  /** Fold each worker's archive back into the shared one. Their item sets are disjoint, so this is a union. */
  const mergeArchives = () => {
    const target = isPlaylist && s.downloads.skipExisting ? archiveFile() : null;
    if (!target) return;
    const shardFiles = workers.map((w) => w.archive).filter((a): a is string => Boolean(a) && a !== target);
    if (!shardFiles.length) return;
    try {
      const lines = (text: string) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const seen = new Set<string>(fs.existsSync(target) ? lines(fs.readFileSync(target, 'utf8')) : []);
      const added: string[] = [];
      for (const file of shardFiles) {
        if (!fs.existsSync(file)) continue;
        for (const entry of lines(fs.readFileSync(file, 'utf8'))) {
          if (seen.has(entry)) continue;
          seen.add(entry);
          added.push(entry);
        }
      }
      if (added.length) fs.appendFileSync(target, `${added.join('\n')}\n`, 'utf8');
    } catch (err) {
      log.warn('Could not merge download archives', err);
    }
  };

  const finish = async (opts: { batchFiles?: string[]; browserCookies: boolean }) => {
    if (stopped) return;
    const errors = workers.flatMap((w) => w.errors);
    const stderrTail = workers.map((w) => w.stderrTail).filter(Boolean).join('\n').slice(-8000);
    const allErrors = `${errors.join('\n')}\n${stderrTail}`;
    const failedCodes = workers.map((w) => w.code).filter((c) => c !== 0);

    // A locked or encrypted browser cookie store shouldn't sink public downloads: retry once without it.
    if (failedCodes.length && opts.browserCookies && isCookieReadError(allErrors) && !outputs.length) {
      markBrowserCookiesUnreadable();
      ctx.patch({ engineState: { ...ctx.job().engineState, cookieFallback: true } });
      ctx.progress({ stage: 'Couldn’t read browser cookies, retrying without them' }, 'running');
      start({ ...opts, browserCookies: false });
      return;
    }

    mergeArchives();

    // Playlists: yt-dlp exits 1 if some items failed but others succeeded. With several workers the
    // same holds across them — one shard failing is not the job failing.
    const partial = isPlaylist && outputs.length > 0;
    if (failedCodes.length && !partial) {
      const msg = errors.at(-1) ?? stderrTail.split('\n').filter(Boolean).at(-1) ?? `yt-dlp exited with code ${failedCodes[0]}`;
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
      log.info(`Completed ${job.title}`, { files: outputs.length, partial, failedItems: errors.length, workers: workers.length });
      ctx.complete();
    } catch (err) {
      if (!stopped) ctx.fail(err instanceof Error ? err.message : String(err));
    }
  };

  const start = (opts: { batchFiles?: string[]; browserCookies: boolean }) => {
    const globalArchive = isPlaylist && s.downloads.skipExisting ? archiveFile() : null;

    // One playlist, several processes. yt-dlp walks a playlist one item at a time, and a measured
    // ~4.8 s of that per item goes on working out what to fetch rather than fetching — so a long
    // playlist leaves the link mostly idle, while more sockets per file measurably do nothing at
    // all on a link that is already saturated. See D19.
    if (opts.batchFiles?.length) {
      const many = opts.batchFiles.length > 1;
      workers = opts.batchFiles.map((file, i) => makeWorker(null, file, batchCounts[i] ?? 1, shardArchive(globalArchive, many ? i : null)));
    } else if (isPlaylist && totalItems > 1) {
      const picked = job.options.playlistItems.length ? [...job.options.playlistItems] : allItems(totalItems);
      const plan = planShards(picked, s.downloads.playlistWorkers);
      workers = plan.map((items, i) => makeWorker(items, undefined, items.length, shardArchive(globalArchive, plan.length > 1 ? i : null)));
    } else {
      workers = [makeWorker(null, undefined, totalItems, globalArchive)];
    }

    log.info(`Starting ${job.title}${opts.browserCookies ? '' : ' (without browser cookies)'}`, {
      workers: workers.length, items: totalItems,
    });

    let openWorkers = workers.length;
    for (const w of workers) {
      const child = spawnTool(tools.require('yt-dlp'), buildArgs({
        batchFile: w.batchFile,
        browserCookies: opts.browserCookies,
        playlistItemsArg: w.playlistItems ?? undefined,
        archiveFile: w.archive,
      }), { env: tools.env(), cwd: outputDir });
      w.child = child;
      onLines(child.stdout, handleLine(w));
      onLines(child.stderr, handleLine(w));
      child.on('error', (err) => ctx.fail(`Could not start yt-dlp: ${err.message}`));
      child.on('close', (code) => {
        w.child = null;
        w.closed = true;
        w.code = code ?? 0;
        w.speedBps = null;
        if (sharded() && !stopped) report();
        openWorkers -= 1;
        if (openWorkers === 0) void finish(opts);
      });
    }
  };

  (async () => {
    let batchFiles: string[] | undefined;
    if (needsMatching) {
      ctx.progress({ stage: `Finding songs on YouTube Music (0/${chosenEntries.length})`, percent: 0 }, 'running');
      const { urls, unmatched } = await matchTracks(
        chosenEntries.map((e) => e.match ?? { title: e.title, artist: e.uploader, durationSec: e.durationSec }),
        (done) => ctx.progress({ stage: `Finding songs on YouTube Music (${done}/${chosenEntries.length})` }, 'running'),
        () => stopped !== null,
      );
      if (stopped) return;
      if (unmatched) log.info(`${unmatched} of ${urls.length} tracks had no exact YouTube Music match; using search`);
      // A matched list is a list of separate URLs, so it shards the same way a playlist does — the
      // per-item wait is identical, and it is the wait that dominates. See D19.
      const lists = planShards(urls, s.downloads.playlistWorkers);
      batchCounts = lists.map((l) => l.length);
      batchFiles = lists.map((list, i) => {
        const file = path.join(ctx.workDir, lists.length > 1 ? `batch-${i}.txt` : 'batch.txt');
        fs.writeFileSync(file, list.join('\n'), 'utf8');
        return file;
      });
    }
    start({ batchFiles, browserCookies: !browserCookiesUnreadable() });
  })().catch((err) => ctx.fail(err instanceof Error ? err.message : String(err)));

  return {
    stop: (reason) => {
      stopped = reason;
      for (const w of workers) killTree(w.child);
      for (const c of cancels) c();
    },
  };
};
