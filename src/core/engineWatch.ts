// When to leave the download engine alone, and when to step in.
//
// Two failures were in the owner's own log, over and over: a torrent (or a 4 GB direct file) ran fine
// for minutes, then went to 0 B/s and never came back. The engine's RPC stopped answering, three
// 10-second polls later Lumina killed it, and the resumed run froze the same way.
//
// Measured on the dev machine: on Windows one 1 MB write that lands 20 GB past the end of a fresh
// file blocks for 37 seconds (NTFS zero-fills the gap), and aria2 does file writes and RPC on one
// thread, so the engine is *busy*, not dead. Killing it only throws the half-done zero-fill away.
// The write-side cure is in `src/main/sparse.ts`; this file is the supervision that stops a busy
// engine being mistaken for a dead one, and that recovers a swarm that has gone quiet.

/** Below this, zero-filling the gap takes well under a second (measured ~540 MB/s) and is not worth a process spawn. */
const SPARSE_MIN_BYTES = 256 * 2 ** 20;

/**
 * Should this output file be marked sparse before data is written into it?
 *
 * Only Windows has the problem: NTFS zero-fills everything between the old end of a file and a
 * write beyond it, synchronously. 37 s for a single 1 MB write 20 GB in; 0 ms once the file is sparse.
 */
export const needsSparse = (platform: string, lengthBytes: number): boolean =>
  platform === 'win32' && lengthBytes >= SPARSE_MIN_BYTES;

export type RpcAction = 'wait' | 'restart';

/** How long a running engine may stay silent before it is treated as hung rather than busy. */
export const BUSY_GRACE_MS = 120_000;

/**
 * What to do about an engine whose RPC is not answering.
 *
 * A dead process cannot recover, so restart at once. A live one gets a long grace period: it is far
 * more often in the middle of a slow disk write than truly hung, and a restart repeats that write.
 */
export function rpcAction(silentForMs: number, processAlive: boolean): RpcAction {
  if (!processAlive) return 'restart';
  return silentForMs >= BUSY_GRACE_MS ? 'restart' : 'wait';
}

export type StallAction = 'none' | 'nudge' | 'readd' | 'restart';

export interface StallState {
  /** Bytes at the last sample that moved. */
  bytes: number;
  /** When bytes last increased. */
  progressAt: number;
  /** How many recovery steps have run since bytes last moved. */
  steps: number;
  /** When the last step ran (0 = none yet). */
  actedAt: number;
}

/** Seconds of no progress before each step: re-announce, re-add the download, restart the engine. */
const LADDER_S = [60, 180, 420];
/** After the ladder is used up, try the heaviest step again this often rather than sit idle for ever. */
const REPEAT_S = 600;
/** Two steps are never closer than this, so each gets time to work. */
const COOLDOWN_S = 30;

export const initialStall = (now: number, bytes = 0): StallState => ({ bytes, progressAt: now, steps: 0, actedAt: 0 });

/**
 * Fold one status sample into the stall tracker.
 *
 * `bytes` is what is on disk so far. Any increase is progress and resets the ladder. Without one,
 * the steps escalate: `nudge` (pause and resume, which makes a torrent announce to its trackers
 * again), `readd` (drop the download and add it back; files on disk are kept), `restart` (the
 * engine itself). `waitingForMetadata` and `finished` never count as stalls.
 */
export function stallStep(
  s: StallState, now: number, bytes: number, opts: { finished?: boolean; waitingForMetadata?: boolean } = {},
): { state: StallState; action: StallAction } {
  if (bytes > s.bytes || opts.finished) return { state: { bytes, progressAt: now, steps: 0, actedAt: 0 }, action: 'none' };
  if (opts.waitingForMetadata) return { state: { ...s, progressAt: now }, action: 'none' };

  const stalledS = (now - s.progressAt) / 1000;
  const due = s.steps < LADDER_S.length
    ? LADDER_S[s.steps]!
    : LADDER_S[LADDER_S.length - 1]! + REPEAT_S * (s.steps - LADDER_S.length + 1);
  if (stalledS < due || (s.actedAt && (now - s.actedAt) / 1000 < COOLDOWN_S)) return { state: s, action: 'none' };

  const action: StallAction = s.steps === 0 ? 'nudge' : s.steps === 1 ? 'readd' : 'restart';
  return { state: { ...s, steps: s.steps + 1, actedAt: now }, action };
}
