// Shows a pasted release (a split archive and the unpack job that follows it) as ONE download in the
// Queue and the Recent strip instead of a row per volume. Pure: takes jobs, returns grouping + rollup,
// so the Queue UI can render a single progress bar and one set of controls for the whole release.
import type { Job, JobStatus } from '../shared/types';

export interface JobGroup {
  /** Stable React key and identity: the release id, or `job:<id>` for an ungrouped single job. */
  key: string;
  /** null when this "group" is really a single standalone job. */
  releaseId: string | null;
  title: string;
  /** Member job ids, in the order they were given (newest-first, as the store orders them). */
  ids: string[];
  /** The job whose thumbnail/metadata represents the group. */
  leadId: string;
}

export interface GroupSummary {
  status: JobStatus;
  /** 0–100 across the whole release, byte-weighted when every member knows its size. */
  percent: number;
  downloadedBytes: number | null;
  totalBytes: number | null;
  /** Combined speed of the members downloading right now; null when nothing is running. */
  speedBps: number | null;
  etaSec: number | null;
  counts: { total: number; completed: number; failed: number; active: number; queued: number; paused: number; cancelled: number };
}

/** Active states outrank finished ones; among finished, a failure outranks a success. */
const STATUS_RANK: Record<JobStatus, number> = {
  running: 6, processing: 5, queued: 4, paused: 3, failed: 2, cancelled: 1, completed: 0,
};

const releaseIdOf = (job: Job): string | null => job.options.release?.id ?? null;

/**
 * Collapse jobs that belong to the same pasted release into one group, keeping everything else as a
 * group of one. Input order is preserved: a group sits where its first member appeared.
 * A release with a single job stays ungrouped — there is nothing to collapse.
 */
export function groupJobs(jobs: Job[]): JobGroup[] {
  const counts = new Map<string, number>();
  for (const job of jobs) {
    const id = releaseIdOf(job);
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const groups: JobGroup[] = [];
  const byRelease = new Map<string, JobGroup>();
  for (const job of jobs) {
    const id = releaseIdOf(job);
    if (!id || (counts.get(id) ?? 0) < 2) {
      groups.push({ key: `job:${job.id}`, releaseId: null, title: job.title, ids: [job.id], leadId: job.id });
      continue;
    }
    const existing = byRelease.get(id);
    if (existing) {
      existing.ids.push(job.id);
      continue;
    }
    const group: JobGroup = {
      key: id,
      releaseId: id,
      title: job.options.release?.title || job.title,
      ids: [job.id],
      leadId: job.id,
    };
    byRelease.set(id, group);
    groups.push(group);
  }
  return groups;
}

/** Roll a group's members up into the single status + progress the collapsed row shows. */
export function summarizeGroup(members: Job[]): GroupSummary {
  const counts = { total: members.length, completed: 0, failed: 0, active: 0, queued: 0, paused: 0, cancelled: 0 };
  let status: JobStatus = 'completed';
  let downloaded = 0;
  let total = 0;
  let sizesKnown = members.length > 0;
  let percentSum = 0;
  let speed = 0;
  let running = 0;

  for (const job of members) {
    if (STATUS_RANK[job.status] > STATUS_RANK[status]) status = job.status;
    if (job.status === 'completed') counts.completed++;
    else if (job.status === 'failed') counts.failed++;
    else if (job.status === 'queued') counts.queued++;
    else if (job.status === 'paused') counts.paused++;
    else if (job.status === 'cancelled') counts.cancelled++;
    else counts.active++;

    const p = job.progress;
    // A finished job counts as fully done even if its last progress tick never reached 100.
    const percent = job.status === 'completed' ? 100 : Math.max(0, Math.min(100, p.percent));
    percentSum += percent;
    if (p.totalBytes && p.totalBytes > 0) {
      total += p.totalBytes;
      downloaded += job.status === 'completed' ? p.totalBytes : Math.min(p.downloadedBytes ?? 0, p.totalBytes);
    } else {
      sizesKnown = false;
    }
    if (job.status === 'running' && p.speedBps) {
      speed += p.speedBps;
      running++;
    }
  }

  const percent = members.length === 0 ? 0 : sizesKnown && total > 0 ? (downloaded / total) * 100 : percentSum / members.length;
  const speedBps = running > 0 ? speed : null;
  const remaining = sizesKnown ? total - downloaded : null;
  const etaSec = remaining != null && speedBps ? Math.round(remaining / speedBps) : null;

  return {
    status,
    percent,
    downloadedBytes: sizesKnown ? downloaded : null,
    totalBytes: sizesKnown ? total : null,
    speedBps,
    etaSec,
    counts,
  };
}

/**
 * Which per-job actions make sense for the whole group, and which members each applies to.
 * Mirrors the single-row controls: pause what is live, resume what is paused, retry what broke.
 */
export function groupActionTargets(members: Job[], action: 'pause' | 'resume' | 'cancel' | 'retry' | 'remove'): string[] {
  const match: Record<typeof action, (j: Job) => boolean> = {
    pause: (j) => j.status === 'running' || j.status === 'processing' || j.status === 'queued',
    resume: (j) => j.status === 'paused',
    cancel: (j) => j.status === 'running' || j.status === 'processing' || j.status === 'queued' || j.status === 'paused',
    retry: (j) => j.status === 'failed' || j.status === 'cancelled',
    remove: (j) => j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled',
  };
  return members.filter(match[action]).map((j) => j.id);
}
