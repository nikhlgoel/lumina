// The shield, attached to the browser's session.
//
// Everything that decides *whether* something is blocked lives in `src/core/shields.ts` and is
// tested there. This file is the part that cannot be: Electron's request interception, the CSS
// injection, the counters, and turning the shield off for one site.
//
// Two things are deliberate and worth stating:
//
//  * Blocking happens in `onBeforeRequest`, which is before the connection is made. A blocked
//    tracker is not fetched and discarded; it never leaves the machine. That is the difference
//    between blocking an ad and hiding one.
//  * Per-site "shields down" is kept in memory only. It is an escape hatch for a page that breaks,
//    not a permission to be granted once and forgotten about.
import { session, type Session } from 'electron';
import { EventEmitter } from 'node:events';
import {
  buildShieldEngine, hostnameOf, shouldUpgradeToHttps,
  type ResourceType, type ShieldEngine,
} from '../../core/shields';
import type { ShieldCounts, ShieldStatus } from '../../shared/types';
import { settings } from '../settings';
import { logger } from '../log';
import { loadLists, refreshLists } from './lists';

const log = logger('shields');


export const shieldEvents = new EventEmitter<{ changed: [ShieldStatus] }>();

let engine: ShieldEngine | null = null;
let attached = false;
/** Sites the person has turned the shield off for, this run only. */
const disabledSites = new Set<string>();
/** Hosts where https did not work, so the upgrade is not retried for them. */
const httpsFailed = new Set<string>();

let currentHost: string | null = null;
let counts: ShieldCounts = { ads: 0, trackers: 0, upgraded: 0 };
const recent: { url: string; rule: string }[] = [];

const emptyCounts = (): ShieldCounts => ({ ads: 0, trackers: 0, upgraded: 0 });

/** Privacy rules name themselves; everything else is counted as an ad. Rough, but honest enough. */
const isTrackerRule = (rule: string) => /analytic|track|telemetry|metric|pixel|beacon|stat|collect/i.test(rule);

export function shieldStats(): ShieldStatus {
  const s = settings.get().browser;
  return {
    enabled: s.shieldsEnabled,
    siteEnabled: !(currentHost && disabledSites.has(currentHost)),
    hostname: currentHost,
    counts: { ...counts },
    ruleCount: engine?.networkRuleCount ?? 0,
    recent: recent.slice(0, 20),
  };
}

const publish = () => shieldEvents.emit('changed', shieldStats());

/** Start counting again for a new page. */
export function startPage(url: string) {
  const host = hostnameOf(url);
  if (host === currentHost) return;
  currentHost = host;
  counts = emptyCounts();
  recent.length = 0;
  publish();
}

export function setSiteShields(enabled: boolean) {
  if (!currentHost) return;
  if (enabled) disabledSites.delete(currentHost);
  else disabledSites.add(currentHost);
  publish();
}

function rebuild(): void {
  const s = settings.get().browser;
  const { texts, cached, missing } = loadLists(s.shieldLists);
  engine = buildShieldEngine(texts);
  log.info('Shield rules loaded', {
    networkRules: engine.networkRuleCount,
    cosmeticRules: engine.cosmeticRuleCount,
    cached,
    // Said plainly rather than hidden: with nothing cached, the built-in list is all there is.
    missing,
  });
  publish();
}

export async function refreshShieldLists(force = false): Promise<void> {
  const s = settings.get().browser;
  if (!s.shieldsEnabled) return;
  if (await refreshLists(s.shieldLists, force)) rebuild();
}

/** The CSS that hides what the lists call ads on this page. Empty when the shield is off. */
export function cosmeticCssFor(url: string): string {
  const s = settings.get().browser;
  if (!s.shieldsEnabled || !s.hideAdSpace || !engine) return '';
  const host = hostnameOf(url);
  if (!host || disabledSites.has(host)) return '';
  return engine.cosmeticCss(host);
}

/** Electron's resourceType strings are already our ResourceType, bar the ones it does not name. */
const asResourceType = (type: string): ResourceType => {
  switch (type) {
    case 'mainFrame': case 'subFrame': case 'stylesheet': case 'script': case 'image':
    case 'font': case 'object': case 'xhr': case 'ping': case 'cspReport': case 'media':
    case 'webSocket':
      return type;
    default: return 'other';
  }
};

/**
 * Attach the shield to the browser session.
 *
 * Safe to call more than once; the handler is installed only the first time, and settings are read
 * on every request, so toggling the shield takes effect immediately rather than at the next start.
 */
export function initShields(target?: Session): void {
  const sess = target ?? session.fromPartition('persist:browser');
  if (!engine) rebuild();
  if (attached) return;
  attached = true;

  sess.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    const s = settings.get().browser;
    if (!s.shieldsEnabled || !engine) return callback({});

    const type = asResourceType(details.resourceType);

    // A top-level navigation defines the page, so the counters reset here rather than waiting for
    // the renderer to say where we went.
    if (type === 'mainFrame') startPage(details.url);

    const sourceHost = currentHost;
    if (sourceHost && disabledSites.has(sourceHost)) return callback({});

    if (s.httpsUpgrade) {
      const upgraded = shouldUpgradeToHttps(details.url, httpsFailed);
      if (upgraded) {
        counts.upgraded += 1;
        publish();
        return callback({ redirectURL: upgraded });
      }
    }

    // Never block the page the person asked for. A list that matches a top-level URL would
    // otherwise leave them at an error page with no way to tell what happened.
    if (type === 'mainFrame') return callback({});

    const verdict = engine.match({ url: details.url, sourceHostname: sourceHost, type });
    if (!verdict.blocked) return callback({});

    if (isTrackerRule(verdict.rule ?? '')) counts.trackers += 1;
    else counts.ads += 1;
    if (verdict.rule) {
      recent.unshift({ url: details.url, rule: verdict.rule });
      recent.length = Math.min(recent.length, 50);
    }
    publish();
    return callback({ cancel: true });
  });

  // An https upgrade that fails has to be remembered, or the site becomes unreachable for good.
  sess.webRequest.onErrorOccurred({ urls: ['<all_urls>'] }, (details) => {
    if (details.resourceType !== 'mainFrame') return;
    const host = hostnameOf(details.url);
    if (host && details.url.startsWith('https://') && /ERR_(SSL|CERT|CONNECTION_REFUSED|CONNECTION_CLOSED|ADDRESS_UNREACHABLE)/.test(details.error)) {
      httpsFailed.add(host);
      log.debug(`https did not work for ${host} (${details.error}); it will be left on http`);
    }
  });

  void refreshShieldLists().catch(() => undefined);
}
