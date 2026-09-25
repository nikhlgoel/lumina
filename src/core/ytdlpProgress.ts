// How a yt-dlp run turns into the figures a person actually reads.
//
// This lived inline in `src/main/jobs/ytdlp.ts`, where nothing could test it, and it was wrong three
// times running. Twice the blame landed on the parser — both times wrongly. Replaying a real capture
// of yt-dlp's output through it showed the parser and the arithmetic were both correct, and that the
// fault was what the arithmetic *means*: on a 433-item playlist one song is 0.23% of the job, so the
// whole-job percentage changes once every five songs and reads 0% for the first five. A bar that
// advances 0.23% per song is indistinguishable from a bar that is stuck.
//
// So the model reports two figures, and a multi-item job shows both: `percent` for the job,
// `filePercent` for the file in hand. See D15.
import type { JobProgress } from '../shared/types';
import { postprocessLabel, type YtdlpEvent } from './progress';

export interface ProgressModelOptions {
  /** 2 when a video item downloads its video and audio streams separately, 1 otherwise. */
  streamsPerItem: 1 | 2;
  /** How many items this job expects. */
  itemCount: number;
  /**
   * True when the caller already knows the count — a hand-picked selection, or a Spotify list
   * downloaded through a batch file — so yt-dlp's own `n_entries` must not overwrite it.
   */
  countIsFixed: boolean;
}

export interface ProgressModelState {
  /** Items whose download has started. `playlist_index` can skip numbers, so they are counted. */
  itemsSeen: number;
  itemCount: number;
  itemIndex: number;
  streamIndex: number;
  /** The last known fraction of the current stream, held when a tick reports no size. */
  lastFraction: number;
  itemTitle: string;
}

export const initialProgressState = (o: ProgressModelOptions): ProgressModelState => ({
  itemsSeen: 0,
  itemCount: Math.max(1, o.itemCount),
  itemIndex: 0,
  streamIndex: 0,
  lastFraction: 0,
  itemTitle: '',
});

/** How far through the file in hand, 0–1. Both streams of a video count as one file to a person. */
export function itemFraction(s: ProgressModelState, fraction: number, streamsPerItem: number): number {
  return Math.min(1, (s.streamIndex + fraction) / streamsPerItem);
}

/**
 * How far through the whole job, 0–99.
 *
 * Never returns 100: only completion does that, so a job can never sit at 100% while still working.
 */
export function overallPercent(s: ProgressModelState, fraction: number, streamsPerItem: number): number {
  return Math.min(99, (100 * (s.itemIndex + itemFraction(s, fraction, streamsPerItem))) / Math.max(1, s.itemCount));
}

export interface ProgressStep {
  state: ProgressModelState;
  /** What to merge into the job's progress, or null when this event changes nothing visible. */
  patch: Partial<JobProgress> | null;
}

/**
 * Fold one parsed yt-dlp event into the progress model.
 *
 * `file` and `error` events are deliberately not handled here — they change the job's outputs and
 * its failure state, which is the runner's business rather than the progress figures'.
 */
export function applyProgressEvent(state: ProgressModelState, ev: YtdlpEvent, o: ProgressModelOptions): ProgressStep {
  switch (ev.type) {
    case 'item': {
      const itemsSeen = state.itemsSeen + 1;
      const itemCount = ev.count && !o.countIsFixed ? ev.count : state.itemCount;
      const next: ProgressModelState = {
        itemsSeen, itemCount, itemIndex: itemsSeen - 1, streamIndex: 0, lastFraction: 0, itemTitle: ev.title,
      };
      if (itemCount <= 1) return { state: next, patch: null };
      // Starting an item IS progress. An item that never reports a tick of its own — already in the
      // archive, postprocess-only, a format that reports no size — would otherwise leave the bar
      // motionless for its whole turn. The byte counts belong to the file just finished, so they are
      // cleared rather than left to look like a total that keeps resetting.
      return {
        state: next,
        patch: {
          item: { index: Math.min(itemsSeen, itemCount), count: itemCount, title: ev.title },
          stage: ev.title,
          percent: overallPercent(next, 0, o.streamsPerItem),
          filePercent: 0,
          downloadedBytes: null,
          totalBytes: null,
        },
      };
    }

    case 'progress': {
      if (ev.status === 'finished') {
        return {
          state: { ...state, streamIndex: Math.min(o.streamsPerItem - 1, state.streamIndex + 1), lastFraction: 0 },
          patch: null,
        };
      }
      const fraction = ev.total && ev.downloaded != null
        ? ev.downloaded / ev.total
        : ev.fragment
          ? ev.fragment[0] / ev.fragment[1]
          : state.lastFraction;
      const next = { ...state, lastFraction: fraction };
      return {
        state: next,
        patch: {
          percent: overallPercent(next, fraction, o.streamsPerItem),
          filePercent: 100 * itemFraction(next, fraction, o.streamsPerItem),
          speedBps: ev.speed,
          etaSec: ev.eta,
          downloadedBytes: ev.downloaded,
          totalBytes: ev.total,
          stage: downloadStage(next, o),
        },
      };
    }

    case 'postprocess':
      if (ev.status !== 'started') return { state, patch: null };
      return { state, patch: { stage: postprocessLabel(ev.name), speedBps: null, etaSec: null } };

    default:
      return { state, patch: null };
  }
}

/** What the line under the title says while bytes are moving. */
function downloadStage(s: ProgressModelState, o: ProgressModelOptions): string {
  if (s.itemCount > 1) return s.itemTitle || 'Downloading';
  if (o.streamsPerItem === 2) return s.streamIndex === 0 ? 'Downloading video' : 'Downloading audio';
  return 'Downloading';
}
