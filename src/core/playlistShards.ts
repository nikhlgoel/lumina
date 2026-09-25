// Downloading several items of one playlist at the same time.
//
// This exists because of a measurement, not a hunch. On the development line:
//
//   * a 40 MB file takes the same time over 1 connection as over 16 — the link saturates at about
//     25 Mbit/s and more sockets per file buy nothing;
//   * yt-dlp spends about **4.8 seconds per item** before a byte of audio moves, working out what
//     to fetch;
//   * a song is roughly 8 MB, so about 2.5 seconds of actual transfer.
//
// A 433-song playlist is therefore ~53 minutes, of which ~35 are spent waiting rather than
// transferring, and the line runs at about 9 of its 25 Mbit/s throughout. The bottleneck is
// per-item latency, and the only thing that touches it is doing several items at once. See D19.
//
// yt-dlp handles one playlist serially, so the split happens outside it: the item numbers are dealt
// between several processes, each given its own `--playlist-items`.

/** More than this and YouTube starts answering with rate limits rather than data. */
export const MAX_PLAYLIST_WORKERS = 8;
export const DEFAULT_PLAYLIST_WORKERS = 4;

/**
 * How many processes to actually use.
 *
 * Never more than there are items — three workers for two songs is two idle processes and a third
 * Python interpreter started for nothing.
 */
export function workerCount(itemCount: number, configured: number): number {
  const wanted = Math.floor(Number.isFinite(configured) ? configured : DEFAULT_PLAYLIST_WORKERS);
  if (!(itemCount > 1) || wanted <= 1) return 1;
  return Math.max(1, Math.min(MAX_PLAYLIST_WORKERS, wanted, itemCount));
}

/**
 * Deal the items between workers, round-robin.
 *
 * Round-robin rather than contiguous blocks: a playlist is usually in some order that correlates
 * with length — an album's long track last, a mix's extended cuts together — and contiguous blocks
 * would leave one worker running long after the others had finished. Dealing alternately spreads
 * any such run across all of them.
 *
 * Empty shards are never returned, so the caller can spawn exactly `shards.length` processes.
 */
export function planShards<T>(items: readonly T[], workers: number): T[][] {
  const count = workerCount(items.length, workers);
  if (count <= 1) return items.length ? [[...items]] : [];
  const shards: T[][] = Array.from({ length: count }, () => []);
  items.forEach((item, i) => shards[i % count]!.push(item));
  return shards.filter((s) => s.length > 0);
}

/**
 * The `--playlist-items` value for one shard.
 *
 * Runs of consecutive numbers are collapsed into ranges. With one worker that turns a 433-item list
 * into `1-433`, which matters because the argument is otherwise long enough to be unreadable in a
 * log — and a log nobody can read is how the last progress bug survived three reports.
 */
export function playlistItemsArg(indices: readonly number[]): string {
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const parts: string[] = [];
  let start: number | null = null;
  let prev: number | null = null;
  const flush = () => {
    if (start === null || prev === null) return;
    parts.push(start === prev ? String(start) : prev === start + 1 ? `${start},${prev}` : `${start}-${prev}`);
  };
  for (const n of sorted) {
    if (start === null || prev === null) { start = n; prev = n; continue; }
    if (n === prev + 1) { prev = n; continue; }
    flush();
    start = n;
    prev = n;
  }
  flush();
  return parts.join(',');
}

/** The numbers 1..count, for a playlist whose items were not hand-picked. */
export const allItems = (count: number): number[] => Array.from({ length: Math.max(0, count) }, (_, i) => i + 1);

export interface WorkerProgress {
  /** Items this worker has finished. */
  finished: number;
  /** Items this worker was given. */
  total: number;
  speedBps: number | null;
}

/**
 * Roll several workers up into the one set of figures the job shows.
 *
 * The speeds add, because they are genuinely separate transfers and the sum is what the link is
 * carrying. The percentage counts finished items across every worker, and is held below 100 so a
 * job can never read as complete while a process is still running.
 */
export function aggregateProgress(workers: readonly WorkerProgress[]): { percent: number; finished: number; total: number; speedBps: number | null } {
  const finished = workers.reduce((n, w) => n + w.finished, 0);
  const total = workers.reduce((n, w) => n + w.total, 0);
  const speeds = workers.map((w) => w.speedBps).filter((s): s is number => s != null && s > 0);
  return {
    percent: total > 0 ? Math.min(99, (100 * finished) / total) : 0,
    finished,
    total,
    speedBps: speeds.length ? speeds.reduce((a, b) => a + b, 0) : null,
  };
}
