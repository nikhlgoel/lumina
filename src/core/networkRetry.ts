// What to do when a download fails: wait for the network, retry soon, or leave it.
//
// Measured with a server that went away for 70 s: the job failed after ~20 s of aria2's own retries,
// then waited a fixed 30 s, failed again, then waited a fixed 2 minutes — resuming 120 s AFTER the
// server was back. Three tries (30 s, 2 min, 10 min) is the whole budget, so a connection that is
// down for a quarter of an hour (a router reboot, a laptop lid, a train) ended in a permanent
// "Failed". The decision to retry belongs to whether the network is back, not to a timer.

export type FailureKind =
  /** The connection itself is gone: wait for it, as long as it takes, and resume the moment it returns. */
  | 'network'
  /** The server is busy or rate-limiting: a few retries with growing pauses usually clear it. */
  | 'transient'
  /** Something retrying cannot fix. */
  | 'permanent';

// "unavailable" alone is not enough: "503 Service Unavailable" is exactly the kind of failure worth retrying.
const PERMANENT = /(private|drm|(video|content|file|media) (is )?unavailable|not found|404|403|members|age-restricted|disk is full|not enough|can’t download|can't download)/;
const NETWORK = /(network|connection|no internet|name resolution|could not resolve|getaddrinfo|unreachable|timed? ?out|reset|refused|eof|ssl|socket)/;
const TRANSIENT = /(429|rate-limit|too many|503|502|500|temporar)/;

/** Read a failure message (and any detail) and say what kind of waiting it deserves. */
export function classifyFailure(message: string | null | undefined, detail?: string | null): FailureKind {
  const text = `${message ?? ''} ${detail ?? ''}`.toLowerCase();
  if (PERMANENT.test(text)) return 'permanent';
  if (NETWORK.test(text)) return 'network';
  if (TRANSIENT.test(text)) return 'transient';
  return 'permanent';
}

const PROBE_STEPS_S = [5, 10, 20, 30, 60];

/** How long to wait before asking again whether the network is back; quick at first, then once a minute. */
export function nextProbeDelayMs(attempt: number): number {
  return PROBE_STEPS_S[Math.min(Math.max(0, attempt), PROBE_STEPS_S.length - 1)]! * 1000;
}

/** After this long without the network the job is left failed, with a message, for the person to retry. */
export const NETWORK_WAIT_LIMIT_MS = 6 * 3600_000;

export const waitedTooLong = (sinceMs: number, nowMs: number): boolean => nowMs - sinceMs > NETWORK_WAIT_LIMIT_MS;

/** "Retrying in 30 s" / "in 2 min" — the old label rounded 30 s up to "1 min". */
export function retryLabel(delayMs: number): string {
  const s = Math.round(delayMs / 1000);
  return s < 90 ? `${s} s` : `${Math.round(s / 60)} min`;
}
