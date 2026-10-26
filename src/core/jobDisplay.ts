// What a Queue row says about a download, decided in one place so each rule can be tested.
//
// The row used to build these strings inline, and for three kinds of row it said nothing true: a download whose server never
// announces its size read "0%" with an empty bar while data flowed; a paused download showed a bar with no number and no bytes; a
// finished one said only "Done". The design is the approved mockup of 2026-10-26 (SESSION-LOG 45, docs/19 D1-D3 and D11).
import type { Job, JobProgress } from '../shared/types';
import { formatBytes, formatEta, formatSpeed } from './format';
import { progressIndeterminate } from './progress';

export interface RowChip {
  label: string;
  /** neutral: informative; warning: something is being recovered from. */
  tone: 'neutral' | 'warning';
}

export interface RowDetail {
  /** The parts of the line after the status word, joined with " · ". */
  meta: string[];
  /** What fills the number slot at the right of the row. Muted when it is a figure at rest, not a live one. */
  right: { text: string; muted: boolean } | null;
  /** True when the bar should loop because nothing about how far along it is can honestly be drawn. */
  indeterminate: boolean;
  chip: RowChip | null;
}

type RowJob = Pick<Job, 'status' | 'progress' | 'engine'> & { summary?: Job['summary'] };

export const connectionsLabel = (n: number): string => `${n} connection${n === 1 ? '' : 's'}`;

/** "2 min 05 s", "45 s", "1 h 02 min": how long a download was active. Null under a second or when not a time. */
export function formatTook(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms) || ms < 1000) return null;
  const total = Math.round(ms / 1000);
  const two = (n: number) => String(n).padStart(2, '0');
  if (total < 60) return `${total} s`;
  if (total < 3600) return `${Math.floor(total / 60)} min ${two(total % 60)} s`;
  return `${Math.floor(total / 3600)} h ${two(Math.floor((total % 3600) / 60))} min`;
}

/**
 * The small pill beside the title, shown only while it is true. A drop in the connection outranks everything (the job has
 * failed its attempt and is waiting), then what the engine is recovering from, then the plain count of open connections.
 */
export function rowChip(job: Pick<Job, 'status' | 'progress'>): RowChip | null {
  const p = job.progress;
  if (p.activity === 'waiting') return { label: 'Waiting for network', tone: 'warning' };
  if (job.status !== 'running' && job.status !== 'processing') return null;
  if (p.activity === 'reconnecting') return { label: 'Reconnecting', tone: 'warning' };
  if (p.activity === 'writing') return { label: 'Writing to disk', tone: 'neutral' };
  if (job.status === 'running' && p.connections && p.connections > 0) return { label: connectionsLabel(p.connections), tone: 'neutral' };
  return null;
}

/**
 * A failed job that Lumina is waiting to resume because the connection dropped. It is not finished and not an error to be alarmed
 * by: it sits with the active downloads and is shown in the calm warning colour, not the danger red of a real failure.
 */
export const isWaitingForNetwork = (job: Pick<Job, 'status' | 'progress'>): boolean =>
  job.status === 'failed' && job.progress.activity === 'waiting';

/** "Paused" unless the engine said more ("Paused when Lumina closed"). */
export const pausedWord = (stage: string): string => (/^paused\b/i.test(stage) ? stage : 'Paused');

const known = (p: JobProgress): boolean => Boolean(p.totalBytes && p.totalBytes > 0);

/**
 * The detail of one row. [headline] is the percentage the row draws as its main figure (the file in hand on a playlist, else the
 * whole job); [multi] is true for a playlist, where the byte counts belong to the file in hand, not to the job.
 */
export function rowDetail(job: RowJob, headline: number, multi: boolean): RowDetail {
  const p = job.progress;
  const chip = rowChip(job);
  const percent = Math.max(0, Math.min(100, p.percent));
  const downloaded = p.downloadedBytes != null && p.downloadedBytes > 0 ? p.downloadedBytes : 0;

  if (job.status === 'running' || job.status === 'processing') {
    const running = job.status === 'running';
    const meta: string[] = [];
    if (running && p.item) meta.push(`${p.item.index} of ${p.item.count}`);
    if (running && p.speedBps) meta.push(formatSpeed(p.speedBps));
    if (running && p.etaSec != null) meta.push(`${formatEta(p.etaSec)} left`);
    // A server that never says how big the file is: the bytes so far are the one true figure, so they take the number slot,
    // and the bar loops instead of sitting at 0%.
    const unknownSize = running && !known(p) && !multi && percent <= 0 && downloaded > 0;
    if (running && known(p)) {
      const bytes = `${formatBytes(p.downloadedBytes)} of ${formatBytes(p.totalBytes)}`;
      meta.push(multi ? `this file ${bytes}` : bytes);
    } else if (unknownSize) {
      meta.push('size not announced');
    }
    const indeterminate = progressIndeterminate(p) || unknownSize;
    const right = unknownSize
      ? { text: formatBytes(downloaded), muted: false }
      : indeterminate && downloaded === 0 && percent <= 0 && !known(p)
        ? null
        : { text: `${Math.floor(headline)}%`, muted: false };
    return { meta, right, indeterminate, chip };
  }

  if (job.status === 'paused') {
    const meta: string[] = [];
    if (!multi) {
      if (known(p)) meta.push(`${formatBytes(p.downloadedBytes)} of ${formatBytes(p.totalBytes)}`);
      else if (downloaded > 0) meta.push(`${formatBytes(downloaded)} downloaded`);
    }
    return { meta, right: percent > 0 ? { text: `${Math.floor(percent)}%`, muted: true } : null, indeterminate: false, chip };
  }

  if (job.status === 'completed') {
    const meta: string[] = [];
    // Only for downloads: a conversion or an unpack has its own sentence, and "average speed" means nothing for it.
    if ((job.engine === 'ytdlp' || job.engine === 'aria2') && job.summary) {
      const { bytes, tookMs } = job.summary;
      if (bytes != null && bytes > 0) meta.push(formatBytes(bytes));
      const took = formatTook(tookMs);
      if (took) meta.push(took);
      if (bytes != null && bytes > 0 && tookMs != null && tookMs >= 2000) meta.push(`${formatSpeed(bytes / (tookMs / 1000))} average`);
    }
    return { meta, right: null, indeterminate: false, chip: null };
  }

  return { meta: [], right: null, indeterminate: false, chip };
}

/** What to store on a job when it finishes. Bytes of nothing, or a time that is not one, are not worth remembering. */
export function finishedSummary(bytes: number, tookMs: number): Job['summary'] {
  return {
    bytes: Number.isFinite(bytes) && bytes > 0 ? bytes : null,
    tookMs: Number.isFinite(tookMs) && tookMs >= 0 ? Math.round(tookMs) : null,
  };
}
