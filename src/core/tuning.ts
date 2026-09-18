// Machine-adaptive tuning so defaults suit everyone from a 100 Mbps laptop to a 25 Gbps workstation, without a
// hardcoded guess. Pure (takes the numbers, does no I/O) so it's deterministic and testable; the main process
// feeds in os.totalmem().

/**
 * aria2 `--disk-cache` in MB: the RAM buffer that lets many connections' out-of-order writes be flushed to disk
 * in large sequential chunks instead of a storm of tiny random writes.
 *
 * Note it is a *smoothing buffer, not a rate limit* — a small value never caps download speed; it only smooths
 * write bursts, and past a point the disk itself is the ceiling. So the size is driven by how much RAM we can
 * safely lend (≈16 MB per GB of RAM), floored at 64 MB and capped at 512 MB. Fast links live on machines with
 * lots of RAM, so this scales up for them too, while a 2–4 GB machine stays modest.
 */
export function diskCacheMb(totalMemBytes: number): number {
  const gb = totalMemBytes > 0 ? totalMemBytes / 2 ** 30 : 0;
  const mb = Math.round(gb * 16);
  return Math.max(64, Math.min(512, mb));
}
