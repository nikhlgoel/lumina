// Resolves file-host links (download pages with buttons, countdowns and sometimes a captcha) to the real
// file URL, the way a person would: a hidden, sandboxed page clicks through and the browser's own download
// request is caught, cancelled and handed to aria2 with the same cookies.
//
// Each page runs in its own hidden, borderless window (hidden pages still take input there). When a page
// needs a person (captcha or a page Lumina can't finish), that same live window is attached to Lumina and laid
// exactly over the "Quick check" panel, so nothing reloads and the page keeps its state and cookies. It
// follows Lumina's window and disappears on its own once the download starts.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { app, BrowserWindow, Notification, session, type Session, type WebContents } from 'electron';
import type { CapturedCookie, HostChallenge, RequestInfo } from '../shared/types';
import { pageDriver } from '../core/hostsDriver';
import { siteOf, type PageScan } from '../core/hosts';
import { LearnedClicks } from '../core/learnedClicks';
import { ClearanceJar, clearanceSite } from '../core/clearance';
import { appIconPath } from './paths';
import { mainWindow, showWindow } from './window';
import { logger } from './log';

const log = logger('hosters');

// Not persisted: nothing from a download page outlives it.
const PARTITION_PREFIX = 'lumina-host-';
/** Pages driven at once; hosts rate-limit free downloads per IP, so more rarely helps. */
const MAX_PARALLEL = 3;
const TICK_MS = 700;
/** No click, countdown or navigation for this long means the page needs a person. */
const STALL_MS = !app.isPackaged && Number(process.env.LUMINA_STALL_MS) > 0 ? Number(process.env.LUMINA_STALL_MS) : 60_000;
const HEADLESS_LIMIT_MS = 180_000;
const INTERACTIVE_LIMIT_MS = 15 * 60_000;
const PAGE_SIZE = { width: 1280, height: 860 };

export interface ResolvedLink {
  url: string;
  filename: string;
  sizeBytes: number | null;
  request: RequestInfo;
}

export interface ResolveOptions {
  signal: AbortSignal;
  onStage: (stage: string) => void;
  /** Show the page to the person when it needs a captcha or gets stuck (default true). */
  interactive?: boolean;
  /** File name shown when a person has to help. */
  label?: string;
}

interface CaughtDownload {
  url: string;
  filename: string;
  totalBytes: number;
}
const downloadWaiters = new Map<number, (item: CaughtDownload) => void>();

/** Test and UI hooks: a page was handed to the person / finished. */
export const challengeEvents = new EventEmitter<{ shown: [WebContents, HostChallenge]; placed: [HostChallenge]; done: [string] }>();

function browserUserAgent(): string {
  // Look like the Chrome this Electron is built on; some hosts refuse unknown browsers.
  return app.userAgentFallback.replace(/\s(?:Electron|lumina|Lumina)\/\S+/g, '');
}

/** Notorious pop-under / redirect / malvertising networks seen on file-host pages. Cloudflare and the host itself are never here. */
const AD_HOSTS = /(^|\.)(doubleclick\.net|googlesyndication\.com|googleadservices\.com|adnxs\.com|popads\.net|popcash\.net|propellerads\.com|propelrads\.com|adsterra\.com|hilltopads\.net|hilltopads\.com|onclckds\.com|onclickalgo\.com|onclickmax\.com|clickadu\.com|poptm\.com|popunder\.net|adcash\.com|exoclick\.com|exosrv\.com|juicyads\.com|trafficjunky\.net|admaven\.com|admetrics\.io|mgid\.com|revcontent\.com|taboola\.com|outbrain\.com|adsterracdn\.com|highperformanceformat\.com|profitableratecpm\.com|effectiveratecpm\.com|displaycontentnetwork\.com|luckypushh?\.com|pushwhy\.com|datsprings\.com|bebi\.com|a-ads\.com)$/i;

/**
 * A fresh, in-memory cookie jar per download page. Hosts keep the file being downloaded in a cookie
 * (e.g. `file_code`), so pages sharing a jar overwrite each other and hand out the wrong file.
 */
function pageSession(): { s: Session; partition: string } {
  const partition = `${PARTITION_PREFIX}${randomUUID()}`;
  const s = session.fromPartition(partition, { cache: false });
  s.setUserAgent(browserUserAgent());
  s.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  s.setPermissionCheckHandler(() => false);
  // Block the pop-under / redirect / malvertising networks that infest file-host pages, so the real page (and any
  // human check) loads cleanly and can't be hijacked away. The host's own scripts and Cloudflare are never touched.
  s.webRequest.onBeforeRequest((details, cb) => {
    let host = '';
    try {
      host = new URL(details.url).hostname;
    } catch {
      // data:/blob: and similar — let them through
    }
    cb({ cancel: Boolean(host) && AD_HOSTS.test(host) });
  });
  s.on('will-download', (event, item, wc) => {
    const waiter = wc ? downloadWaiters.get(wc.id) : undefined;
    if (waiter) {
      // Read everything now: cancelling destroys the item.
      const chain = item.getURLChain();
      waiter({ url: chain[chain.length - 1] ?? item.getURL(), filename: item.getFilename(), totalBytes: item.getTotalBytes() });
    }
    // Lumina downloads the file with aria2 (many connections, resumable); the browser copy is not needed.
    event.preventDefault();
  });
  return { s, partition };
}

/**
 * Checks the person has solved, by site, in memory only. A page's jar is fresh (see pageSession), so without this a release of fifty parts
 * asked for the same check fifty times. Only the "this visitor passed" cookies are kept, never the per-file ones (core/clearance.ts).
 */
const clearances = new ClearanceJar();

/* ---------- learned clicks: what the person clicked when a page needed them, per site, so the next page of that site needs nobody ---------- */

let learnedStore: LearnedClicks | null = null;
const learnedFile = () => path.join(app.getPath('userData'), 'learned-clicks.json');
function learnedClicks(): LearnedClicks {
  if (!learnedStore) {
    try {
      learnedStore = LearnedClicks.fromJSON(JSON.parse(fs.readFileSync(learnedFile(), 'utf8')));
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') log.warn(`The learned clicks file could not be read; starting empty: ${err}`);
      learnedStore = new LearnedClicks();
    }
  }
  return learnedStore;
}
function saveLearnedClicks() {
  try {
    const file = learnedFile();
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(learnedClicks().toJSON()));
    fs.renameSync(`${file}.tmp`, file);
  } catch (err) {
    log.debug(`Could not save the learned clicks: ${err}`);
  }
}
/** What has been learned for a site (the self-test reads it). */
export const learnedFor = (site: string) => learnedClicks().recall(site, Date.now());

/** Forget what was learned from the person's clicks, for one site or all of them. */
export function forgetLearnedClicks(site?: string): void {
  learnedClicks().forget(site);
  saveLearnedClicks();
}

/** Let go of the checks remembered so far: for one site, or all of them. */
export function forgetSolvedChecks(site?: string): void {
  if (site) clearances.forget(site);
  else clearances.clear();
}

/** Put the proof of an earlier solved check into a new page's jar. Returns how many cookies went in. */
async function applyClearance(s: Session, site: string): Promise<number> {
  let put = 0;
  for (const c of clearances.recall(site, Date.now())) {
    try {
      await s.cookies.set({
        url: `${c.secure ? 'https' : 'http'}://${c.domain.replace(/^\./, '')}${c.path}`, name: c.name, value: c.value,
        // A cookie the site set for its own name only (no leading dot) must go back the same way; naming a domain would widen it.
        ...(c.domain.startsWith('.') ? { domain: c.domain } : {}),
        path: c.path, secure: c.secure, httpOnly: c.httpOnly, ...(c.expirationDate ? { expirationDate: c.expirationDate } : {}),
      });
      put++;
    } catch (err) {
      log.debug(`Could not reuse a solved check on ${site}: ${err}`);
    }
  }
  return put;
}

/** One hidden window per page: stacked pages in one window would swallow each other's clicks. */
function pageWindow(partition: string): BrowserWindow {
  return new BrowserWindow({
    show: false, frame: false, ...PAGE_SIZE, skipTaskbar: true, resizable: false, minimizable: false, maximizable: false,
    fullscreenable: false, hasShadow: false, backgroundColor: '#ffffff', title: 'Lumina download page', icon: appIconPath(),
    webPreferences: {
      partition, sandbox: true, contextIsolation: true, nodeIntegration: false,
      backgroundThrottling: false, spellcheck: false, disableDialogs: true, safeDialogs: true,
    },
  });
}

/* ---------- concurrency ---------- */

let running = 0;
const slotQueue: (() => void)[] = [];
async function acquire(signal: AbortSignal): Promise<() => void> {
  if (running >= MAX_PARALLEL) {
    await new Promise<void>((resolve, reject) => {
      const go = () => resolve();
      slotQueue.push(go);
      signal.addEventListener('abort', () => {
        const i = slotQueue.indexOf(go);
        if (i >= 0) slotQueue.splice(i, 1);
        reject(new Error('Cancelled'));
      }, { once: true });
    });
  }
  running++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    running--;
    slotQueue.shift()?.();
  };
}

/* ---------- quick checks: pages shown to the person inside Lumina ---------- */

interface ActiveChallenge {
  info: HostChallenge;
  page: BrowserWindow;
  main: BrowserWindow;
  frame: { x: number; y: number; width: number; height: number } | null;
  skip: () => void;
  unfollow: () => void;
}

/** A page blocked behind the active quick check: `resume` gives it its turn; `skip` makes it give up its file. */
interface WaitingTurn {
  resume: () => void;
  skip: () => void;
}

let active: ActiveChallenge | null = null;
/** Pages waiting for the person, in order. */
const waitingTurns: WaitingTurn[] = [];

function sendChallenge(c: ActiveChallenge) {
  if (!c.main.isDestroyed()) c.main.webContents.send('hosts:challenge', { ...c.info, waiting: waitingTurns.length });
}

/** Lay the page window over the panel's frame, in screen coordinates. */
function placePage(c: ActiveChallenge) {
  if (QUIET || !c.frame || c.page.isDestroyed() || c.main.isDestroyed()) return;
  if (c.main.isMinimized() || !c.main.isVisible()) {
    c.page.hide();
    return;
  }
  const content = c.main.getContentBounds();
  const zoom = c.main.webContents.getZoomFactor();
  const bounds = {
    x: Math.round(content.x + c.frame.x * zoom), y: Math.round(content.y + c.frame.y * zoom),
    width: Math.max(1, Math.round(c.frame.width * zoom)), height: Math.max(1, Math.round(c.frame.height * zoom)),
  };
  c.page.setBounds(bounds);
  if (bounds.width < 60 || bounds.height < 60) {
    c.page.hide();
    return;
  }
  if (!c.page.isVisible()) {
    c.page.show();
    c.page.focus();
    // The page ran while hidden; reload it now that it's genuinely visible and focused so an interactive
    // check (e.g. Cloudflare Turnstile) initialises in a real, on-screen context for the person to solve.
    if (c.info.reason === 'captcha') c.page.webContents.reload();
    challengeEvents.emit('placed', c.info);
  }
}

function openChallenge(page: BrowserWindow, info: HostChallenge, skip: () => void): ActiveChallenge {
  if (!QUIET) showWindow();
  const main = mainWindow()!;
  if (!QUIET) page.setParentWindow(main);
  const c: ActiveChallenge = { info, page, main, frame: null, skip, unfollow: () => undefined };
  const follow = () => placePage(c);
  const events = ['move', 'resize', 'restore', 'minimize', 'show', 'hide', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'] as const;
  for (const e of events) main.on(e as 'move', follow);
  c.unfollow = () => {
    if (!main.isDestroyed()) for (const e of events) main.off(e as 'move', follow);
  };
  sendChallenge(c);
  if (!QUIET && !main.isFocused() && Notification.isSupported()) {
    const body = info.reason === 'captcha'
      ? `${info.host} wants a ${info.check ?? 'human check'} before “${info.label}” can download. Open Lumina to solve it.`
      : `“${info.label}” needs a click on ${info.host}. Open Lumina to continue.`;
    new Notification({ title: 'Lumina needs a quick check', body, icon: appIconPath() }).show();
  }
  challengeEvents.emit('shown', page.webContents, info);
  return c;
}

function closeChallenge(c: ActiveChallenge) {
  if (active === c) active = null;
  c.unfollow();
  if (!c.main.isDestroyed()) {
    c.main.webContents.send('hosts:challenge-done', { id: c.info.id });
    if (!QUIET) c.main.focus();
  }
  if (!c.page.isDestroyed()) {
    c.page.hide();
    c.page.setParentWindow(null);
  }
  challengeEvents.emit('done', c.info.id);
}

/** When "skip all" was last pressed for a site. A file asked for before that moment is dismissed with it; one asked for after is a fresh try. */
const skippedAllAt = new Map<string, number>();
const SKIPPED = 'Skipped: the download page needed a quick check. Retry to open it again.';
/** A self-test (development only) must never show a window, take focus or raise a notification: someone may be working in front of the screen. */
const QUIET = !app.isPackaged && !!process.env.LUMINA_SELFTEST;
/** A page whose script never answers (an endless loop, a huge page) is treated as a page that gave nothing this time. */
const SCRIPT_LIMIT_MS = 10_000;
const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('The page did not answer')), ms).unref?.())]);
/** The checks a saved "this visitor passed" cookie can answer; a per-file reCAPTCHA or image code is not one of them. */
const CLEARANCE_KINDS = new Set(['Cloudflare check', 'human check']);
/** How long before the download started a click may be and still be what the person did to get it. */
const LEARN_WINDOW_MS = 20_000;

export function currentChallenge(): HostChallenge | null {
  return active ? { ...active.info, waiting: waitingTurns.length } : null;
}

/** The panel reports where its frame is (CSS pixels in the main window). */
export function placeChallenge(id: string, rect: { x: number; y: number; width: number; height: number }) {
  if (!active || active.info.id !== id) return;
  active.frame = rect;
  placePage(active);
}

export function challengeAction(id: string, action: 'reload' | 'skip' | 'skip-all') {
  if (!active || active.info.id !== id) return;
  if (action === 'reload') {
    if (!active.page.isDestroyed()) active.page.webContents.reload();
    return;
  }
  if (action === 'skip-all') {
    // Also dismiss this site's files that have not reached their check yet (still waiting for a free slot, or still loading): each would
    // otherwise ask in turn, and with hundreds of files "skip all" would have to be pressed again and again.
    skippedAllAt.set(clearanceSite(active.info.host), Date.now());
    // Give up every file queued behind this one too, so a wall of captchas can be dismissed in one click.
    // Drain first, then tell each to skip: a skipped page's own cleanup calls waitingTurns.shift(), which
    // would otherwise resume a page we're about to skip.
    const queued = waitingTurns.splice(0, waitingTurns.length);
    for (const t of queued) t.skip();
  }
  active.skip();
}

/* ---------- helpers ---------- */

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => {
    clearTimeout(t);
    reject(new Error('Cancelled'));
  }, { once: true });
});

async function capturedCookies(s: Session): Promise<CapturedCookie[]> {
  const all = await s.cookies.get({});
  return all.map((c) => ({
    name: c.name, value: c.value, domain: c.domain ?? '', path: c.path ?? '/', secure: Boolean(c.secure), httpOnly: Boolean(c.httpOnly),
    expirationDate: c.expirationDate,
  }));
}

function realClick(wc: WebContents, x: number, y: number) {
  wc.sendInputEvent({ type: 'mouseMove', x, y });
  wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
}

/** Keep the page on the host: ad scripts love to navigate the tab away or open pop-unders. */
function guardNavigation(wc: WebContents, startUrl: string) {
  const allowed = new Set([siteOf(new URL(startUrl).hostname)]);
  let initialLoad = true;
  let lastGood = startUrl;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e, url) => {
    if (!/^https?:/i.test(url)) e.preventDefault();
  });
  // Redirects during the first load (short links, mirrors) define the host's own sites.
  wc.on('did-redirect-navigation', (_e, url, _inPlace, isMainFrame) => {
    if (isMainFrame && initialLoad && /^https?:/i.test(url)) allowed.add(siteOf(new URL(url).hostname));
  });
  wc.on('did-finish-load', () => {
    initialLoad = false;
  });
  wc.on('did-navigate', (_e, url) => {
    let site = '';
    try {
      site = siteOf(new URL(url).hostname);
    } catch {
      // about:blank and similar
    }
    if (!site || allowed.has(site)) {
      lastGood = url;
      return;
    }
    log.debug(`Blocked navigation away from the host to ${url}`);
    if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    else void wc.loadURL(lastGood);
  });
}

/* ---------- resolve ---------- */

export async function resolveHostedLink(pageUrl: string, opts: ResolveOptions): Promise<ResolvedLink> {
  const { signal, onStage } = opts;
  const interactive = opts.interactive ?? true;
  const requestedAt = Date.now();
  const site = clearanceSite(new URL(pageUrl).hostname);
  const dismissed = () => (skippedAllAt.get(site) ?? 0) >= requestedAt;
  onStage('Waiting for a free download page slot');
  const release = await acquire(signal);
  if (dismissed()) {
    release();
    throw new Error(SKIPPED);
  }
  const { s, partition } = pageSession();
  let page: BrowserWindow | null = null;
  let challenge: ActiveChallenge | null = null;
  let wcId = -1;
  /** This page was woken for its turn at the screen and has not yet used it or passed it on (the finally block passes it on). */
  let holdsTurn = false;

  try {
    page = pageWindow(partition);
    const wc = page.webContents;
    wcId = wc.id;
    wc.setAudioMuted(true);
    guardNavigation(wc, pageUrl);
    page.on('page-title-updated', (e) => e.preventDefault());

    let caught: CaughtDownload | null = null;
    downloadWaiters.set(wc.id, (item) => {
      caught = item;
    });
    let skipped = false;
    /** The control the person last clicked while the page was in their hands: learned for this site if the download then starts. */
    let personClick: { sig: unknown; at: number } | null = null;
    /** This page's own solved check is in the jar already: reloading with it again would only repeat the click-through. */
    let ownClearance = false;
    /** When Lumina last clicked in this page itself: a person's click before that did not start the download. */
    let ownClickAt = 0;
    /** When the page was first handed to the person (shownAt is cleared once a check is solved). */
    let handedOverAt = 0;

    let reused = await applyClearance(s, site);
    if (reused) log.info(`Reusing the check already solved on ${site} (${reused} cookies)`);

    onStage('Opening download page');
    wc.loadURL(pageUrl, { userAgent: browserUserAgent() }).catch((err) => log.debug(`Page load: ${err}`));

    let started = Date.now();
    let lastProgress = Date.now();
    let lastUrl = '';
    let shownAt = 0;

    const stage = (text: string) => {
      onStage(text);
      if (challenge && challenge.info.stage !== text) {
        challenge.info = { ...challenge.info, stage: text };
        sendChallenge(challenge);
      }
    };

    while (!caught) {
      await sleep(TICK_MS, signal);
      if (signal.aborted) throw new Error('Cancelled');
      if (caught) break;
      if (skipped) throw new Error('Skipped: the download page needed a quick check. Retry to open it again.');
      if (wc.isDestroyed()) throw new Error('The download page closed before the download started.');

      const current = wc.getURL();
      if (current !== lastUrl) {
        lastUrl = current;
        lastProgress = Date.now();
        if (challenge) {
          challenge.info = { ...challenge.info, url: current };
          sendChallenge(challenge);
        }
      }

      let scan: PageScan | null = null;
      if (!wc.isLoading()) {
        try {
          scan = (await withTimeout(wc.executeJavaScript(pageDriver(learnedClicks().recall(site, Date.now())), true), SCRIPT_LIMIT_MS)) as PageScan;
        } catch {
          // navigating between steps
        }
      }
      if (caught) break;
      if (handedOverAt && scan?.lastClick?.control && scan.lastClick.at >= handedOverAt) personClick = { sig: scan.lastClick.sig, at: scan.lastClick.at };

      if (scan?.blocked && !shownAt) {
        const msg = scan.blocked.trim();
        if (/not found|deleted|removed|no such|unavailable/i.test(msg)) throw new Error(`The file host says the file is gone (${msg}). The link may be dead (not found).`);
        throw new Error(`The file host is temporarily limiting free downloads: “${msg}”. Lumina will retry.`);
      }
      if (scan?.target) {
        realClick(wc, scan.target.x, scan.target.y);
        ownClickAt = Date.now();
        lastProgress = Date.now();
        log.debug(`Clicked “${scan.target.label}” on ${current}`);
        stage(shownAt ? `Continuing · ${scan.target.label}` : `Download page · ${scan.target.label}`);
      } else if (scan?.clicked) {
        ownClickAt = Date.now();
        lastProgress = Date.now();
        stage(`Download page · ${scan.clicked}`);
      } else if (scan?.countdown) {
        lastProgress = Date.now();
        stage(`${shownAt ? 'Continuing' : 'Download page'} · waiting ${scan.countdown}s`);
      } else if (shownAt && scan) {
        stage(scan.captcha ? 'Waiting for you to solve the check' : 'Looking for the download button');
      }

      const now = Date.now();
      if (shownAt) {
        if (now - shownAt > INTERACTIVE_LIMIT_MS) throw new Error('The quick check wasn’t finished in time. Retry to open it again.');
        // The person has solved the check (the page no longer shows one). What is left, the host's own countdown and its Download button,
        // needs nobody, so the next file's check is handed over now. Before this the pop-up stayed until the download had started, four or
        // five seconds of watching a page count down, one file at a time, for a release of fifty parts. The page carries on out of sight and
        // asks again, in its place in the line, if it meets another check.
        if (challenge && challenge.info.reason === 'captcha' && scan && !scan.captcha) {
          log.info(`Check solved for ${challenge.info.label}; the next one can be shown while this page finishes`);
          const kept = clearances.remember(site, await capturedCookies(s), Date.now());
          if (kept) {
            ownClearance = true;
            log.info(`Remembering the solved check on ${site} for this site's other files (${kept} cookies, kept in memory only)`);
          }
          closeChallenge(challenge);
          waitingTurns.shift()?.resume();
          challenge = null;
          shownAt = 0;
          started = Date.now();
          lastProgress = Date.now();
        }
        continue;
      }
      const needsPerson = Boolean(scan?.captcha) || now - lastProgress > STALL_MS || now - started > HEADLESS_LIMIT_MS;
      if (!needsPerson) continue;
      if (!interactive) throw new Error('This download page needs a person (captcha or unusual page).');

      // One check at a time: wait for the person to finish the page in front of this one.
      const reason: HostChallenge['reason'] = scan?.captcha ? 'captcha' : 'stalled';
      if (dismissed()) throw new Error(SKIPPED);
      // A reused clearance that still met a check was not accepted (it expired, or the site ties it to something else): stop offering it.
      if (reused && reason === 'captcha' && CLEARANCE_KINDS.has(scan?.captchaKind ?? '')) {
        clearances.forget(site);
        log.info(`The check solved earlier on ${site} was not accepted; asking again and not reusing it`);
      }
      if (active) {
        onStage('Needs you: waiting for your earlier quick check');
        if (active) sendChallenge(active);
        await new Promise<void>((resolve, reject) => {
          const remove = () => {
            const i = waitingTurns.indexOf(turn);
            if (i >= 0) waitingTurns.splice(i, 1);
          };
          const turn: WaitingTurn = {
            resume: () => { remove(); resolve(); },
            // Skip-all reached this page while it waited: mark it skipped, then let it wake and give up its file.
            skip: () => { skipped = true; remove(); resolve(); },
          };
          waitingTurns.push(turn);
          signal.addEventListener('abort', () => {
            remove();
            reject(new Error('Cancelled'));
          }, { once: true });
        });
        if (caught) break;
        if (skipped) throw new Error(SKIPPED);
        holdsTurn = true;
      }
      // This page opened before another one's check was solved, so its jar has no proof of it. Take it now and load the page again before
      // troubling the person: with several pages open at once, one solved check then clears the others.
      if (!reused && !ownClearance && CLEARANCE_KINDS.has(scan?.captchaKind ?? '') && clearances.has(site, Date.now())) {
        reused = await applyClearance(s, site);
        if (reused) {
          log.info(`Reusing the check solved meanwhile on ${site} (${reused} cookies)`);
          stage('Continuing with the check you already solved');
          wc.reload();
          lastProgress = Date.now();
          started = Date.now();
          // This page will not open a check of its own, and a page's own check is what used to wake the next one in line; pass the turn on
          // (it takes the same proof, or asks the person if there is none), or it would wait for a turn that never comes.
          holdsTurn = false;
          if (!active) waitingTurns.shift()?.resume();
          continue;
        }
      }
      // Another page may have taken the screen while this one was busy above: wait for it again instead of opening a second check.
      if (active) {
        holdsTurn = false;
        continue;
      }
      const info: HostChallenge = {
        id: randomUUID(), label: opts.label ?? 'Download', host: new URL(pageUrl).hostname.replace(/^www\./, ''), reason,
        check: scan?.captchaKind ?? null,
        waiting: waitingTurns.length, url: current, stage: reason === 'captcha' ? 'Waiting for you to solve the check' : 'Looking for the download button',
      };
      holdsTurn = false; // the check this page now opens passes the turn on when it ends
      challenge = openChallenge(page, info, () => {
        skipped = true;
      });
      active = challenge;
      shownAt = Date.now();
      handedOverAt ||= shownAt;
      onStage(reason === 'captcha' ? 'Needs you: quick check open in Lumina' : 'Needs you: finish the download page in Lumina');
      log.info(`Quick check for ${info.label} on ${current} (${reason})`);
    }

    const item = caught as CaughtDownload;
    // A check solved by the person usually ends with the file starting at once (Cloudflare reloads the link and serves it), so the page never
    // shows "check gone, still on the page" for the branch above to notice. The proof of it is in the jar all the same: keep it for the
    // rest of the site's files, or each one asks again.
    if (handedOverAt && !ownClearance && !wc.isDestroyed()) {
      const kept = clearances.remember(site, await capturedCookies(s), Date.now());
      if (kept) {
        ownClearance = true;
        log.info(`Remembering the solved check on ${site} for this site's other files (${kept} cookies, kept in memory only)`);
      }
    }
    // The click that started the download ends the loop before the next look at the page, so read it once more here.
    if (handedOverAt && !wc.isDestroyed()) {
      try {
        const last = (await wc.executeJavaScript('window.__luminaLast || null', true)) as { sig?: unknown; at?: unknown; control?: unknown } | null;
        // The page can set this value itself, so its time is checked, not trusted.
        if (last?.control === true && typeof last.at === 'number' && Number.isFinite(last.at) && last.at >= handedOverAt) personClick = { sig: last.sig, at: last.at };
      } catch { /* the page is gone; what was seen before stands */ }
    }
    // A click long before the download started was probably something else (a dismissed pop-up, an ad): learn only a recent one.
    if (personClick && personClick.at >= ownClickAt && Date.now() - personClick.at <= LEARN_WINDOW_MS && learnedClicks().remember(site, personClick.sig, Date.now())) {
      saveLearnedClicks();
      log.info(`Learned the control you clicked on ${site}; the next page there will not need you`);
    }
    if (challenge) stage('Download found · starting');
    const request: RequestInfo = {
      pageUrl: wc.isDestroyed() ? pageUrl : wc.getURL() || pageUrl,
      headers: { 'User-Agent': browserUserAgent() },
      cookies: await capturedCookies(s),
    };
    log.info(`Resolved ${pageUrl} -> ${item.url.slice(0, 200)} (${item.filename}, ${item.totalBytes || '?'} bytes)`);
    return { url: item.url, filename: item.filename, sizeBytes: item.totalBytes > 0 ? item.totalBytes : null, request };
  } finally {
    downloadWaiters.delete(wcId);
    if (challenge) {
      closeChallenge(challenge);
      // Next page waiting for the person gets its turn.
      waitingTurns.shift()?.resume();
    }
    if (holdsTurn && !active) waitingTurns.shift()?.resume();
    if (page && !page.isDestroyed()) page.destroy();
    void s.clearStorageData().catch(() => undefined);
    release();
  }
}
