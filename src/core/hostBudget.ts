// How much of one file host Lumina may use at once.
//
// Some hosts drop or refuse a client that opens many connections. Measured against Pixeldrain from one machine, one-byte requests in parallel:
// 16 at once: 9 got no answer; 48 at once: 14 got no answer and 14 were refused with a 403. Lumina's defaults (8 files, 16 connections each)
// open far more than that, and the connections were dropped ("connection forcibly closed"). So a host gets a budget: how many of its files run together, and how many connections each may use.
//
// Known hosts have one from the start. Any other host keeps the person's settings until something that looks like throttling happens on it,
// then it is held to the strict budget for a while: the first failure is the lesson, not a permanent change.
import { siteOf } from './hosts';

export interface HostBudget {
  /** Files from this host downloading at the same time. */
  files: number;
  /** Connections each of them may open. */
  connections: number;
}

const STRICT: HostBudget = { files: 1, connections: 4 };

/** Measured, not guessed: see the note at the top. Add a host here only with a measurement behind it. */
const KNOWN: Readonly<Record<string, HostBudget>> = {
  'pixeldrain.com': STRICT,
  'pixeldra.in': STRICT,
};

const TROUBLE_WINDOW_MS = 20 * 60_000;

/** Messages that mean "this host is limiting us" (as opposed to "this file is gone"). */
const THROTTLE_SIGN = /forcibly closed|connection (?:reset|aborted)|handshake|econnreset|too many|\b429\b|rate.?limit/i;
export const looksLikeThrottle = (message: string | null | undefined): boolean => THROTTLE_SIGN.test(message ?? '');

/** The site a link belongs to, or null for something that is not a web address (a magnet link, a local file). */
export function hostOfUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? siteOf(u.hostname) : null;
  } catch {
    return null;
  }
}

export class HostBudgets {
  private readonly trouble = new Map<string, number[]>();

  /** A download from `site` failed in a way that looks like throttling. */
  noteTrouble(site: string, now: number): void {
    const recent = (this.trouble.get(site) ?? []).filter((t) => now - t < TROUBLE_WINDOW_MS);
    this.trouble.set(site, [...recent, now]);
  }

  /** What `site` may use: the person's own settings, held down by what is known about the host and what has happened with it lately. */
  budget(site: string | null, wanted: HostBudget, now: number): HostBudget {
    if (!site) return wanted;
    const limits = [KNOWN[site]];
    if ((this.trouble.get(site) ?? []).some((t) => now - t < TROUBLE_WINDOW_MS)) limits.push(STRICT);
    return limits.reduce<HostBudget>((b, l) => (l ? { files: Math.min(b.files, l.files), connections: Math.min(b.connections, l.connections) } : b), wanted);
  }

  clear(): void {
    this.trouble.clear();
  }
}
