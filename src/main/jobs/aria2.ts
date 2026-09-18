import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { aria2Progress, friendlyAria2Error, type Aria2Status } from '../../core/progress';
import { diskCacheMb } from '../../core/tuning';
import { formatBytes } from '../../core/format';
import { speedLimitActive, type Settings } from '../../shared/settings';
import { killTree, spawnTool } from '../process';
import { tools } from '../tools';
import { settings } from '../settings';
import { dataDir } from '../paths';
import { cookieHeaderFor } from '../../core/cookies';
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
        '--follow-torrent=true', '--bt-save-metadata=true', `--listen-port=${t.listenPort}`, `--dht-listen-port=${t.listenPort}`,
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

const FIELDS = ['gid', 'status', 'totalLength', 'completedLength', 'downloadSpeed', 'uploadSpeed', 'connections', 'numSeeders', 'seeder', 'errorMessage', 'files', 'bittorrent', 'followedBy'];

export const aria2Runner: Runner = (ctx) => {
  const job = ctx.job();
  const dir = job.options.targetDir || job.outputDir || settings.get().storage.otherDir;
  fs.mkdirSync(dir, { recursive: true });
  let gid: string | null = null;
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  const isTorrent = job.source.sourceKind === 'torrent';

  const verifyAbort = new AbortController();
  const finish = async (status: Aria2Status) => {
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
  let pollFails = 0;
  let recoveries = 0;

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
      pollFails = 0;
      recoveries = 0;
      // Magnets first fetch metadata, then continue as a new download.
      if (status.status === 'complete' && status.followedBy?.[0]) {
        gid = status.followedBy[0];
        status = await aria2.call<Aria2Status & { seeder?: string }>('aria2.tellStatus', gid, FIELDS);
      }
      const p = aria2Progress(status);
      const name = status.bittorrent?.info?.name;
      if (name && name !== ctx.job().title) ctx.patch({ title: name });

      // A torrent is done for the user once all data is here, even while aria2 keeps seeding.
      const dataComplete = Boolean(p.totalBytes) && p.downloadedBytes >= p.totalBytes!;
      if (status.status === 'complete' || (isTorrent && dataComplete && status.seeder === 'true')) return finish(status);
      if (status.status === 'error' || status.status === 'removed') {
        ctx.fail(friendlyAria2Error(status.errorMessage));
        return;
      }
      const metadata = isTorrent && !p.totalBytes;
      ctx.progress({
        percent: p.percent, speedBps: p.speedBps, etaSec: p.etaSec, downloadedBytes: p.downloadedBytes, totalBytes: p.totalBytes,
        stage: metadata ? 'Finding peers' : isTorrent
          ? `${status.numSeeders ?? 0} seeds · ${status.connections ?? 0} peers`
          : `${status.connections ?? 0} connection${status.connections === '1' ? '' : 's'} · ${formatBytes(p.downloadedBytes)} of ${formatBytes(p.totalBytes)}`,
      }, 'running');
    } catch (err) {
      if (stopped) return;
      pollFails++;
      log.warn('Status poll failed', err);
      // The engine has died or its RPC has hung. Restart it and resume, rather than polling a corpse forever.
      if (pollFails >= 3) {
        if (recoveries >= 5) {
          ctx.fail('The download engine kept stopping. Your progress is saved on disk — press Retry to resume.');
          return;
        }
        recoveries++;
        pollFails = 0;
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
      aria2.call('aria2.forceRemove', id).catch(() => undefined).finally(async () => {
        if (reason !== 'cancel') return;
        try {
          const st = await aria2.call<Aria2Status>('aria2.tellStatus', id, ['files']);
          for (const f of st.files ?? []) {
            if (!f.path) continue;
            fs.rmSync(f.path, { force: true });
            fs.rmSync(`${f.path}.aria2`, { force: true });
          }
        } catch {
          // status may already be gone
        }
      });
    },
  };
};

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
