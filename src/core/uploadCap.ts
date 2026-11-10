// How much to share while a torrent downloads.
//
// BitTorrent is built on giving as well as taking: a peer that sends nothing is served last. But the amount that buys is small, and an
// engine left unlimited gives away whatever it is asked for (a user's screen showed 646 KB/s up against 628 KB/s down, so half the line
// went to strangers). So: a tenth of the download speed, never below a floor that keeps peers willing to send. The pieces come from
// seeds as well as from peers, and seeds do not need anything back.
//
// Pure, so the rule is tested without an engine.

/** Never share less than this while downloading, so peers still have a reason to send to us. */
export const UPLOAD_FLOOR_KBPS = 50;

/** Share of the download speed that is given back. */
export const UPLOAD_SHARE = 0.1;

/**
 * Whether a freshly worked-out limit is worth sending to the engine. Download speed wobbles all the time and a limit that follows
 * every wobble is just noise, so a limit is only moved when it is new, when it switches on or off, or when it is off by a quarter.
 */
export function worthChanging(current: number, next: number): boolean {
  if (current === next) return false;
  if (current <= 0 || next === 0) return true; // nothing set yet (-1), the limit was off, or it is about to be
  return Math.abs(next - current) / current > 0.25;
}

/**
 * Fewer seeds than this and the pieces come mostly from other downloaders. Downloaders send to whoever sends to them (and a seed
 * does not care), so a small upload limit starves such a swarm.
 *
 * Measured (a local swarm: one 400 KB/s seed and three downloaders swapping pieces, 40 MB): with no upload limit all three finished in
 * 178 s; with 200 KB/s in 179, 239 and 217 s; with 50 KB/s one finished in 178 s and the other two had not finished after 260 s.
 * The owner's own torrent sat at 51 peers and 0 seeds for hours.
 */
export const SEEDS_THAT_FEED_THE_SWARM = 3;

/**
 * The overall upload limit, in KB/s, to apply right now. 0 means no limit.
 *
 * Only while something is actually being downloaded: when everything has finished and the person has chosen to keep seeding
 * (Settings › Torrents), the limit comes off, because then sharing is the point. It also stays off while the torrent has few or no
 * seeds (`seeds`, the fewest among what is downloading; null when not known): there, giving back is how the download gets its pieces.
 */
export function autoUploadCapKbps(downloadKBps: number, downloading: boolean, seeds: number | null = null): number {
  if (!downloading) return 0;
  if (seeds !== null && seeds < SEEDS_THAT_FEED_THE_SWARM) return 0;
  const wanted = Math.max(UPLOAD_FLOOR_KBPS, (Number.isFinite(downloadKBps) ? downloadKBps : 0) * UPLOAD_SHARE);
  // Steps of 10 KB/s so the limit is not rewritten on every tiny change in speed.
  return Math.round(wanted / 10) * 10;
}
