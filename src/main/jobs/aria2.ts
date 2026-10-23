import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { aria2Progress, friendlyAria2Error, isDiskCacheFailure, isMetadataPhase, type Aria2Status } from '../../core/progress';
import { toSelectFileSpec, toTorrentFiles, type TorrentFile } from '../../core/torrentFiles';
import { pushSample, shareRatio, type SpeedSample } from '../../core/speedHistory';
import type { TorrentDetail } from '../../shared/types';
import { diskCacheMb } from '../../core/tuning';
import { formatBytes } from '../../core/format';
import { speedLimitActive, type Settings } from '../../shared/settings';
import { killTree, spawnTool } from '../process';
import { tools } from '../tools';
import { settings } from '../settings';
import { dataDir } from '../paths';
import { cookieHeaderFor } from '../../core/cookies';
import { initialStall, needsSparse, rpcAction, stallStep, type StallState } from '../../core/engineWatch';
import { isSparse, markSparse } from '../sparse';
import { allocatedBytes, spaceShortfall } from '../../core/diskSpace';
import { compareValidators } from '../../core/resumeCheck';
import { fetchValidators } from '../resumeProbe';
import { logger } from '../log';
import { verifyDownload } from './verify';
import { resolveHostedLink } from '../hosters';
import type { Runner } from './queue';

const log = logger('aria2');

const FALLBACK_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://explodie.org:6969/announce',
];
const TRACKER_LIST_URL = 'https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_best.txt';
const trackersFile = () => path.join(dataDir(), 'trackers.txt');

/** Community tracker list, refreshed at most daily, so magnets find peers quickly. */
async function trackers(): Promise<string[]> {
  if (!settings.get().torrents.autoTrackers) return FALLBACK_TRACKERS;
  const file = trackersFile();
  const fresh = fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < 86_400_000;
  if (!fresh) {
    try {
      const res = await fetch(TRACKER_LIST_URL, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const list = (await res.text()).split(/\s+/).filter((t) => /^(udp|https?|wss?):\/\/[^\s,]+$/.test(t)).slice(0, 60);
        if (list.length) fs.writeFileSync(file, list.join('\n'));
      }
    } catch (err) {
      log.debug('Tracker list refresh failed', err);
    }
  }
  try {
    const list = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    return list.length ? [...new Set([...list, ...FALLBACK_TRACKERS])] : FALLBACK_TRACKERS;
  } catch {
    return FALLBACK_TRACKERS;
  }
}

/** Options aria2 accepts at runtime through changeGlobalOption. */
function dynamicOptions(s: Settings): Record<string, string> {
  return {
    'max-overall-download-limit': speedLimitActive(s) ? `${s.downloads.speedLimitKbps}K` : '0',
    'max-overall-upload-limit': s.torrents.uploadLimitKbps > 0 ? `${s.torrents.uploadLimitKbps}K` : '0',
    // Room for the app queue plus a burst of browser hand-offs.
    'max-concurrent-downloads': String(Math.max(32, s.downloads.concurrency + 16)),
    'bt-max-peers': String(s.torrents.maxPeers),
  };
}

class Aria2Daemon {
  private child: ChildProcess | null = null;
  private port = 0;
  private secret = randomBytes(16).toString('hex');
  private starting: Promise<void> | null = null;
  private limitTimer: NodeJS.Timeout | null = null;

  private freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address();
        srv.close(() => (typeof addr === 'object' && addr ? resolve(addr.port) : reject(new Error('No free port'))));
      });
    });
  }

  running(): boolean {
    return Boolean(this.child && this.child.exitCode === null);
  }

  async ensure(): Promise<void> {
    if (this.running()) return;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      const s = settings.get();
      this.port = await this.freePort();
      const t = s.torrents;
      const args = [
        '--enable-rpc', `--rpc-listen-port=${this.port}`, '--rpc-listen-all=false', `--rpc-secret=${this.secret}`,
        `--stop-with-process=${process.pid}`, '--continue=true', '--auto-file-renaming=true', '--allow-overwrite=false',
        // falloc needs a privilege on Windows; plain writes are fine on NTFS.
        // Disk cache (a write-smoothing RAM buffer, not a rate limit) sized to this machine's RAM so it suits
        // everyone from a slow laptop to a many-Gbps workstation. See core/tuning.
        `--file-allocation=${process.platform === 'win32' ? 'none' : 'falloc'}`, '--summary-interval=0', '--console-log-level=warn', `--disk-cache=${diskCacheMb(os.totalmem())}M`,
        `--max-connection-per-server=${s.network.connectionsPerServer}`, `--split=${s.network.connectionsPerServer}`, '--min-split-size=1M',
        '--retry-wait=3', `--max-tries=${Math.max(5, s.downloads.retries * 2)}`, '--connect-timeout=20', '--timeout=60',
        // Saving the metadata copy is pointless unless it is also read back: without this a magnet link
        // that is resumed (after a pause or a restart) fetches its metadata from the swarm all over again.
        '--follow-torrent=true', '--bt-save-metadata=true', '--bt-load-saved-metadata=true',
        // We upload each .torrent to aria2 over RPC, and by default aria2 then saves a copy named after the
        // SHA-1 of the file (NOT the info hash) into the download folder and keeps it open while seeding.
        // Lumina already has the file, so that copy is only litter.
        '--rpc-save-upload-metadata=false', `--listen-port=${t.listenPort}`, `--dht-listen-port=${t.listenPort}`,
        `--enable-dht=${t.dht}`, `--enable-dht6=${t.dht}`, '--bt-enable-lpd=true', '--enable-peer-exchange=true',
        `--bt-tracker=${(await trackers()).join(',')}`, '--bt-remove-unselected-file=true',
        `--seed-ratio=${t.seedRatio}`, `--seed-time=${t.seedMinutes}`,
        ...(t.requireEncryption ? ['--bt-require-crypto=true', '--bt-min-crypto-level=arc4'] : []),
        ...(s.network.proxy ? [`--all-proxy=${s.network.proxy}`] : []),
        ...(s.network.forceIpv4 ? ['--disable-ipv6=true'] : []),
        ...(s.network.userAgent ? [`--user-agent=${s.network.userAgent}`] : []),
        ...Object.entries(dynamicOptions(s)).map(([k, v]) => `--${k}=${v}`),
      ];
      this.child = spawnTool(tools.require('aria2c'), args, { detached: false });
      this.child.stderr?.on('data', (c: Buffer) => log.debug(c.toString().trim()));
      this.child.on('exit', (code) => {
        log.info(`aria2 exited (${code})`);
        this.child = null;
      });
      for (let i = 0; i < 40; i++) {
        try {
          await this.call('aria2.getVersion');
          this.watchSchedule();
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 150));
        }
      }
      throw new Error('The download engine (aria2) did not start.');
    })().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  /** Re-apply limits every minute so scheduled speed limits switch on and off on time. */
  private watchSchedule() {
    if (this.limitTimer) return;
    this.limitTimer = setInterval(() => void this.applySettings(), 60_000);
  }

  async applySettings() {
    if (!this.running()) return;
    await this.call('aria2.changeGlobalOption', dynamicOptions(settings.get())).catch((err) => log.debug('changeGlobalOption failed', err));
  }

  async call<T = unknown>(method: string, ...params: unknown[]): Promise<T> {
    const res = await fetch(`http://127.0.0.1:${this.port}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: randomBytes(4).toString('hex'), method, params: [`token:${this.secret}`, ...params] }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json()) as { result?: T; error?: { message: string } };
    if (body.error) throw new Error(body.error.message);
    return body.result as T;
  }

  /** Bring the daemon back after it has died or stopped answering its RPC. Concurrent callers share one restart. */
  async restart(): Promise<void> {
    if (this.starting) return this.starting;
    if (this.running()) this.stop();
    await this.ensure();
  }

  stop() {
    if (this.limitTimer) clearInterval(this.limitTimer);
    this.limitTimer = null;
    killTree(this.child);
    this.child = null;
  }
}

export const aria2 = new Aria2Daemon();

const FIELDS = ['gid', 'status', 'totalLength', 'completedLength', 'downloadSpeed', 'uploadSpeed', 'uploadLength', 'connections', 'numSeeders', 'seeder', 'errorMessage', 'files', 'bittorrent', 'followedBy', 'infoHash'];

/**
 * Live per-job torrent state for the detail page: the gid to talk to aria2 about, the files, and a
 * rolling speed history. Kept here (not in the Job record) because it is transient and high-churn —
 * persisting 90 samples per job on every tick would be pointless write traffic.
 */
interface LiveTorrent {
  gid: string | null;
  files: TorrentFile[];
  history: SpeedSample[];
  seeds: number;
  peers: number;
  downloadSpeed: number;
  uploadSpeed: number;
  uploadedBytes: number;
  downloadedBytes: number;
}

const live = new Map<string, LiveTorrent>();

const blankLive = (): LiveTorrent => ({
  gid: null, files: [], history: [], seeds: 0, peers: 0,
  downloadSpeed: 0, uploadSpeed: 0, uploadedBytes: 0, downloadedBytes: 0,
});

/** What the Queue's torrent detail panel reads. Returns null for a job with no live torrent. */
export function torrentDetail(jobId: string): TorrentDetail | null {
  const t = live.get(jobId);
  if (!t) return null;
  return {
    jobId,
    files: t.files,
    seeds: t.seeds,
    peers: t.peers,
    downloadSpeed: t.downloadSpeed,
    uploadSpeed: t.uploadSpeed,
    uploadedBytes: t.uploadedBytes,
    downloadedBytes: t.downloadedBytes,
    ratio: shareRatio(t.uploadedBytes, t.downloadedBytes),
    history: t.history,
  };
}

/**
 * Choose which files inside a torrent to fetch. aria2 applies `select-file` to a running download,
 * so this takes effect immediately; an empty selection is refused rather than silently meaning
 * "everything", which is what aria2 would do with an empty string.
 */
export async function selectTorrentFiles(jobId: string, indices: number[]): Promise<boolean> {
  const t = live.get(jobId);
  if (!t?.gid) throw new Error('That torrent isn’t running right now.');
  const spec = toSelectFileSpec(indices);
  if (!spec) throw new Error('Pick at least one file to download.');
  await aria2.call('aria2.changeOption', t.gid, { 'select-file': spec });
  log.info(`Torrent file selection for ${jobId}: ${spec}`);
  t.files = t.files.map((f) => ({ ...f, selected: indices.includes(f.index) }));
  return true;
}

/**
 * Which run of a job is current. Cancelling removes the download from aria2 and only then deletes its
 * files, which measured ~5 s later for a torrent; a Retry in that window starts a new run on the same
 * paths, and the old run's late cleanup must not delete what the new one is writing.
 */
const generation = new Map<string, number>();

/** Metadata copies aria2 created for jobs in this session; only these are ever deleted. */
const ownedMeta = new Set<string>();

export const aria2Runner: Runner = (ctx) => {
  const job = ctx.job();
  const myRun = (generation.get(job.id) ?? 0) + 1;
  generation.set(job.id, myRun);
  const dir = job.options.targetDir || job.outputDir || settings.get().storage.otherDir;
  fs.mkdirSync(dir, { recursive: true });
  let gid: string | null = null;
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  const isTorrent = job.source.sourceKind === 'torrent';

  // aria2 drops "<infohash>.torrent" into the download folder (we ask for it so a magnet link can resume
  // without fetching its metadata again). Once the job is done or cancelled it is just litter, but a file
  // that was already there before this job started is the person's and is never touched.
  const metaCopies = (): string[] => {
    try { return fs.readdirSync(dir).filter((n) => /^[0-9a-f]{40}\.torrent$/i.test(n)); } catch { return []; }
  };
  const metaBefore = new Set(metaCopies().map((n) => n.toLowerCase()));
  const metaName = (infoHash?: string) => (infoHash ? `${infoHash.toLowerCase()}.torrent` : null);
  /** Remember a copy that appeared during this job, so a Retry (which sees it as "already there") still owns it. */
  let infoHashSeen: string | undefined;
  const noteMeta = (infoHash?: string) => {
    if (infoHash) infoHashSeen = infoHash;
    const name = metaName(infoHash);
    if (name && !metaBefore.has(name)) ownedMeta.add(path.join(dir, name));
  };
  /** The copy to delete, or null when there is none or it was not made by us. */
  const metaToRemove = (infoHash?: string): string | null => {
    const name = metaName(infoHash);
    if (!name) return null;
    const full = path.join(dir, name);
    return metaBefore.has(name) && !ownedMeta.has(full) ? null : full;
  };
  /** Best effort and in the background: aria2 keeps the copy open while it seeds, so this can fail for a while. */
  const removeMetaCopy = (infoHash?: string) => {
    const full = metaToRemove(infoHash);
    if (full) void removeWhenFree(full).then(() => ownedMeta.delete(full));
  };

  const verifyAbort = new AbortController();
  const finish = async (status: Aria2Status) => {
    if (isTorrent) removeMetaCopy(status.infoHash);
    const files = (status.files ?? []).map((f) => f.path).filter((p) => p && !p.startsWith('[METADATA]'));
    log.info(`aria2 download finished: ${job.title}`, { files: files.length, totalBytes: Number(status.totalLength) || null });
    const top = files.length > 1 ? commonRoot(files, dir) : files[0];
    ctx.patch({ outputPaths: files, outputDir: top && files.length > 1 ? top : dir });
    // Torrents are already verified piece by piece; plain downloads get checked before they count as done.
    if (!isTorrent && files.length === 1) {
      const file = files[0]!;
      const expected = Number(status.totalLength) || ctx.job().source.direct?.sizeBytes || null;
      ctx.progress({ stage: 'Verifying', speedBps: null, etaSec: null }, 'processing');
      try {
        const result = await verifyDownload(file, expected, (pct) => ctx.progress({ stage: `Verifying checksum · ${Math.floor(pct)}%` }), verifyAbort.signal);
        if (stopped) return;
        if (!result.ok) {
          // Remove the bad copy so Retry downloads it again instead of resuming into it.
          fs.rmSync(file, { force: true });
          fs.rmSync(`${file}.aria2`, { force: true });
          ctx.fail(result.reason);
          return;
        }
        if (result.method === 'checksum') log.info(`Checksum verified: ${path.basename(file)}`);
      } catch (err) {
        if (stopped) return;
        log.warn('Verification could not run', err);
      }
    }
    ctx.complete();
  };

  let addSpec: { url: string; torrentPath: string | null; opts: Record<string, string | string[]> } | null = null;
  let silentSince = 0;
  let recoveries = 0;
  let cacheRetried = false;
  let stall: StallState = initialStall(Date.now());
  let spaceBlocked = false;

  /**
   * Keep large output files sparse. On Windows a write far past a file's end blocks the whole
   * engine while NTFS zero-fills the gap — 37 s measured for one piece 20 GB in — and the engine
   * serves RPC on the same thread, so it looks dead. A game torrent lands pieces all over a
   * 100 GB file; this was the "fine for minutes, then 0 B/s" report.
   */
  const guardSparse = (files: Aria2Status['files']) => {
    for (const f of files ?? []) {
      if (!f.path || f.path.startsWith('[METADATA]') || !needsSparse(process.platform, Number(f.length) || 0)) continue;
      if (fs.existsSync(f.path)) void markSparse(f.path);
    }
  };

  /** Keep the detail page's view of this torrent current from the status we already polled. */
  const recordLive = (status: Aria2Status, downloadedBytes: number) => {
    const t = live.get(job.id) ?? blankLive();
    const down = Number(status.downloadSpeed) || 0;
    const up = Number(status.uploadSpeed) || 0;
    t.gid = gid;
    t.files = toTorrentFiles((status.files ?? []).filter((f) => !f.path.startsWith('[METADATA]')));
    t.history = pushSample(t.history, { down, up });
    t.seeds = Number(status.numSeeders) || 0;
    t.peers = Number(status.connections) || 0;
    t.downloadSpeed = down;
    t.uploadSpeed = up;
    t.uploadedBytes = Number(status.uploadLength) || 0;
    t.downloadedBytes = downloadedBytes;
    live.set(job.id, t);
  };

  // (Re)issue the download to aria2. After a daemon restart the old gid is gone, so we add again;
  // aria2's --continue plus the .aria2 control file resume from the bytes already on disk.
  const addToAria = async (): Promise<void> => {
    if (!addSpec) return;
    gid = addSpec.torrentPath
      ? await aria2.call<string>('aria2.addTorrent', fs.readFileSync(addSpec.torrentPath).toString('base64'), [], addSpec.opts)
      : await aria2.call<string>('aria2.addUri', [addSpec.url], addSpec.opts);
  };

  const poll = async () => {
    if (stopped || !gid) return;
    try {
      let status = await aria2.call<Aria2Status & { seeder?: string }>('aria2.tellStatus', gid, FIELDS);
      // Healthy again: forget earlier transient failures.
      silentSince = 0;
      recoveries = 0;
      // Magnets first fetch metadata, then continue as a new download.
      if (status.status === 'complete' && status.followedBy?.[0]) {
        gid = status.followedBy[0];
        status = await aria2.call<Aria2Status & { seeder?: string }>('aria2.tellStatus', gid, FIELDS);
      }
      const p = aria2Progress(status);
      const name = status.bittorrent?.info?.name;
      if (name && name !== ctx.job().title) ctx.patch({ title: name });

      if (isTorrent) recordLive(status, p.downloadedBytes);
      guardSparse(status.files);
      if (isTorrent) noteMeta(status.infoHash);

      // A torrent's size is only known once its metadata is in, and the user may still pick fewer
      // files, so a torrent that does not fit waits (paused, with the reason) rather than failing.
      if (isTorrent && status.status !== 'complete') {
        const chosen = (status.files ?? []).filter((f) => f.selected === 'true' && !f.path.startsWith('[METADATA]'));
        const selected = chosen.reduce((n, f) => n + (Number(f.length) || 0), 0);
        // What is already on disk, not what has been received: see core/diskSpace allocatedBytes.
        const onDisk = chosen.reduce((n, f) => {
          let sizeOnDisk: number | null = null;
          try { sizeOnDisk = fs.statSync(f.path).size; } catch { /* not created yet */ }
          return n + allocatedBytes({ length: Number(f.length) || 0, completed: Number(f.completedLength) || 0, sizeOnDisk, sparse: isSparse(f.path) });
        }, 0);
        let missing: number | null = null;
        try {
          const st = fs.statfsSync(dir);
          missing = spaceShortfall(Number(st.bavail) * Number(st.bsize), selected, onDisk);
        } catch {
          // statfs unavailable: no check, as for direct downloads.
        }
        if (missing && !spaceBlocked) {
          spaceBlocked = true;
          log.warn('Torrent does not fit on the disk; pausing', { job: job.title, missingBytes: missing });
          await aria2.call('aria2.forcePause', gid).catch(() => undefined);
        } else if (!missing && spaceBlocked) {
          spaceBlocked = false;
          log.info('Space is available again; resuming', { job: job.title });
          await aria2.call('aria2.unpause', gid).catch(() => undefined);
        }
        if (spaceBlocked) {
          stall = initialStall(Date.now(), p.downloadedBytes);
          ctx.progress({ percent: p.percent, speedBps: null, etaSec: null, downloadedBytes: p.downloadedBytes, totalBytes: p.totalBytes, stage: `Not enough disk space: needs ${formatBytes(missing ?? 0)} more. Free some space or choose fewer files.` }, 'running');
          timer = setTimeout(poll, 3000);
          return;
        }
      }

      // A torrent is done for the user once all data is here, even while aria2 keeps seeding.
      const dataComplete = Boolean(p.totalBytes) && p.downloadedBytes >= p.totalBytes!;
      if (status.status === 'complete' || (isTorrent && dataComplete && status.seeder === 'true')) return finish(status);
      if (status.status === 'error' || status.status === 'removed') {
        // A disk-cache flush failure is usually the RAM write buffer being too big for the target
        // volume (a stick, a network share, a nearly-full disk). Turning the cache off and resuming
        // fixes it far more often than telling the user to free space — so try that once first.
        if (!cacheRetried && isDiskCacheFailure(status.errorMessage)) {
          cacheRetried = true;
          log.warn('Disk cache flush failed; retrying this download with the cache off');
          ctx.progress({ stage: 'Disk write problem — retrying without the write cache…', speedBps: null, etaSec: null }, 'running');
          try {
            await aria2.call('aria2.changeGlobalOption', { 'disk-cache': '0' });
            await addToAria();
            timer = setTimeout(poll, 1000);
            return;
          } catch (e) {
            log.warn('Could not retry with the cache off', e);
          }
        }
        // A partial with a `.aria2` control file resumes on Retry. One without (the server gave no
        // length or no ranges) never can: aria2 would start "name (1)" beside it, and the orphan keeps
        // eating the disk — measured on a full drive, where the retry then died of the very space the
        // first attempt's leftover held. So an unresumable partial is removed with the failure.
        if (!isTorrent) {
          for (const f of status.files ?? []) {
            if (!f.path || fs.existsSync(`${f.path}.aria2`)) continue;
            try { fs.rmSync(f.path, { force: true }); } catch (e) { log.debug('Could not remove unresumable partial', e); }
          }
        }
        ctx.fail(friendlyAria2Error(status.errorMessage));
        return;
      }
      // While a magnet link's metadata is fetched aria2 reports that tiny download as 100% (core/progress).
      const metadata = isTorrent && (!p.totalBytes || isMetadataPhase(status));
      const step = stallStep(stall, Date.now(), p.downloadedBytes, { waitingForMetadata: metadata });
      stall = step.state;
      if (step.action !== 'none') {
        log.warn(`Download stalled; ${step.action}`, { job: job.title, stalledForS: Math.round((Date.now() - stall.progressAt) / 1000), peers: status.connections, seeds: status.numSeeders });
        ctx.progress({ stage: 'No data arriving, reconnecting…', speedBps: null, etaSec: null }, 'running');
        try {
          if (step.action === 'nudge') {
            // Pausing and resuming makes a torrent announce to its trackers again.
            await aria2.call('aria2.forcePause', gid);
            await aria2.call('aria2.unpause', gid);
          } else if (step.action === 'readd') {
            await aria2.call('aria2.forceRemove', gid);
            await addToAria();
          } else {
            await aria2.restart();
            await addToAria();
          }
        } catch (e) {
          log.warn(`Stall recovery (${step.action}) failed`, e);
        }
        timer = setTimeout(poll, 1000);
        return;
      }
      ctx.progress({
        percent: metadata ? 0 : p.percent, speedBps: p.speedBps, etaSec: p.etaSec,
        downloadedBytes: metadata ? null : p.downloadedBytes, totalBytes: metadata ? null : p.totalBytes,
        stage: metadata ? 'Finding peers' : isTorrent
          ? `${status.numSeeders ?? 0} seeds · ${status.connections ?? 0} peers`
          // Bytes are deliberately left out: the row already prints "7.6 MB of 29.3 MB" from the
          // progress itself, and putting them here too printed the same figure twice in one line.
          : `${status.connections ?? 0} connection${status.connections === '1' ? '' : 's'}`,
      }, 'running');
    } catch (err) {
      if (stopped) return;
      if (!silentSince) silentSince = Date.now();
      const silentForMs = Date.now() - silentSince;
      log.warn('Status poll failed', { silentForS: Math.round(silentForMs / 1000), engineAlive: aria2.running(), err: String(err) });
      // A live engine that stops answering is usually mid-way through a slow disk write, not dead
      // (see core/engineWatch); restarting it throws that work away. Only a dead or long-silent one is restarted.
      if (rpcAction(silentForMs, aria2.running()) === 'wait') {
        ctx.progress({ stage: 'Writing to disk, please wait…', speedBps: null, etaSec: null }, 'running');
      } else {
        if (recoveries >= 5) {
          ctx.fail('The download engine kept stopping. Your progress is saved on disk — press Retry to resume.');
          return;
        }
        recoveries++;
        silentSince = 0;
        ctx.progress({ stage: 'Reconnecting to the download engine…', speedBps: null, etaSec: null }, 'running');
        try {
          await aria2.restart();
          await addToAria();
        } catch (e) {
          log.warn('aria2 recovery failed', e);
        }
      }
    }
    // Poll quickly at first: a browser may be paused waiting to hear that data is flowing.
    timer = setTimeout(poll, ++polls < 12 ? 200 : 1000);
  };
  let polls = 0;

  (async () => {
    await aria2.ensure();
    const opts: Record<string, string | string[]> = { dir };
    if (job.source.direct?.filename) {
      const name = job.source.direct.filename.replace(/[\\/:*?"<>|]/g, '_');
      // Starting fresh (not resuming): pick "name (1).ext" like browsers do instead of overwriting.
      opts.out = fs.existsSync(path.join(dir, `${name}.aria2`)) ? name : uniqueName(dir, name);
    }

    // File-host links open a download page: click through it now (links it hands out expire, so never cache them).
    let url = job.url;
    let req = job.source.request;
    if (job.source.direct?.hosted) {
      ctx.progress({ stage: 'Opening download page', speedBps: null, etaSec: null }, 'running');
      const resolved = await resolveHostedLink(job.url, {
        signal: verifyAbort.signal,
        label: job.source.direct.filename,
        onStage: (stage) => {
          if (!stopped) ctx.progress({ stage });
        },
      });
      if (stopped) return;
      url = resolved.url;
      req = resolved.request;
      if (!job.source.direct.filename && resolved.filename) opts.out = uniqueName(dir, resolved.filename.replace(/[\\/:*?"<>|]/g, '_'));
    }

    // Same request the browser made: headers, referer and cookies from the extension or the download page.
    if (req) {
      const headers = Object.entries(req.headers)
        .filter(([k, v]) => /^[A-Za-z0-9-]{1,64}$/.test(k) && !/[\r\n]/.test(v) && !['cookie', 'range', 'host', 'user-agent'].includes(k.toLowerCase()))
        .map(([k, v]) => `${k}: ${v}`);
      if (headers.length) opts.header = headers;
      const ua = Object.entries(req.headers).find(([k]) => k.toLowerCase() === 'user-agent')?.[1];
      if (ua && !/[\r\n]/.test(ua)) opts['user-agent'] = ua;
      if (req.pageUrl && !headers.some((h) => h.toLowerCase().startsWith('referer:'))) opts.referer = req.pageUrl;
      // aria2 only reads cookie files at startup, so send the matching cookies as a header for this file.
      const cookie = cookieHeaderFor(url, req.cookies);
      if (cookie) opts.header = [...(Array.isArray(opts.header) ? opts.header : []), `Cookie: ${cookie}`];
    }

    // Before appending to a partial file, make sure the server's file is still the one it began with.
    // Measured without this: the file changed during an outage and the resume joined two versions of
    // it into one "Done" download (see core/resumeCheck). Skipped through a proxy, because a plain
    // fetch here would go around it, and for file-host links, whose one-time download URLs a probe
    // request could use up before the real download starts (they are resolved fresh each run anyway).
    if (!isTorrent && !settings.get().network.proxy && !job.source.direct?.hosted) {
      const sent: Record<string, string> = {};
      for (const h of Array.isArray(opts.header) ? opts.header : []) {
        const i = h.indexOf(':');
        if (i > 0) sent[h.slice(0, i).trim()] = h.slice(i + 1).trim();
      }
      if (typeof opts['user-agent'] === 'string') sent['User-Agent'] = opts['user-agent'];
      if (typeof opts.referer === 'string') sent.Referer = opts.referer;
      const check = await fetchValidators(url, sent, verifyAbort.signal);
      if (stopped) return;
      const saved = ctx.job().engineState.validators ?? null;
      const partial = typeof opts.out === 'string' ? path.join(dir, opts.out) : null;
      const resuming = Boolean(partial && fs.existsSync(`${partial}.aria2`));
      if (check.ok) {
        const verdict = compareValidators(saved, check.validators);
        if (resuming && verdict === 'changed' && partial) {
          log.warn('The file changed on the server since this download began; starting over', { job: job.title, saved, now: check.validators });
          fs.rmSync(partial, { force: true });
          fs.rmSync(`${partial}.aria2`, { force: true });
          ctx.progress({ stage: 'The file changed on the server — starting over', percent: 0, downloadedBytes: null, totalBytes: null }, 'running');
        }
        // Keep the original validators while they still cannot be told apart from the current ones.
        ctx.patch({ engineState: { ...ctx.job().engineState, validators: verdict === 'unknown' && saved ? saved : check.validators } });
      } else if (check.reason === 'network' && resuming) {
        // Appending without being able to check is how the corruption happened, so wait: the automatic
        // retry runs this check again before any data is written.
        ctx.fail('Network problem: could not reach the server to check the file before resuming. Lumina will try again.');
        return;
      }
    }

    // Fail fast on a full disk instead of stalling partway through a large download.
    const expectedBytes = job.source.direct?.sizeBytes ?? null;
    if (expectedBytes && !isTorrent) {
      try {
        const st = fs.statfsSync(dir);
        const free = st.bavail * st.bsize;
        if (free < expectedBytes * 1.02) {
          ctx.fail(`Not enough free space for this download (needs ~${formatBytes(expectedBytes)}, ${formatBytes(free)} free). Free up space or choose another folder in Settings.`);
          return;
        }
      } catch {
        // statfs isn't available on this platform/build — skip the check.
      }
    }

    addSpec = {
      url,
      torrentPath: url.toLowerCase().endsWith('.torrent') && fs.existsSync(url) ? url : null,
      opts,
    };
    await addToAria();
    // Structured start line so a stuck/slow aria2 download is diagnosable from the log alone.
    log.info(`aria2 download started: ${job.title}`, {
      kind: isTorrent ? 'torrent' : 'direct',
      connectionsPerServer: settings.get().network.connectionsPerServer,
      diskCacheMb: diskCacheMb(os.totalmem()),
      dir,
      expectedBytes,
      hostedPage: Boolean(job.source.direct?.hosted),
    });
    // A direct download writes at 16 far-apart offsets within milliseconds of starting, so the file
    // has to be flagged as soon as it exists rather than on the next 1 s poll. (A torrent's first
    // far-off piece takes seconds to arrive, so its regular poll is soon enough.)
    if (!isTorrent && gid) {
      const watching = gid;
      void (async () => {
        for (let i = 0; i < 400 && !stopped; i++) {
          try {
            const st = await aria2.call<Aria2Status>('aria2.tellStatus', watching, ['files']);
            guardSparse(st.files);
            if (st.files?.some((f) => f.path && fs.existsSync(f.path))) return;
          } catch {
            return;
          }
          await new Promise((r) => setTimeout(r, 10));
        }
      })();
    }
    void poll();
  })().catch((err) => ctx.fail(err instanceof Error ? err.message : String(err)));

  return {
    stop: (reason) => {
      stopped = true;
      verifyAbort.abort();
      if (timer) clearTimeout(timer);
      if (!gid) return;
      const id = gid;
      // Removing keeps the partial file and its .aria2 control file, so starting again resumes.
      // Returned so the queue can show "Cancelling…" until the files are really gone.
      return (async () => {
        // A magnet link is TWO downloads: when the metadata is in, aria2 starts the real one by itself, and
        // until our next poll notices it is not the gid we hold. Removing only ours left the real download
        // running unseen — measured: 259 MB still being written after "Cancelled", and the Retry refused
        // with "InfoHash is already registered". So remove everything this one led to as well.
        const targets = [id];
        try {
          const st = await aria2.call<Aria2Status>('aria2.tellStatus', id, ['followedBy']);
          targets.push(...(st.followedBy ?? []));
        } catch {
          // already gone
        }
        for (const t of targets) await aria2.call('aria2.forceRemove', t).catch(() => undefined);
        if (reason !== 'cancel') return;
        try {
          if (generation.get(job.id) !== myRun) return;
          // Deleting a file aria2 still holds open fails on Windows, so retry until it lets go.
          for (const t of targets) {
            const st = await aria2.call<Aria2Status>('aria2.tellStatus', t, ['files']).catch(() => null);
            for (const f of st?.files ?? []) {
              if (!f.path || f.path.startsWith('[METADATA]')) continue;
              await removeWhenFree(f.path);
              await removeWhenFree(`${f.path}.aria2`);
            }
          }
          const meta = isTorrent ? metaToRemove(infoHashSeen) : null;
          if (meta) {
            await removeWhenFree(meta);
            ownedMeta.delete(meta);
          }
        } catch {
          // status may already be gone
        }
      })();
    },
  };
};

/** Delete a file that may still be held open by a process that is shutting down; gives up after ~20 s. */
async function removeWhenFree(file: string, tries = 40): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      fs.rmSync(file, { force: true });
      if (!fs.existsSync(file)) return;
    } catch {
      // still open; try again shortly
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

function uniqueName(dir: string, name: string): string {
  if (!fs.existsSync(path.join(dir, name))) return name;
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 1; i < 10_000; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!fs.existsSync(path.join(dir, candidate)) && !fs.existsSync(path.join(dir, `${candidate}.aria2`))) return candidate;
  }
  return name;
}

function commonRoot(files: string[], base: string): string {
  const rel = files.map((f) => path.relative(base, f).split(path.sep));
  const first = rel[0]?.[0];
  return first && rel.every((r) => r.length > 1 && r[0] === first) ? path.join(base, first) : base;
}
