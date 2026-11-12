/**
 * Torrent choices that are better offered as a few named options than as raw numbers, and the checks that keep a downloaded
 * tracker list from being used to point the download engine at the person's own machine or network.
 *
 * Why presets: nobody picks fewer peers on purpose, and "ratio" and "minutes" do not mean what they look like they mean in aria2.
 * Measured against the bundled aria2 1.37.0 (a finished torrent, no peers):
 *   - `--seed-time=0` ends seeding at once, whatever `--seed-ratio` says ("Seeding is over."), so a ratio with no time limit is silently ignored;
 *   - `--seed-time=1` keeps seeding (and `--seed-ratio=0` then means "no ratio target"), ending at the time or the ratio, whichever comes first.
 * So the sharing choices below always set both numbers, and anything stored that cannot do what its two fields suggest is shown as what it does.
 */

export interface PeerPreset { id: 'balanced' | 'fast' | 'maximum'; label: string; peers: number; hint: string }

/** Connections per torrent. aria2's own default is 55; past about a hundred a home connection is already full and more peers only cost memory in the router. */
export const PEER_PRESETS: readonly PeerPreset[] = [
  { id: 'balanced', label: 'Balanced', peers: 60, hint: 'Light on older routers and Wi-Fi' },
  { id: 'fast', label: 'Fast', peers: 120, hint: 'Best for most connections' },
  { id: 'maximum', label: 'Maximum', peers: 250, hint: 'For very fast connections; some routers struggle' },
];

export const DEFAULT_PEERS = 120;

/** The preset a stored number is, or null when it is some other number (an imported setting, say). */
export function peerPresetOf(peers: number): PeerPreset | null {
  return PEER_PRESETS.find((p) => p.peers === peers) ?? null;
}

export interface SeedPreset { id: 'stop' | 'little' | 'fair' | 'long'; label: string; ratio: number; minutes: number; hint: string }

export const SEED_PRESETS: readonly SeedPreset[] = [
  { id: 'stop', label: 'Stop', ratio: 0, minutes: 0, hint: 'Nothing is uploaded once the download finishes' },
  { id: 'little', label: 'A little', ratio: 1, minutes: 120, hint: 'Share until you have given back what you took, or 2 hours' },
  { id: 'fair', label: 'Fair share', ratio: 2, minutes: 1440, hint: 'Share until you have given back twice what you took, or a day' },
  { id: 'long', label: 'Keep sharing', ratio: 0, minutes: 10_080, hint: 'Share for up to a week while Lumina is open' },
];

/** What the engine will really do with a ratio and a time: it never seeds with a time of 0, whatever the ratio is. */
export function effectiveSeeding(ratio: number, minutes: number): { ratio: number; minutes: number } {
  return minutes > 0 ? { ratio, minutes } : { ratio: 0, minutes: 0 };
}

export function seedPresetOf(ratio: number, minutes: number): SeedPreset | null {
  const e = effectiveSeeding(ratio, minutes);
  return SEED_PRESETS.find((p) => p.ratio === e.ratio && p.minutes === e.minutes) ?? null;
}

/** A plain sentence for what the two numbers do, for a stored value that is none of the presets. */
export function describeSeeding(ratio: number, minutes: number): string {
  const e = effectiveSeeding(ratio, minutes);
  if (e.minutes === 0) return 'Stops sharing as soon as the download finishes.';
  const time = e.minutes % 60 === 0 ? `${e.minutes / 60} hour${e.minutes === 60 ? '' : 's'}` : `${e.minutes} minutes`;
  return e.ratio > 0 ? `Shares until you have given back ${e.ratio}× what you took, or ${time}, whichever comes first.` : `Shares for up to ${time}.`;
}

// ---- tracker lists ----

export const MAX_TRACKERS = 60;
const MAX_TRACKER_LENGTH = 200;
const SCHEMES = new Set(['udp:', 'http:', 'https:', 'ws:', 'wss:']);

/** True for an address that only means something on this machine or its own network: a tracker there is a way to make the engine knock on local doors. */
export function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan') || (!h.includes('.') && !h.includes(':'))) return true;
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (h.includes(':')) return h === '::' || h === '::1' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith('::ffff:');
  return false;
}

/** One tracker address, cleaned, or null when it is not a usable public tracker. */
export function cleanTracker(raw: string): string | null {
  const text = raw.trim();
  if (!text || text.length > MAX_TRACKER_LENGTH || /[\s,]/.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (!SCHEMES.has(url.protocol) || url.username || url.password || isLocalHost(url.hostname)) return null;
  return text;
}

/** The usable, distinct tracker addresses in a block of text (one per line, or separated by any space), at most `limit`. */
export function sanitizeTrackers(text: string, limit = MAX_TRACKERS): string[] {
  const seen = new Set<string>();
  for (const token of text.split(/\s+/)) {
    const ok = cleanTracker(token);
    if (ok) seen.add(ok);
    if (seen.size >= limit) break;
  }
  return [...seen];
}
