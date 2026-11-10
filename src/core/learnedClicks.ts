// What the person clicked when a download page needed them, remembered per site so the next page of that site needs nobody.
//
// The driver finds the download control by reading it. When it cannot (a host invents a new wording, an icon with no text), the page is
// handed to the person, who clicks the right thing. That click is the most reliable hint there is, so Lumina keeps a small description of the
// control (its tag, id, name, stable classes, text, role) and the next page of the same site looks for the same control, even if the host has
// moved it or restyled it. Only the description of a control is kept: no address, no page text, nothing typed.
import { z } from 'zod';

export const clickSignatureSchema = z.object({
  tag: z.string().max(20),
  id: z.string().max(80),
  name: z.string().max(80),
  classes: z.array(z.string().max(40)).max(8),
  text: z.string().max(80),
  role: z.string().max(30),
  type: z.string().max(30),
});
export type ClickSignature = z.infer<typeof clickSignatureSchema>;

/** Classes a page changes by itself (state, generated hashes) say nothing about which control this is. */
const UNSTABLE_CLASS = /^(?:active|hover|focus|focused|disabled|enabled|open|opened|show|shown|hide|hidden|loading|selected|current|ready|visible|in|on|off)$|\d{3,}|^[a-z]{0,3}[_-]?[a-f0-9]{6,}$/i;
export const stableClasses = (classes: readonly string[]): string[] =>
  classes.map((c) => c.trim()).filter((c) => c && c.length <= 40 && !UNSTABLE_CLASS.test(c)).slice(0, 8);

/** A signature as the page reports it, cleaned; null when it describes nothing usable. */
export function cleanSignature(raw: unknown): ClickSignature | null {
  const parsed = clickSignatureSchema.safeParse(raw);
  if (!parsed.success) return null;
  const s = parsed.data;
  const sig: ClickSignature = { ...s, classes: stableClasses(s.classes), text: s.text.replace(/\s+/g, ' ').trim().slice(0, 80) };
  // A control with no id, no name, no text and no stable class cannot be told from any other.
  if (!sig.id && !sig.name && !sig.text && !sig.classes.length) return null;
  // The check itself is the person's: never learn a click on it.
  if (/captcha|turnstile|cf-chl|hcaptcha|challenge/i.test(`${sig.id} ${sig.classes.join(' ')}`)) return null;
  return sig;
}

const MAX_PER_SITE = 5;
const MAX_AGE_MS = 180 * 24 * 3600 * 1000;
const sameSignature = (a: ClickSignature, b: ClickSignature) =>
  a.tag === b.tag && a.id === b.id && a.name === b.name && a.text.toLowerCase() === b.text.toLowerCase();

export interface LearnedEntry { sig: ClickSignature; at: number }

export class LearnedClicks {
  private readonly bySite = new Map<string, LearnedEntry[]>();

  /** Keep this control for `site`. The newest first; five at most; one that is already known moves to the front. */
  remember(site: string, raw: unknown, now: number): boolean {
    const sig = cleanSignature(raw);
    if (!sig || !site) return false;
    const rest = (this.bySite.get(site) ?? []).filter((e) => !sameSignature(e.sig, sig));
    this.bySite.set(site, [{ sig, at: now }, ...rest].slice(0, MAX_PER_SITE));
    return true;
  }

  recall(site: string, now: number): ClickSignature[] {
    const live = (this.bySite.get(site) ?? []).filter((e) => now - e.at < MAX_AGE_MS);
    if (live.length) this.bySite.set(site, live);
    else this.bySite.delete(site);
    return live.map((e) => e.sig);
  }

  forget(site?: string): void {
    if (site) this.bySite.delete(site);
    else this.bySite.clear();
  }

  toJSON(): Record<string, LearnedEntry[]> {
    return Object.fromEntries(this.bySite);
  }

  /** Load what was saved; anything that does not validate is dropped rather than trusted. */
  static fromJSON(raw: unknown): LearnedClicks {
    const out = new LearnedClicks();
    if (!raw || typeof raw !== 'object') return out;
    for (const [site, entries] of Object.entries(raw as Record<string, unknown>)) {
      if (!Array.isArray(entries)) continue;
      const kept = entries.flatMap((e): LearnedEntry[] => {
        const parsed = z.object({ sig: clickSignatureSchema, at: z.number() }).safeParse(e);
        const sig = parsed.success ? cleanSignature(parsed.data.sig) : null;
        return parsed.success && sig ? [{ sig, at: parsed.data.at }] : [];
      });
      if (kept.length) out.bySite.set(site, kept.slice(0, MAX_PER_SITE));
    }
    return out;
  }
}

/**
 * How well a control on the page matches a learned one, 0 to 1. Plain JavaScript in a string because it runs in the page (and, in
 * tests/learnedClicks.test.ts, in Node). `describe(el)` builds the signature the recorder stores. Defines `matchSignature(sig, el)`
 * and `describeControl(el)`.
 */
export const SIGNATURE_MATCHER = String.raw`
const UNSTABLE = /^(?:active|hover|focus|focused|disabled|enabled|open|opened|show|shown|hide|hidden|loading|selected|current|ready|visible|in|on|off)$|\d{3,}|^[a-z]{0,3}[_-]?[a-f0-9]{6,}$/i;
function describeControl(el) {
  const cls = typeof el.className === 'string' ? el.className.split(/\s+/) : [];
  return {
    tag: String(el.tagName || '').toLowerCase().slice(0, 20),
    id: String(el.id || '').slice(0, 80),
    name: String((el.getAttribute && el.getAttribute('name')) || '').slice(0, 80),
    classes: cls.filter((c) => c && c.length <= 40 && !UNSTABLE.test(c)).slice(0, 8),
    text: String(el.innerText || el.value || (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('title'))) || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    role: String((el.getAttribute && el.getAttribute('role')) || '').slice(0, 30),
    type: String((el.getAttribute && el.getAttribute('type')) || '').slice(0, 30),
  };
}
function matchSignature(sig, el) {
  // The cheap facts first: describing a control reads its text, which makes the browser lay the page out.
  if (!(sig.id && sig.id === String(el.id || '')) && !sig.text) return 0;
  const now = describeControl(el);
  const text = now.text.toLowerCase();
  let s = 0;
  if (sig.id && sig.id === now.id) s += 0.5;
  if (sig.name && sig.name === now.name) s += 0.2;
  if (sig.text && sig.text.toLowerCase() === text) s += 0.4;
  if (sig.tag === now.tag) s += 0.1;
  if (sig.role && sig.role === now.role) s += 0.05;
  if (sig.classes.length && now.classes.length) {
    const common = sig.classes.filter((c) => now.classes.indexOf(c) >= 0).length;
    if (common / Math.max(sig.classes.length, now.classes.length) >= 0.5) s += 0.2;
  }
  // The same words or the same id are required: a shared tag alone is every button on the page.
  if (!(sig.id && sig.id === now.id) && !(sig.text && sig.text.toLowerCase() === text)) return 0;
  return Math.min(1, s);
}
function matchById(sig, el) {
  return Boolean(sig.id) && sig.id === String(el.id || '');
}
`;

/** A learned control matches when this much of its description is found again. */
export const SIGNATURE_THRESHOLD = 0.5;
