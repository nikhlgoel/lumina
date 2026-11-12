// What went wrong with the items of a playlist that only partly downloaded, and what to do about each.
//
// A 438-song YouTube Music playlist finished with 331 songs and "105 item(s) could not be downloaded: The download engine stopped unexpectedly
// (code 1)". That sentence was the first error of 105, and a wrong one: it was yt-dlp's bundled accelerator (aria2c) failing on one song, dressed
// as the whole story. Measured on the failed items afterwards: some are really gone ("This video is not available"), most were refused with
// "Sign in to confirm you're not a bot" (YouTube limiting a client that has fetched hundreds of songs in half an hour, every item after position
// 381 included), and none was ever tried again. A playlist that mostly works should not end by shrugging at the rest. So: sort the failures by
// what can be done about them, try the recoverable ones again after a rest and more gently, and say plainly what is left and why.

export type FailureClass =
  /** Gone, private, blocked, for members, not live yet: asking again changes nothing. */
  | 'unavailable'
  /** The site is limiting this client ("not a bot", 429, 403): a pause helps, pressure makes it worse. */
  | 'throttled'
  /** The accelerator inside yt-dlp (aria2c) failed on this item; the plain downloader often manages the same file. */
  | 'accelerator'
  /** A dropped or slow connection, a 5xx: worth another go. */
  | 'transient'
  | 'other';

const AGE = /age[- ]?restrict|confirm your age|inappropriate for some users/i;
const UNAVAILABLE = /video unavailable|(?:this )?video is (?:not available|no longer available|unavailable)|is not available|private (?:video|playlist)|has been removed|removed by|account associated|terminated|copyright|members[- ]only|only available to|music premium|premium members|join this channel|premieres in|live event will begin|not available in your country|in your country|geo[- ]?restrict|blocked (?:it )?in your country|\bdrm\b|has been deleted|content isn.?t available|unavailable in your/i;
const THROTTLED = /not a bot|sign in to confirm|http error 429|too many requests|rate.?limit|http error 403|forbidden|requested too many/i;
const ACCELERATOR = /aria2c exited with code \d+|external downloader/i;
const TRANSIENT = /timed? ?out|connection (?:reset|aborted|refused|closed)|forcibly closed|temporarily|http error 5\d\d|unable to download (?:video data|webpage|json)|incomplete read|\beof\b|ssl|getaddrinfo|network is unreachable|remote end closed/i;

/** Sort one item's error text. The order matters: "confirm your age" mentions signing in but is not the bot check. */
export function classifyItemFailure(message: string): FailureClass {
  if (AGE.test(message)) return 'unavailable';
  if (THROTTLED.test(message)) return 'throttled';
  if (UNAVAILABLE.test(message)) return 'unavailable';
  if (ACCELERATOR.test(message)) return 'accelerator';
  if (TRANSIENT.test(message)) return 'transient';
  return 'other';
}

export const isRetryable = (c: FailureClass): boolean => c === 'throttled' || c === 'accelerator' || c === 'transient';

export interface ItemFailure {
  /** Position in the playlist (1-based), or null when the error could not be tied to an item. */
  index: number | null;
  message: string;
  cls: FailureClass;
}

/** The video id a yt-dlp error names, as "[youtube] AbCdEfGhIjK: …". */
export const videoIdIn = (message: string): string | null => /\[youtube(?::tab)?\]\s+([\w-]{11}):/i.exec(message)?.[1] ?? null;

/**
 * Which item an error belongs to: the one it names, else the one that was being fetched when it arrived.
 * `entries` maps video ids to playlist positions.
 */
export function attribute(message: string, current: number | null, entries: readonly { id?: string | null; index?: number | null }[]): ItemFailure {
  const id = videoIdIn(message);
  const named = id ? entries.find((e) => e.id === id)?.index ?? null : null;
  return { index: named ?? current, message, cls: classifyItemFailure(message) };
}

/** One failure per item (the last word on it wins), in playlist order; errors tied to no item are kept as they are. */
export function settle(failures: readonly ItemFailure[]): ItemFailure[] {
  const byIndex = new Map<number, ItemFailure>();
  const loose: ItemFailure[] = [];
  for (const f of failures) {
    if (f.index === null) loose.push(f);
    else byIndex.set(f.index, f);
  }
  return [...[...byIndex.values()].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)), ...loose];
}

export interface RetryStep {
  /** Playlist positions to try again. */
  indices: number[];
  /** How long to rest first. A site that is limiting a client needs the pressure off before anything else works. */
  cooldownMs: number;
}

const COOLDOWNS_MS = [90_000, 300_000];
export const MAX_RETRY_PASSES = COOLDOWNS_MS.length;

/**
 * What to try next. `pass` is how many retry passes have run; `recovered` is how many items the last one got through.
 * No more passes after the allowed number, and none after a pass that recovered nothing: if a rest did not help, another will not (the address
 * itself is being limited), and the person is better told than kept waiting.
 */
export function nextRetry(failures: readonly ItemFailure[], pass: number, recovered: number): RetryStep | null {
  if (pass >= MAX_RETRY_PASSES) return null;
  if (pass > 0 && recovered === 0) return null;
  const indices = failures.filter((f) => f.index !== null && isRetryable(f.cls)).map((f) => f.index as number);
  if (!indices.length) return null;
  return { indices: [...new Set(indices)].sort((a, b) => a - b), cooldownMs: COOLDOWNS_MS[pass] ?? COOLDOWNS_MS[COOLDOWNS_MS.length - 1] ?? 60_000 };
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The sentence a finished playlist shows: how many are missing and why, and what to do. Empty when nothing failed. */
export function failureSummary(total: number, failures: readonly ItemFailure[], recovered = 0): string {
  const n = failures.length;
  if (!n) return recovered ? `All ${total} downloaded (${count(recovered, 'item needed', 'items needed')} a second try).` : '';
  const by = (c: FailureClass) => failures.filter((f) => f.cls === c).length;
  const reasons: string[] = [];
  if (by('unavailable')) reasons.push(`${by('unavailable')} unavailable (removed, private or blocked)`);
  if (by('throttled')) reasons.push(`${by('throttled')} refused while the site was limiting downloads`);
  if (by('accelerator')) reasons.push(`${by('accelerator')} failed in the fast downloader`);
  if (by('transient')) reasons.push(`${by('transient')} lost the connection`);
  if (by('other')) reasons.push(`${by('other')} failed for other reasons`);
  let text = `${n} of ${total} could not be downloaded: ${reasons.join(', ')}.`;
  if (recovered) text += ` ${count(recovered, 'item was', 'items were')} recovered on a second try.`;
  const retryable = failures.filter((f) => isRetryable(f.cls)).length;
  if (retryable) {
    text += by('throttled')
      ? ' The site is limiting this connection: press Retry in an hour to fetch only the missing ones, or sign in under Settings › Accounts.'
      : ' Press Retry to fetch only the missing ones.';
  }
  return text;
}
