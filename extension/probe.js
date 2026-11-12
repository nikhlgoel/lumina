// Finding out which episodes of a series have a video, by opening each one the way a person would.
//
// A list of episodes says which exist, not which can be played: a new series lists twelve and has six. Each episode's page is opened in a
// background tab (muted, never shown), the player is given a nudge to start, and the browser's own record of what the page requested (the
// same one the popup's "found on this page" list is made from) says whether a stream or a video file turned up. The tab is closed again.
//
// This file holds the decisions and the order of steps, with every browser call passed in, so tests can run it against a fake browser.

// Hosts and words that mark an advert's own video; a pre-roll is not the episode.
const AD_HOST = /(?:doubleclick|googlesyndication|googleadservices|adservice|adsystem|adnxs|adsrvr|taboola|outbrain|popads|popcash|exoclick|juicyads|trafficjunky|propellerads|adcash|imasdk|moatads|vast\.)/i;
const AD_PATH = /(?:^|[\/_.-])(?:preroll|pre-roll|midroll|advert|adserver|vast|vmap)(?:[\/_.-]|$)/i;
const PLAYLIST_NAME = /(?:master|index|playlist|manifest)\.(?:m3u8|mpd)/i;

/** One detected request as a score: higher is more likely to be the episode itself. null for something that is not it. */
export function scoreVideo(item) {
  let host = '';
  let path = '';
  try {
    const u = new URL(item.url);
    host = u.hostname;
    path = u.pathname;
  } catch {
    return null;
  }
  if (AD_HOST.test(host) || AD_PATH.test(path)) return null;
  if (item.kind === 'stream') return 100 + (PLAYLIST_NAME.test(path) ? 20 : 0);
  if (item.kind === 'media') return 50 + Math.min(40, Math.log10(Math.max(1, item.sizeBytes ?? 0)) * 4);
  return null;
}

/** The detected request that is most likely the episode: a stream's main playlist first, then the biggest file. null when nothing qualifies. */
export function pickVideo(items = []) {
  let best = null;
  let bestScore = -1;
  for (const item of items) {
    const score = scoreVideo(item);
    if (score === null) continue;
    // Equal scores: the earlier one (the list is newest first), since a page asks for its own player before anything it loads later.
    if (score > bestScore || (score === bestScore && (item.time ?? 0) < (best?.time ?? Infinity))) {
      best = item;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Open one episode and wait for its video.
 * `deps`: open(url) -> tab id, close(id), found(id) -> detected requests, nudge(id) (try to start the player), sleep(ms), now().
 * Resolves the detected request, or null when none turned up within `timeoutMs`.
 */
export async function probeEpisode(url, deps, { timeoutMs = 25_000, settleMs = 1500, firstNudgeAt = 2500, nudgeEvery = 3000, pollMs = 500 } = {}) {
  const tab = await deps.open(url);
  try {
    const start = deps.now();
    let nudges = 0;
    let firstSeen = 0;
    while (deps.now() - start < timeoutMs) {
      await deps.sleep(pollMs);
      const best = pickVideo(await deps.found(tab));
      if (best) {
        firstSeen ||= deps.now();
        // A moment longer: a page's own player is told apart from an advert's by what else turns up in that time.
        if (deps.now() - firstSeen >= settleMs) return pickVideo(await deps.found(tab)) ?? best;
      } else if (deps.now() - start >= firstNudgeAt + nudges * nudgeEvery) {
        nudges++;
        await deps.nudge(tab).catch(() => undefined);
      }
    }
    return pickVideo(await deps.found(tab));
  } finally {
    await deps.close(tab).catch(() => undefined);
  }
}

/**
 * Check a list of episodes, a few at a time. `onUpdate(index, state)` is called as each changes: { status: 'checking' } while it is being
 * opened, then { status: 'found', video } , { status: 'none' } or { status: 'error', reason }. `shouldStop()` ends it early (the rest are left
 * as they were). Episodes that already have an answer (`known[index]`, the one being watched, say) are not opened.
 */
export async function probeEpisodes(episodes, deps, { concurrency = 2, known = {}, onUpdate = () => undefined, shouldStop = () => false, ...opts } = {}) {
  const results = new Array(episodes.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (!shouldStop()) {
      const i = next++;
      if (i >= episodes.length) return;
      if (known[i]) {
        results[i] = { status: 'found', video: known[i] };
        onUpdate(i, results[i]);
        continue;
      }
      onUpdate(i, { status: 'checking' });
      try {
        const video = await probeEpisode(episodes[i].url, deps, opts);
        results[i] = video ? { status: 'found', video } : { status: 'none' };
      } catch (err) {
        results[i] = { status: 'error', reason: String(err?.message ?? err).slice(0, 160) };
      }
      onUpdate(i, results[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, episodes.length)) }, worker));
  return results;
}
