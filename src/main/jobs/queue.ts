import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import type { DownloadOptions, Job, JobProgress, JobStatus, MediaInfo } from '../../shared/types';
import { database } from '../db';
import { settings } from '../settings';
import { tempDir } from '../paths';
import { logger } from '../log';
import { classifyFailure, nextProbeDelayMs, retryLabel, waitedTooLong } from '../../core/networkRetry';
import { plainFailure } from '../../core/progress';
import { finishedSummary } from '../../core/jobDisplay';
import { fetchValidators } from '../resumeProbe';

const log = logger('queue');

export interface RunnerContext {
  job: () => Job;
  progress: (p: Partial<JobProgress>, status?: 'running' | 'processing') => void;
  patch: (p: Partial<Pick<Job, 'outputPaths' | 'outputDir' | 'compat' | 'engineState' | 'title'>>) => void;
  complete: () => void;
  fail: (message: string, detail?: string) => void;
  /** Per-job scratch folder, removed after completion or cancel. */
  workDir: string;
}

export interface RunnerHandle {
  /** Stop work. Paused jobs must be resumable by starting again. */
  stop: (reason: 'pause' | 'cancel') => void | Promise<void>;
}

export type Runner = (ctx: RunnerContext) => RunnerHandle;

const ACTIVE: JobStatus[] = ['running', 'processing'];

/** Bytes the finished files occupy: a file's size, a folder's contents (bounded, so a huge torrent cannot stall the queue). */
function sizeOnDisk(paths: string[]): number {
  let total = 0;
  let seen = 0;
  const walk = (p: string) => {
    if (seen++ > 5000) return;
    try {
      const st = fs.statSync(p);
      if (st.isDirectory()) for (const name of fs.readdirSync(p)) walk(path.join(p, name));
      else total += st.size;
    } catch {
      // a file that is gone or unreadable is simply not counted
    }
  };
  for (const p of paths) walk(p);
  return total;
}
const BROWSER_POOL = 16;
const FINISHED: JobStatus[] = ['completed', 'failed', 'cancelled'];

const emptyProgress = (stage: string): JobProgress => ({
  percent: 0, filePercent: null, speedBps: null, etaSec: null, downloadedBytes: null, totalBytes: null, stage,
});

class JobQueue extends EventEmitter<{ updated: [Job]; removed: [string]; completed: [Job]; failed: [Job] }> {
  private jobs = new Map<string, Job>();
  private handles = new Map<string, RunnerHandle>();
  private runners = new Map<Job['engine'], Runner>();
  private lastEmit = new Map<string, number>();
  private lastPersist = new Map<string, number>();

  register(engine: Job['engine'], runner: Runner) {
    this.runners.set(engine, runner);
  }

  load() {
    const rows = database().prepare('SELECT data FROM jobs ORDER BY created_at ASC').all() as { data: string }[];
    const s = settings.get();
    const resume = s.general.resumeQueue;
    const cutoff = s.privacy.historyDays > 0 ? Date.now() - s.privacy.historyDays * 86_400_000 : 0;
    for (const row of rows) {
      try {
        const job = JSON.parse(row.data) as Job;
        job.engineState ??= { finishedItems: 0 };
        if (FINISHED.includes(job.status) && (!s.privacy.keepHistory || job.updatedAt < cutoff)) {
          database().prepare('DELETE FROM jobs WHERE id = ?').run(job.id);
          continue;
        }
        if (ACTIVE.includes(job.status)) {
          job.status = resume ? 'queued' : 'paused';
          job.progress = { ...job.progress, speedBps: null, etaSec: null, stage: resume ? 'Waiting to resume' : 'Paused when Lumina closed' };
        }
        this.jobs.set(job.id, job);
      } catch (err) {
        log.warn('Skipping unreadable job row', err);
      }
    }
  }

  list(): Job[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  add(
    input: { url: string; title: string; thumbnail: string | null; uploader: string; engine: Job['engine']; options: DownloadOptions; source: Job['source']; outputDir: string | null },
    opts: { startNow?: boolean; origin?: Job['origin'] } = {},
  ): Job {
    const now = Date.now();
    const job: Job = {
      id: randomUUID(), createdAt: now, updatedAt: now, engine: input.engine, url: input.url, title: input.title,
      thumbnail: input.thumbnail, uploader: input.uploader, options: input.options, status: 'queued',
      progress: emptyProgress('Waiting'), outputPaths: [], outputDir: input.outputDir, error: null, compat: null,
      engineState: { finishedItems: 0 }, source: input.source, origin: opts.origin ?? 'app',
    };
    this.jobs.set(job.id, job);
    this.save(job, true);
    // Browser hand-offs must start immediately: the browser is paused, waiting for an answer.
    if (opts.startNow) this.start(job);
    else this.schedule();
    return job;
  }

  /** Patch a job from outside its runner (e.g. files moved after a release was assembled). */
  update(id: string, patch: Partial<Pick<Job, 'outputPaths' | 'outputDir' | 'title'>>) {
    const job = this.jobs.get(id);
    if (job) this.set(job, patch);
  }

  addFromInfo(url: string, info: MediaInfo, options: DownloadOptions, outputDir: string, opts: { startNow?: boolean; origin?: Job['origin'] } = {}): Job {
    const engine: Job['engine'] = info.sourceKind === 'direct' || info.sourceKind === 'torrent' ? 'aria2' : 'ytdlp';
    return this.add({
      url, title: info.title, thumbnail: info.thumbnail, uploader: info.uploader, engine, options, outputDir,
      source: { sourceKind: info.sourceKind, site: info.site, entries: info.entries, direct: info.direct, torrent: info.torrent, request: info.request, stream: info.stream },
    }, opts);
  }

  private workDirFor(id: string) {
    const custom = settings.get().storage.tempDir;
    return path.join(custom && fs.existsSync(custom) ? custom : tempDir(), id);
  }

  private retryTimers = new Map<string, NodeJS.Timeout>();

  /** Network hiccups and throttling usually clear up; retry those a few times with growing delays. */
  private maybeAutoRetry(job: Job) {
    if (!settings.get().downloads.autoRetryFailed || job.engine === 'convert' || job.engine === 'subtitles' || job.engine === 'extract') return;
    const attempts = job.engineState.autoRetries ?? 0;
    const kind = classifyFailure(job.error?.message, job.error?.detail);
    // A lost connection is not a "try three times" problem: wait for it, however long, and go the
    // moment it is back (core/networkRetry has the measurement behind this).
    if (kind === 'network') return this.waitForNetwork(job);
    if (kind !== 'transient' || attempts >= 3) return;
    const delay = [30, 120, 600][attempts]! * 1000;
    this.set(job, { engineState: { ...job.engineState, autoRetries: attempts + 1 }, progress: { ...job.progress, stage: `Retrying in ${retryLabel(delay)}` } });
    this.retryTimers.set(job.id, setTimeout(() => {
      this.retryTimers.delete(job.id);
      const current = this.jobs.get(job.id);
      if (current?.status === 'failed') this.set(current, { status: 'queued', error: null, progress: { ...current.progress, stage: 'Retrying' } });
      this.schedule();
    }, delay));
  }

  private netWaiters = new Map<string, { since: number; attempt: number; timer: NodeJS.Timeout | null }>();

  /** True while a failed job is going to be started again by itself, so a failure notice would mislead. */
  willRetry(id: string): boolean {
    return this.retryTimers.has(id) || this.netWaiters.has(id);
  }

  private clearNetWait(id: string) {
    const w = this.netWaiters.get(id);
    if (w?.timer) clearTimeout(w.timer);
    this.netWaiters.delete(id);
  }

  private waitForNetwork(job: Job) {
    const w = this.netWaiters.get(job.id) ?? { since: Date.now(), attempt: 0, timer: null };
    if (waitedTooLong(w.since, Date.now())) {
      this.netWaiters.delete(job.id);
      this.set(job, { error: { message: 'Gave up waiting for the network after 6 hours. Press Retry to resume.', detail: job.error?.detail } });
      return;
    }
    const delay = nextProbeDelayMs(w.attempt++);
    // Failed rows show their error text, so that is where the person is told what is happening.
    const first = !this.netWaiters.has(job.id);
    this.netWaiters.set(job.id, w);
    this.set(job, {
      error: { message: 'Connection lost. Lumina is waiting for the network and will resume by itself.', detail: first ? [job.error?.message, job.error?.detail].filter(Boolean).join('\n') : job.error?.detail },
      progress: { ...job.progress, speedBps: null, etaSec: null, stage: 'Waiting for the network', activity: 'waiting', connections: null },
    });
    w.timer = setTimeout(() => void this.probeNetwork(job.id), delay);
  }

  /** Is the server reachable again? Any HTTP answer counts, even a refusal: it means the network works. */
  private async probeNetwork(id: string) {
    const w = this.netWaiters.get(id);
    const job = this.jobs.get(id);
    if (!w || !job || job.status !== 'failed') {
      this.clearNetWait(id);
      return;
    }
    let back = true;
    // Magnet links and local .torrent files have nothing to ask; through a proxy a plain fetch would go around it.
    if (/^https?:/i.test(job.url) && !settings.get().network.proxy) {
      const r = await fetchValidators(job.url, {});
      back = r.ok || r.reason === 'status';
    }
    const now = this.jobs.get(id);
    if (!now || now.status !== 'failed' || this.netWaiters.get(id) !== w) return; // cancelled or retried meanwhile
    if (!back) return this.waitForNetwork(now);
    log.info(`Network is back; resuming ${now.title}`, { waitedS: Math.round((Date.now() - w.since) / 1000) });
    this.clearNetWait(id);
    this.set(now, { status: 'queued', error: null, progress: { ...now.progress, stage: 'Reconnected, resuming' } });
    this.schedule();
  }

  /** The computer woke from sleep, or the network changed: ask now rather than waiting out the timer. */
  networkMayBeBack() {
    for (const [id, w] of this.netWaiters) {
      if (w.timer) clearTimeout(w.timer);
      void this.probeNetwork(id);
    }
  }

  pause(id: string) {
    const job = this.jobs.get(id);
    if (!job) return;
    if (ACTIVE.includes(job.status)) this.handles.get(id)?.stop('pause');
    if (job.status === 'queued' || ACTIVE.includes(job.status)) {
      this.handles.delete(id);
      this.set(job, { status: 'paused', progress: { ...job.progress, speedBps: null, etaSec: null, stage: 'Paused' } });
      this.schedule();
    }
  }

  resume(id: string) {
    const job = this.jobs.get(id);
    if (!job || job.status !== 'paused') return;
    this.set(job, { status: 'queued', progress: { ...job.progress, stage: 'Waiting' } });
    this.schedule();
  }

  cancel(id: string) {
    const job = this.jobs.get(id);
    if (!job || FINISHED.includes(job.status) || this.cancelling.has(id)) return;
    const stopping = this.handles.get(id)?.stop('cancel');
    this.handles.delete(id);
    this.clearNetWait(id);
    this.cleanupWorkDir(job);
    const finish = () => {
      this.cancelling.delete(id);
      const current = this.jobs.get(id);
      if (current && !FINISHED.includes(current.status)) {
        this.set(current, { status: 'cancelled', progress: { ...current.progress, speedBps: null, etaSec: null, stage: 'Cancelled' } });
      }
      this.schedule();
    };
    if (!stopping) return finish();
    // Removing a torrent's files has to wait for aria2 to let go of them — measured ~5 s. Saying
    // "Cancelled" at once let a Retry start a second run on the same paths while the first run's
    // cleanup was still pending. So the job stays as it is, labelled "Cancelling…", until it is done.
    this.cancelling.add(id);
    this.set(job, { progress: { ...job.progress, speedBps: null, etaSec: null, stage: 'Cancelling…' } });
    const giveUp = new Promise<void>((resolve) => setTimeout(resolve, 20_000));
    void Promise.race([stopping.catch(() => undefined), giveUp]).then(finish);
  }

  private cancelling = new Set<string>();

  retry(id: string) {
    const job = this.jobs.get(id);
    if (!job || !['failed', 'cancelled'].includes(job.status)) return;
    clearTimeout(this.retryTimers.get(id));
    this.retryTimers.delete(id);
    this.clearNetWait(id);
    this.set(job, { status: 'queued', error: null, progress: emptyProgress('Waiting'), engineState: { ...job.engineState, autoRetries: 0 } });
    this.schedule();
  }

  remove(id: string) {
    const job = this.jobs.get(id);
    if (!job) return;
    if (!FINISHED.includes(job.status) && job.status !== 'paused') this.cancel(id);
    clearTimeout(this.retryTimers.get(id));
    this.retryTimers.delete(id);
    this.clearNetWait(id);
    this.jobs.delete(id);
    database().prepare('DELETE FROM jobs WHERE id = ?').run(id);
    this.emit('removed', id);
  }

  clearFinished() {
    for (const job of [...this.jobs.values()]) {
      if (FINISHED.includes(job.status)) this.remove(job.id);
    }
  }

  /**
   * Stop every active job without changing its saved status, so it resumes next launch. Resolves when the runners have
   * finished stopping (or after [timeoutMs]): their last act is asking the download engine to let go of the file, and the
   * engine must not be killed before that is done, or it never writes the control file a download needs to continue.
   */
  async shutdown(timeoutMs = 4000): Promise<void> {
    const stopping: Promise<unknown>[] = [];
    for (const [id, handle] of this.handles) {
      const done = handle.stop('pause');
      if (done) stopping.push(Promise.resolve(done).catch(() => undefined));
      const job = this.jobs.get(id);
      if (job) this.save(job, true);
    }
    this.handles.clear();
    for (const id of [...this.netWaiters.keys()]) this.clearNetWait(id);
    if (stopping.length) await Promise.race([Promise.all(stopping), new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
  }

  activeCount(): number {
    return [...this.jobs.values()].filter((j) => ACTIVE.includes(j.status)).length;
  }

  schedule() {
    const limit = settings.get().downloads.concurrency;
    const all = [...this.jobs.values()];
    // Browser hand-offs (often many small files) have their own pool so they never stall the main queue.
    let running = all.filter((j) => ACTIVE.includes(j.status) && j.origin !== 'browser' && j.engine !== 'subtitles' && j.engine !== 'convert' && j.engine !== 'extract').length;
    let browserRunning = all.filter((j) => ACTIVE.includes(j.status) && j.origin === 'browser').length;
    const queued = [...this.jobs.values()].filter((j) => j.status === 'queued').sort((a, b) => a.createdAt - b.createdAt);
    for (const job of queued) {
      // Conversions and subtitle generation are CPU work; run one at a time alongside downloads.
      const isCpu = job.engine === 'convert' || job.engine === 'subtitles';
      if (isCpu) {
        const busy = [...this.jobs.values()].some((j) => j !== job && ACTIVE.includes(j.status) && (j.engine === 'convert' || j.engine === 'subtitles'));
        if (!busy) this.start(job);
        continue;
      }
      // Unpacking is disk-bound: one archive at a time, alongside downloads.
      if (job.engine === 'extract') {
        const busy = [...this.jobs.values()].some((j) => j !== job && ACTIVE.includes(j.status) && j.engine === 'extract');
        if (!busy) this.start(job);
        continue;
      }
      if (job.origin === 'browser') {
        if (browserRunning >= BROWSER_POOL) continue;
        browserRunning++;
        this.start(job);
        continue;
      }
      if (running >= limit) continue;
      running++;
      this.start(job);
    }
  }

  private start(job: Job) {
    const runner = this.runners.get(job.engine);
    if (!runner) {
      this.set(job, { status: 'failed', error: { message: `No runner for ${job.engine} jobs.` } });
      return;
    }
    const workDir = this.workDirFor(job.id);
    fs.mkdirSync(workDir, { recursive: true });
    this.set(job, { status: 'running', error: null, progress: { ...job.progress, stage: 'Starting' } });

    // A job being cancelled still has its old status for a moment; nothing the old run says may count.
    const isCurrent = () => !this.cancelling.has(job.id) && (this.jobs.get(job.id)?.status === 'running' || this.jobs.get(job.id)?.status === 'processing');
    const ctx: RunnerContext = {
      workDir,
      job: () => this.jobs.get(job.id) ?? job,
      progress: (p, status) => {
        const current = this.jobs.get(job.id);
        if (!current || !isCurrent()) return;
        const next = { ...current, progress: { ...current.progress, ...p } };
        if (status && status !== current.status) next.status = status;
        this.set(current, next, { throttle: !status || status === current.status });
      },
      patch: (p) => {
        const current = this.jobs.get(job.id);
        if (current) this.set(current, p);
      },
      complete: () => {
        const current = this.jobs.get(job.id);
        if (!current || !isCurrent()) return;
        this.handles.delete(job.id);
        this.cleanupWorkDir(current);
        // Captured browser cookies are only needed while downloading; don't keep them in history.
        const source = current.source.request?.cookies.length
          ? { ...current.source, request: { ...current.source.request, cookies: [] } }
          : current.source;
        // What the finished row shows beyond "Done": the size on disk and the time it was actually active.
        const since = this.runSince.get(job.id);
        const tookMs = (current.engineState.activeMs ?? 0) + (since ? Date.now() - since : 0);
        this.set(current, {
          status: 'completed', source, summary: finishedSummary(sizeOnDisk(current.outputPaths), tookMs),
          progress: { ...current.progress, percent: 100, speedBps: null, etaSec: 0, stage: 'Done', activity: null, connections: null },
        });
        this.emit('completed', this.jobs.get(job.id)!);
        this.schedule();
      },
      fail: (rawMessage, rawDetail) => {
        const current = this.jobs.get(job.id);
        if (!current || !isCurrent()) return;
        this.handles.delete(job.id);
        // "fetch failed" and "The operation was aborted due to timeout" are what the network layer says; the person gets a
        // sentence, and the original is kept as the detail so nothing is lost for a bug report.
        const message = plainFailure(rawMessage);
        const detail = rawDetail ?? (message !== rawMessage ? rawMessage : undefined);
        log.warn(`Job failed: ${current.title}`, { message, detail: detail?.slice(-4000) });
        this.set(current, { status: 'failed', error: { message, detail }, progress: { ...current.progress, speedBps: null, etaSec: null, stage: 'Failed' } });
        // Decide on a retry first, so the failure listener can tell a job that will start again by itself.
        this.maybeAutoRetry(this.jobs.get(job.id)!);
        this.emit('failed', this.jobs.get(job.id)!);
        this.schedule();
      },
    };

    try {
      this.handles.set(job.id, runner(ctx));
    } catch (err) {
      ctx.fail(err instanceof Error ? err.message : String(err));
    }
  }

  /** When each job last became active in this run; the time it then spends active is added to `engineState.activeMs` when it stops. */
  private runSince = new Map<string, number>();

  private set(job: Job, patch: Partial<Job>, opts: { throttle?: boolean } = {}) {
    const next: Job = { ...job, ...patch, updatedAt: Date.now() };
    // How long the job was really active (not queued, not paused, not waiting), for the finished row's "took 2 min 05 s".
    const timing = next.status === 'running' || next.status === 'processing';
    if (timing && !this.runSince.has(next.id)) this.runSince.set(next.id, Date.now());
    else if (!timing && this.runSince.has(next.id)) {
      const since = this.runSince.get(next.id)!;
      this.runSince.delete(next.id);
      next.engineState = { ...next.engineState, activeMs: (next.engineState.activeMs ?? 0) + (Date.now() - since) };
    }
    // "Waiting for network" belongs to the failed row that is waiting; once the job is anything else the mark is stale.
    if (next.status !== 'failed' && next.progress.activity === 'waiting') next.progress = { ...next.progress, activity: null };
    this.jobs.set(job.id, next);
    const now = Date.now();
    const statusChanged = patch.status !== undefined && patch.status !== job.status;
    if (!opts.throttle || now - (this.lastEmit.get(job.id) ?? 0) > 250) {
      this.lastEmit.set(job.id, now);
      this.emit('updated', next);
    }
    this.save(next, statusChanged || !opts.throttle);
  }

  private save(job: Job, force: boolean) {
    const now = Date.now();
    if (!force && now - (this.lastPersist.get(job.id) ?? 0) < 3000) return;
    this.lastPersist.set(job.id, now);
    database().prepare('INSERT INTO jobs (id, created_at, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data')
      .run(job.id, job.createdAt, JSON.stringify(job));
  }

  private cleanupWorkDir(job: Job) {
    fs.rm(this.workDirFor(job.id), { recursive: true, force: true }, () => undefined);
  }
}

export const queue = new JobQueue();
