// When is a new download the same download that is already going?
//
// `Queue.add` never asked, so the same link sent twice (a double click on Send, a batch from the browser plus the clipboard watcher, a page
// opened twice) ran as two parallel jobs writing the same file name, the second under "name (1)". A duplicate is only ever an *unfinished*
// job with the same link, the same save folder, the same kind of download and the same playlist selection: a finished, failed or cancelled
// one never blocks a deliberate second download, and the same link saved as music and as video is two different downloads.
import type { DownloadOptions, Job } from '../shared/types';

const UNFINISHED = new Set<Job['status']>(['queued', 'running', 'paused', 'processing']);

type Compared = Pick<DownloadOptions, 'contentType' | 'playlistItems' | 'format' | 'release'>;

export interface DownloadCandidate {
  url: string;
  outputDir: string | null;
  engine: Job['engine'];
  options: Compared;
}

const sameSelection = (a: number[], b: number[]) => a.length === b.length && a.every((n, i) => n === b[i]);

/**
 * The unfinished job that already covers this download, if there is one.
 *
 * The engine and the format choice are part of "the same": converting one file to two formats, or saving one link as 720p and as 1080p, are
 * different jobs on the same address and must both run.
 */
export function findActiveDuplicate<J extends Pick<Job, 'url' | 'status' | 'outputDir' | 'engine'> & { options: Compared }>(
  jobs: Iterable<J>, candidate: DownloadCandidate,
): J | null {
  const url = candidate.url.trim();
  const format = JSON.stringify(candidate.options.format);
  for (const job of jobs) {
    if (!UNFINISHED.has(job.status)) continue;
    if (job.url.trim() !== url) continue;
    if (job.engine !== candidate.engine) continue;
    if ((job.outputDir ?? '') !== (candidate.outputDir ?? '')) continue;
    if (job.options.contentType !== candidate.options.contentType) continue;
    if (JSON.stringify(job.options.format) !== format) continue;
    // A part that belongs to a release is counted by that release when it is unpacked: the same link added again as part of another
    // release (or on its own) is a different job, or the new release would be missing a part and never assemble.
    if ((job.options.release?.id ?? '') !== (candidate.options.release?.id ?? '')) continue;
    if (!sameSelection(job.options.playlistItems ?? [], candidate.options.playlistItems ?? [])) continue;
    return job;
  }
  return null;
}
