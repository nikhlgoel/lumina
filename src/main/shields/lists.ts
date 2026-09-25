// Where the filter rules come from.
//
// Three sources, in order of how much they can be relied on:
//
//  1. A built-in list, compiled into the app. Small, hand-kept, and enough that the shield is never
//     completely off — a first run with no network still blocks the large ad and tracking networks.
//  2. Cached copies of the public lists, in userData. This is what is normally used.
//  3. A refresh from the network, weekly, written to the cache.
//
// The ordering matters: a shield that only works once it has downloaded something is a shield that
// silently does nothing on a first run, on a metered connection, or behind a captive portal.
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from '../paths';
import { logger } from '../log';

const log = logger('shields');

export interface ListSource {
  name: string;
  url: string;
  /** What it is for, shown in Settings so the choice is not a mystery. */
  label: string;
}

/**
 * The public lists. EasyList and EasyPrivacy are the ones every blocker builds on; the others cover
 * the categories the request named specifically — malware hosts, and the cookie-consent nagging
 * that is technically neither an ad nor a tracker.
 */
export const LIST_SOURCES: ListSource[] = [
  { name: 'easylist', url: 'https://easylist.to/easylist/easylist.txt', label: 'Ads' },
  { name: 'easyprivacy', url: 'https://easylist.to/easylist/easyprivacy.txt', label: 'Trackers' },
  { name: 'malware', url: 'https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-online.txt', label: 'Malware and phishing' },
  { name: 'annoyances', url: 'https://easylist.to/easylist/fanboy-annoyance.txt', label: 'Pop-ups and cookie banners' },
];

/** A week. The public lists change daily, but not in ways worth spending a request a day on. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const shieldsDir = () => {
  const dir = path.join(dataDir(), 'shields');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const listFile = (name: string) => path.join(shieldsDir(), `${name}.txt`);
const metaFile = () => path.join(shieldsDir(), 'meta.json');

interface ListMeta { fetchedAt: number; rules: number }

function readMeta(): Record<string, ListMeta> {
  try {
    return JSON.parse(fs.readFileSync(metaFile(), 'utf8')) as Record<string, ListMeta>;
  } catch {
    return {};
  }
}

function writeMeta(meta: Record<string, ListMeta>) {
  try {
    fs.writeFileSync(metaFile(), JSON.stringify(meta, null, 2), 'utf8');
  } catch (err) {
    log.debug(`Could not record list metadata: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * The rules that ship inside the app.
 *
 * Deliberately short. It is a floor, not a replacement for the real lists: the largest ad exchanges,
 * the analytics endpoints on nearly every page, and a few malware and cryptomining patterns. The
 * exceptions at the end are there because blocking them breaks sign-in and payment on sites people
 * actually use, and a blocker that breaks those gets switched off entirely.
 */
export const BUILT_IN_RULES = `
! Lumina built-in shield rules — a floor for the first run and for offline use.
||doubleclick.net^
||googlesyndication.com^
||googleadservices.com^
||google-analytics.com^
||googletagmanager.com^$third-party
||googletagservices.com^
||adservice.google.com^
||adnxs.com^
||adsrvr.org^
||rubiconproject.com^
||pubmatic.com^
||openx.net^
||criteo.com^
||criteo.net^
||taboola.com^
||outbrain.com^
||zedo.com^
||adcolony.com^
||applovin.com^
||scorecardresearch.com^
||quantserve.com^
||moatads.com^
||amazon-adsystem.com^
||connect.facebook.net^$third-party
||hotjar.com^$third-party
||mouseflow.com^$third-party
||fullstory.com^$third-party
||segment.io^$third-party
||mixpanel.com^$third-party
||branch.io^$third-party
||onesignal.com^$third-party
||pushcrew.com^
||propellerads.com^
||popads.net^
||popcash.net^
||adf.ly^
||coinhive.com^
||coin-hive.com^
||cryptoloot.pro^
||webminepool.com^
/adsbygoogle.js
! Sign-in and payment flows people actually need, unblocked.
@@||accounts.google.com^
@@||appleid.apple.com^
@@||login.microsoftonline.com^
@@||js.stripe.com^
@@||checkout.stripe.com^
@@||challenges.cloudflare.com^
`;

export interface LoadedLists {
  /** Filter text, built-in first. */
  texts: string[];
  /** Which named lists were read from the cache. */
  cached: string[];
  /** Lists that are enabled but have never been downloaded. */
  missing: string[];
}

/** Read whatever is on disk right now. Never fails: the built-in rules are always included. */
export function loadLists(enabled: readonly string[]): LoadedLists {
  const texts = [BUILT_IN_RULES];
  const cached: string[] = [];
  const missing: string[] = [];
  for (const source of LIST_SOURCES) {
    if (!enabled.includes(source.name)) continue;
    try {
      const text = fs.readFileSync(listFile(source.name), 'utf8');
      if (text.trim()) {
        texts.push(text);
        cached.push(source.name);
        continue;
      }
    } catch {
      // Not downloaded yet, or unreadable.
    }
    missing.push(source.name);
  }
  return { texts, cached, missing };
}

const isStale = (name: string, meta: Record<string, ListMeta>) =>
  !meta[name] || Date.now() - meta[name]!.fetchedAt > MAX_AGE_MS;

/**
 * Fetch any enabled list that is missing or stale.
 *
 * Returns true when something changed, so the caller knows to rebuild the engine. A failed fetch is
 * logged and skipped — the cached copy, or the built-in rules, keep working.
 */
export async function refreshLists(enabled: readonly string[], force = false): Promise<boolean> {
  const meta = readMeta();
  let changed = false;
  for (const source of LIST_SOURCES) {
    if (!enabled.includes(source.name)) continue;
    if (!force && !isStale(source.name, meta) && fs.existsSync(listFile(source.name))) continue;
    try {
      const res = await fetch(source.url, { signal: AbortSignal.timeout(45_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      // A truncated response or an error page would otherwise replace a good list with nothing.
      if (text.length < 1000) throw new Error(`suspiciously short (${text.length} bytes)`);
      fs.writeFileSync(listFile(source.name), text, 'utf8');
      meta[source.name] = { fetchedAt: Date.now(), rules: text.split('\n').length };
      changed = true;
      log.info(`Updated ${source.name}`, { lines: meta[source.name]!.rules });
    } catch (err) {
      log.warn(`Could not update ${source.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (changed) writeMeta(meta);
  return changed;
}

/** When each list was last downloaded, for Settings. */
export function listStatus(): { name: string; label: string; fetchedAt: number | null; rules: number | null }[] {
  const meta = readMeta();
  return LIST_SOURCES.map((s) => ({
    name: s.name,
    label: s.label,
    fetchedAt: meta[s.name]?.fetchedAt ?? null,
    rules: meta[s.name]?.rules ?? null,
  }));
}
