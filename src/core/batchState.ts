// A batch (a pasted release, or links sent together from the browser) is several downloads that belong together. Telling the person about each one
// as it ends is noise: twelve parts meant twelve toasts, twelve desktop notifications and, with "show in folder" on, twelve Explorer windows.
// This says whether a job that just ended was the last of its batch, and how the batch came out, so the app can speak once.

import type { Job } from '../shared/types';
import { isWaitingForNetwork } from './jobDisplay';

export interface BatchState {
  title: string;
  total: number;
  completed: number;
  failed: number;
  /** Files still to come: waiting, downloading, unpacking or paused, or a failed one that is waiting for the network to return. */
  pending: number;
}

/** The batch `job` belongs to, as it stands now; null for a download that is on its own (or alone in its release). */
export function batchStateOf(job: Pick<Job, 'options' | 'engine'>, all: Iterable<Pick<Job, 'options' | 'status' | 'progress' | 'title' | 'engine'>>): BatchState | null {
  const id = job.options.release?.id;
  // The unpack job that follows a release's archives shares its id but is not one of its files; it speaks for itself, like any download.
  if (!id || job.engine === 'extract') return null;
  let total = 0;
  let completed = 0;
  let failed = 0;
  let pending = 0;
  for (const other of all) {
    if (other.options.release?.id !== id || other.engine === 'extract') continue;
    // A file the person cancelled is their choice, not a failure to report.
    if (other.status === 'cancelled') continue;
    total++;
    // Waiting for the network, or for the timer of a retry that will start it again: not over.
    if (isWaitingForNetwork(other) || (other.status === 'failed' && /^Retrying in /.test(other.progress.stage ?? ''))) pending++;
    else if (other.status === 'completed') completed++;
    else if (other.status === 'failed') failed++;
    else pending++;
  }
  if (total < 2) return null;
  return { title: job.options.release?.title || 'Batch download', total, completed, failed, pending };
}

/** What to say when a batch is over: null while files are still to come (say nothing yet). */
export function batchSummary(state: BatchState): { text: string; ok: boolean } | null {
  if (state.pending > 0) return null;
  if (state.failed === 0) return { text: `${state.total} files downloaded`, ok: true };
  if (state.completed === 0) return { text: `None of the ${state.total} files could be downloaded`, ok: false };
  return { text: `${state.completed} of ${state.total} files downloaded, ${state.failed} did not`, ok: false };
}
