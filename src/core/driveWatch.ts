// When to look at the removable drives again, without launching PowerShell every few seconds.
//
// The old watcher ran `Get-CimInstance Win32_LogicalDisk` in a fresh PowerShell every 5 s for as long as the
// app was open: ~0.4 s of CPU each time on a quiet machine, and under a busy download it overran its 10 s limit
// (24 failures in one afternoon in the log), each logged as a full stack trace. Drive letters can be listed
// natively in ~20 ms (`fsutil fsinfo drives`), so that is polled instead, and the expensive query runs only when
// the set of letters changes, plus once in a while to refresh free space, plus a retry with backoff after a failure.

/** "Drives: C:\ D:\ Z:\" -> ['C', 'D', 'Z']. Locale-proof: only the `X:\` shapes are read, never the label. */
export function parseFsutilDrives(output: string): string[] {
  const letters = new Set<string>();
  for (const m of output.matchAll(/\b([A-Za-z]):\\/g)) letters.add(m[1]!.toUpperCase());
  return [...letters].sort();
}

export interface DriveScanState {
  /** The drive letters at the last successful scan; null before the first. */
  key: string | null;
  failures: number;
  /** Earliest time another attempt is allowed after a failure. */
  retryAt: number;
  scannedAt: number;
}

export const initialDriveScan = (): DriveScanState => ({ key: null, failures: 0, retryAt: 0, scannedAt: 0 });

/** How long free space and labels may go unrefreshed while nothing else changes. */
export const RESCAN_MS = 120_000;

/** 15 s, 30 s, 1 min, 2 min, then 5 min: a machine that cannot run the query is not asked every 5 s. */
export function backoffMs(failures: number): number {
  return Math.min(300_000, 15_000 * 2 ** Math.max(0, failures - 1));
}

/** Should the full (PowerShell) listing run now? [key] is the current letters, e.g. "C,D,Z". */
export function shouldScan(state: DriveScanState, key: string, now: number): boolean {
  if (state.key === null) return state.failures === 0 || now >= state.retryAt;
  // A letter appeared or went: that is the event being waited for, and it is worth an attempt even mid-backoff.
  if (key !== state.key) return true;
  if (state.failures > 0) return now >= state.retryAt;
  return now - state.scannedAt >= RESCAN_MS;
}

export function afterScan(state: DriveScanState, key: string, ok: boolean, now: number): DriveScanState {
  if (ok) return { key, failures: 0, retryAt: 0, scannedAt: now };
  const failures = state.failures + 1;
  // The key is kept as it was, so the next letter change still counts as a change.
  return { ...state, failures, retryAt: now + backoffMs(failures) };
}

/** One readable line for a failed child process, instead of a stack trace: what happened, not where in Node it was thrown. */
export function describeSpawnFailure(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const e = err as Error & { killed?: boolean; signal?: string | null; code?: string | number | null; stderr?: string };
  if (e.killed || e.signal) return `the command did not finish in time (${e.signal ?? 'timed out'})`;
  const stderr = (e.stderr ?? '').split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  if (stderr) return stderr.slice(0, 200);
  if (e.code === 'ENOENT') return 'the command was not found';
  return `${e.message.split(/\r?\n/)[0] ?? e.message}`.slice(0, 200);
}
