// Noticing that a host has started limiting a download, so the row can say so instead of leaving the person to wonder.
//
// A batch of 5 GB files ran at 20-30 MB/s, then fell to about 1 MB/s and stayed there. Lumina cannot raise a host's own limit (the host
// publishes that a file using too much bandwidth "can be rate limited"; these files had moved 45-195 GB each), but it can tell a limit from a
// problem on the person's side: a collapse from a high speed that does not come back is the host. Brief dips, a download that was always slow,
// pauses and gaps are none of that, and must not be called one.

const MB = 1024 * 1024;
/** Below this the download never had a speed worth protecting, so a fall from it is not a limit. */
const MIN_PEAK_BPS = 6 * MB;
/** "Collapsed" is under this share of the recent best, held for the time below. */
const LOW_FRACTION = 0.15;
const LOW_FOR_MS = 45_000;
/** It has recovered when it is back over this share (higher than the drop line, so it does not flicker). */
const RECOVER_FRACTION = 0.4;
/** The recent best is forgotten after this long, so a download that was fast an hour ago is not compared with it for ever. */
const PEAK_MEMORY_MS = 10 * 60_000;
const SMOOTHING = 0.15;
/** A host's limit lasts for the connection, not for one file: how long the best speed seen from a host is remembered for the next file. */
const HOST_MEMORY_MS = 30 * 60_000;

/**
 * The best speed recently seen from each host, shared by every file from it. A host that throttles the connection throttles the next file too,
 * and that file starts already slow: on its own it has no fast moment to compare with, so without this it would crawl without a word.
 */
export class HostPeaks {
  private seen = new Map<string, { bps: number; at: number }>();

  note(host: string, bps: number, now: number) {
    const cur = this.seen.get(host);
    if (!cur || bps >= cur.bps || now - cur.at > HOST_MEMORY_MS) this.seen.set(host, { bps, at: now });
  }

  recent(host: string, now: number): number {
    const cur = this.seen.get(host);
    return cur && now - cur.at <= HOST_MEMORY_MS ? cur.bps : 0;
  }
}

export class SlowdownWatch {
  private smoothed = 0;
  private peak = 0;
  private peakAt = 0;
  private lowSince: number | null = null;
  private limited = false;

  /** Forget the speed seen so far: the person's own limit changed, so earlier speeds say nothing about the host. */
  reset() {
    this.smoothed = 0;
    this.peak = 0;
    this.lowSince = null;
    this.limited = false;
  }

  /** `host` and `peaks` let this file compare itself with what earlier files from the same host reached. */
  constructor(private readonly shared?: { host: string; peaks: HostPeaks }) {}

  /** Feed each speed reading (bytes per second, null when there is none). Returns whether the host looks to be limiting the speed now. */
  update(now: number, speedBps: number | null): boolean {
    // A pause, a reconnect or a gap says nothing about a limit; neither starts nor ends one.
    if (!speedBps || speedBps <= 0) {
      this.lowSince = null;
      return this.limited;
    }
    this.smoothed = this.smoothed ? this.smoothed * (1 - SMOOTHING) + speedBps * SMOOTHING : speedBps;
    // The old best is forgotten after a while, but never during a limit: a throttle that lasts must go on being called one until the speed returns.
    if (this.smoothed >= this.peak || (!this.limited && now - this.peakAt > PEAK_MEMORY_MS)) {
      this.peak = this.smoothed;
      this.peakAt = now;
    }
    // The line to measure against: this file's own best, or what earlier files from the host reached, whichever is higher.
    if (this.shared) this.shared.peaks.note(this.shared.host, this.peak, now);
    const best = Math.max(this.peak, this.shared ? this.shared.peaks.recent(this.shared.host, now) : 0);
    if (best < MIN_PEAK_BPS) {
      this.lowSince = null;
      this.limited = false;
      return false;
    }
    if (this.smoothed < best * LOW_FRACTION) {
      this.lowSince ??= now;
      if (now - this.lowSince >= LOW_FOR_MS) this.limited = true;
    } else {
      this.lowSince = null;
      if (this.smoothed >= best * RECOVER_FRACTION) this.limited = false;
    }
    return this.limited;
  }
}
