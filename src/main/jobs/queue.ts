import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import type { DownloadOptions, Job, JobProgress, JobStatus, MediaInfo } from '../../shared/types';
import { database } from '../db';
import { settings } from '../settings';
import { tempDir } from '../paths';
import { logger } from '../log';

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
  stop: (reason: 'pause' | 'cancel') => void;
}

export type Runner = (ctx: RunnerContext) => RunnerHandle;

const ACTIVE: JobStatus[] = ['running', 'processing'];
const BROWSER_POOL = 16;
const FINISHED: JobStatus[] = ['completed', 'failed', 'cancelled'];

const emptyProgress = (stage: string): JobProgress => ({
  percent: 0, speedBps: null, etaSec: null, downloadedBytes: null, totalBytes: null, stage,
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
    const msg = `${job.error?.message ?? ''} ${job.error?.detail ?? ''}`.toLowerCase();
    const transient = /(timed? ?out|connection|network|internet|reset|429|rate-limit|503|502|500|temporar|eof|ssl)/.test(msg)
      && !/(private|drm|unavailable|not found|404|members|age-restricted|disk is full|can’t download)/.test(msg);
    if (!transient || attempts >= 3) return;
    const delay = [30, 120, 600][attempts]! * 1000;
    this.set(job, { engineState: { ...job.engineState, autoRetries: attempts + 1 }, progress: { ...job.progress, stage: `Retrying in ${Math.round(delay / 60000) || '<1'} min` } });
    this.retryTimers.set(job.id, setTimeout(() => {
      this.retryTimers.delete(job.id);
      const current = this.jobs.get(job.id);
      if (current?.status === 'failed') this.set(current, { status: 'queued', error: null, progress: { ...current.progress, stage: 'Retrying' } });
      this.schedule();
    }, delay));
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
    if (!job || FINISHED.includes(job.status)) return;
    this.handles.get(id)?.stop('cancel');
    this.handles.delete(id);
    this.cleanupWorkDir(job);
    this.set(job, { status: 'cancelled', progress: { ...job.progress, speedBps: null, etaSec: null, stage: 'Cancelled' } });
    this.schedule();
  }

  retry(id: string) {
    const job = this.jobs.get(id);
    if (!job || !['failed', 'cancelled'].includes(job.status)) return;
    clearTimeout(this.retryTimers.get(id));
    this.retryTimers.delete(id);
    this.set(job, { status: 'queued', error: null, progress: emptyProgress('Waiting'), engineState: { ...job.engineState, autoRetries: 0 } });
    this.schedule();
  }

  remove(id: string) {
    const job = this.jobs.get(id);
    if (!job) return;
    if (!FINISHED.includes(job.status) && job.status !== 'paused') this.cancel(id);
    clearTimeout(this.retryTimers.get(id));
    this.retryTimers.delete(id);
    this.jobs.delete(id);
    database().prepare('DELETE FROM jobs WHERE id = ?').run(id);
    this.emit('removed', id);
  }

  clearFinished() {
    for (const job of [...this.jobs.values()]) {
      if (FINISHED.includes(job.status)) this.remove(job.id);
    }
  }

  /** Stop every active job without changing its saved status, so it resumes next launch. */
  shutdown() {
    for (const [id, handle] of this.handles) {
      handle.stop('pause');
      const job = this.jobs.get(id);
      if (job) this.save(job, true);
    }
    this.handles.clear();
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

    const isCurrent = () => this.jobs.get(job.id)?.status === 'running' || this.jobs.get(job.id)?.status === 'processing';
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
        this.set(current, { status: 'completed', source, progress: { ...current.progress, percent: 100, speedBps: null, etaSec: 0, stage: 'Done' } });
        this.emit('completed', this.jobs.get(job.id)!);
        this.schedule();
      },
      fail: (message, detail) => {
        const current = this.jobs.get(job.id);
        if (!current || !isCurrent()) return;
        this.handles.delete(job.id);
        log.warn(`Job failed: ${current.title}`, { message, detail: detail?.slice(-4000) });
        this.set(current, { status: 'failed', error: { message, detail }, progress: { ...current.progress, speedBps: null, etaSec: null, stage: 'Failed' } });
        this.emit('failed', this.jobs.get(job.id)!);
        this.maybeAutoRetry(this.jobs.get(job.id)!);
        this.schedule();
      },
    };

    try {
      this.handles.set(job.id, runner(ctx));
    } catch (err) {
      ctx.fail(err instanceof Error ? err.message : String(err));
    }
  }

  private set(job: Job, patch: Partial<Job>, opts: { throttle?: boolean } = {}) {
    const next: Job = { ...job, ...patch, updatedAt: Date.now() };
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
