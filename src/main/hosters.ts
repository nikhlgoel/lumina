// Resolves file-host links (download pages with buttons, countdowns and sometimes a captcha) to the real
// file URL, the way a person would: a hidden, sandboxed page clicks through and the browser's own download
// request is caught, cancelled and handed to aria2 with the same cookies.
//
// Each page runs in its own hidden, borderless window (hidden pages still take input there). When a page
// needs a person (captcha or a page Lumina can't finish), that same live window is attached to Lumina and laid
// exactly over the "Quick check" panel, so nothing reloads and the page keeps its state and cookies. It
// follows Lumina's window and disappears on its own once the download starts.
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { app, BrowserWindow, Notification, session, type Session, type WebContents } from 'electron';
import type { CapturedCookie, HostChallenge, RequestInfo } from '../shared/types';
import { PAGE_DRIVER, siteOf, type PageScan } from '../core/hosts';
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
const STALL_MS = 60_000;
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
  if (!c.frame || c.page.isDestroyed() || c.main.isDestroyed()) return;
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
  showWindow();
  const main = mainWindow()!;
  page.setParentWindow(main);
  const c: ActiveChallenge = { info, page, main, frame: null, skip, unfollow: () => undefined };
  const follow = () => placePage(c);
  const events = ['move', 'resize', 'restore', 'minimize', 'show', 'hide', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'] as const;
  for (const e of events) main.on(e as 'move', follow);
  c.unfollow = () => {
    if (!main.isDestroyed()) for (const e of events) main.off(e as 'move', follow);
  };
  sendChallenge(c);
  if (!main.isFocused() && Notification.isSupported()) {
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
    c.main.focus();
  }
  if (!c.page.isDestroyed()) {
    c.page.hide();
    c.page.setParentWindow(null);
  }
  challengeEvents.emit('done', c.info.id);
}

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
  onStage('Waiting for a free download page slot');
  const release = await acquire(signal);
  const { s, partition } = pageSession();
  let page: BrowserWindow | null = null;
  let challenge: ActiveChallenge | null = null;
  let wcId = -1;

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

    onStage('Opening download page');
    wc.loadURL(pageUrl, { userAgent: browserUserAgent() }).catch((err) => log.debug(`Page load: ${err}`));

    const started = Date.now();
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
          scan = (await wc.executeJavaScript(PAGE_DRIVER, true)) as PageScan;
        } catch {
          // navigating between steps
        }
      }
      if (caught) break;

      if (scan?.blocked && !shownAt) {
        const msg = scan.blocked.trim();
        if (/not found|deleted|removed|no such|unavailable/i.test(msg)) throw new Error(`The file host says the file is gone (${msg}). The link may be dead (not found).`);
        throw new Error(`The file host is temporarily limiting free downloads: “${msg}”. Lumina will retry.`);
      }
      if (scan?.target) {
        realClick(wc, scan.target.x, scan.target.y);
        lastProgress = Date.now();
        log.debug(`Clicked “${scan.target.label}” on ${current}`);
        stage(shownAt ? `Continuing · ${scan.target.label}` : `Download page · ${scan.target.label}`);
      } else if (scan?.clicked) {
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
        continue;
      }
      const needsPerson = Boolean(scan?.captcha) || now - lastProgress > STALL_MS || now - started > HEADLESS_LIMIT_MS;
      if (!needsPerson) continue;
      if (!interactive) throw new Error('This download page needs a person (captcha or unusual page).');

      // One check at a time: wait for the person to finish the page in front of this one.
      const reason: HostChallenge['reason'] = scan?.captcha ? 'captcha' : 'stalled';
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
        if (skipped) throw new Error('Skipped: the download page needed a quick check. Retry to open it again.');
      }
      const info: HostChallenge = {
        id: randomUUID(), label: opts.label ?? 'Download', host: new URL(pageUrl).hostname.replace(/^www\./, ''), reason,
        check: scan?.captchaKind ?? null,
        waiting: waitingTurns.length, url: current, stage: reason === 'captcha' ? 'Waiting for you to solve the check' : 'Looking for the download button',
      };
      challenge = openChallenge(page, info, () => {
        skipped = true;
      });
      active = challenge;
      shownAt = Date.now();
      onStage(reason === 'captcha' ? 'Needs you: quick check open in Lumina' : 'Needs you: finish the download page in Lumina');
      log.info(`Quick check for ${info.label} on ${current} (${reason})`);
    }

    const item = caught as CaughtDownload;
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
    if (page && !page.isDestroyed()) page.destroy();
    void s.clearStorageData().catch(() => undefined);
    release();
  }
}
