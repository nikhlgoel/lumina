import { capture, captureBatch, captureEpisodes, cookiesFor, fitToBridge, getConfig, hello, pair, setConfig } from './lib.js';
import { pickVideo, probeEpisodes } from './probe.js';

// Recent hand-off decisions, for troubleshooting in the extension's DevTools and for automated tests.
const events = [];
function trace(id, url, step, detail = '') {
  events.push({ t: Date.now(), id, url: url?.slice(0, 200), step, detail: String(detail).slice(0, 200) });
  if (events.length > 400) events.shift();
}

// Handles for automated tests (reachable only from the extension's own DevTools context).
globalThis.lumina = { hello, pair, getConfig, setConfig, cookiesFor, events, linksIn, sendLinks, fitToBridge, episodesIn, startEpisodeProbe, episodeSnapshot, sendEpisodes };

const isFirefox = /firefox/i.test(navigator.userAgent);
const MIN_MEDIA_BYTES = 512 * 1024;
const HANDOFF_TIMEOUT_MS = 30_000;

/* ---------- Request bookkeeping ---------- */

// url -> { method, headers, time }: lets a download reuse the exact headers of the request that started it,
// and tells us when a download came from a form POST (which only the browser can repeat).
const recent = new Map();
const bypassOnce = new Set(); // urls handed back to the browser
const handled = new Set(); // download ids already considered

function remember(url, patch) {
  const prev = recent.get(url) ?? { method: 'GET', headers: {}, time: 0 };
  recent.set(url, { ...prev, ...patch, headers: { ...prev.headers, ...(patch.headers ?? {}) }, time: Date.now() });
  if (recent.size > 600) recent.delete(recent.keys().next().value);
}

const pickHeaders = (list = []) => {
  const out = {};
  for (const h of list) if (/^(referer|origin|user-agent|authorization)$/i.test(h.name) && h.value) out[h.name] = h.value;
  return out;
};

const headerValue = (list = [], name) => list.find((h) => h.name.toLowerCase() === name)?.value ?? '';
const extraInfo = (base) => (isFirefox ? base : [...base, 'extraHeaders']);

chrome.webRequest.onBeforeRequest.addListener(
  (d) => {
    if (d.method !== 'GET') remember(d.url, { method: d.method });
  },
  { urls: ['http://*/*', 'https://*/*'], types: ['main_frame', 'sub_frame', 'other'] },
);

chrome.webRequest.onSendHeaders.addListener(
  (d) => remember(d.url, { headers: pickHeaders(d.requestHeaders) }),
  { urls: ['http://*/*', 'https://*/*'] },
  extraInfo(['requestHeaders']),
);

/* ---------- Detected media per tab (session storage survives worker restarts) ---------- */

const key = (tabId) => `tab:${tabId}`;

async function listFor(tabId) {
  const data = await chrome.storage.session.get(key(tabId));
  return data[key(tabId)] ?? [];
}

// One at a time: two media requests arriving together each read the same list and the second write used to drop the first's entry.
let mediaChain = Promise.resolve();
function rememberMedia(tabId, item) {
  mediaChain = mediaChain.then(() => rememberMediaNow(tabId, item)).catch(() => undefined);
  return mediaChain;
}

async function rememberMediaNow(tabId, item) {
  const list = await listFor(tabId);
  if (list.some((x) => x.url === item.url)) return;
  const next = [item, ...list].sort((a, b) => (b.kind === 'stream') - (a.kind === 'stream') || b.time - a.time).slice(0, 30);
  await chrome.storage.session.set({ [key(tabId)]: next });
  // The tab may be gone by now; a badge for it is then not worth an error.
  await chrome.action.setBadgeText({ tabId, text: String(next.length) }).catch(() => undefined);
  await chrome.action.setBadgeBackgroundColor({ tabId, color: '#E0762A' }).catch(() => undefined);
}

async function forget(tabId) {
  await chrome.storage.session.remove(key(tabId));
  await chrome.action.setBadgeText({ tabId, text: '' }).catch(() => undefined);
}

chrome.tabs.onRemoved.addListener((tabId) => void forget(tabId));
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading' && info.url) void forget(tabId);
});

function classify(url, type) {
  const path = url.split(/[?#]/)[0].toLowerCase();
  const t = type.toLowerCase();
  if (/\.m3u8$/.test(path) || /mpegurl/.test(t)) return { kind: 'stream', label: 'HLS' };
  if (/\.mpd$/.test(path) || /dash\+xml/.test(t)) return { kind: 'stream', label: 'DASH' };
  // Segments of a stream are not useful on their own.
  if (/\.(ts|m4s|aac|vtt|webvtt|key)$/.test(path) || /mp2t|vtt/.test(t)) return null;
  if (/^video\//.test(t) || /\.(mp4|webm|mkv|mov)$/.test(path)) return { kind: 'media', label: (t.split('/')[1] || path.split('.').pop()).toUpperCase().slice(0, 5) };
  if (/^audio\//.test(t) || /\.(mp3|m4a|flac|opus|ogg|wav)$/.test(path)) return { kind: 'media', label: (t.split('/')[1] || path.split('.').pop()).toUpperCase().slice(0, 5) };
  return null;
}

chrome.webRequest.onHeadersReceived.addListener(
  (d) => {
    if (d.tabId < 0 || !/^https?:/.test(d.url) || d.statusCode >= 400) return;
    const found = classify(d.url, headerValue(d.responseHeaders, 'content-type'));
    if (!found) return;
    const total = Number(headerValue(d.responseHeaders, 'content-range').split('/')[1]) || Number(headerValue(d.responseHeaders, 'content-length')) || 0;
    if (found.kind === 'media' && total && total < MIN_MEDIA_BYTES) return;
    const headers = recent.get(d.url)?.headers ?? {};
    void chrome.tabs.get(d.tabId).then((tab) => rememberMedia(d.tabId, {
      url: d.url, kind: found.kind, label: found.label, sizeBytes: total || null, headers,
      pageUrl: tab.url, pageTitle: tab.title, time: Date.now(),
    })).catch(() => undefined);
  },
  { urls: ['http://*/*', 'https://*/*'], types: ['media', 'xmlhttprequest', 'other', 'object'] },
  extraInfo(['responseHeaders']),
);

/* ---------- Context menu ---------- */

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'lumina-link', title: 'Download link with Lumina', contexts: ['link'] });
    chrome.contextMenus.create({ id: 'lumina-media', title: 'Download with Lumina', contexts: ['video', 'audio', 'image'] });
    chrome.contextMenus.create({ id: 'lumina-page', title: 'Send page to Lumina', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'lumina-all-links', title: 'Send all download links on this page to Lumina', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'lumina-selection', title: SELECTION_TITLE, contexts: ['selection'] });
  });
});

const SELECTION_TITLE = 'Send selected links to Lumina';

/**
 * The download links on a tab, or only those in what the person has highlighted. The rules live in pagelinks.js, the same file the page
 * prompt uses; it is injected here (it does nothing if already there) and then asked.
 */
async function linksIn(tabId, selectionOnly) {
  const target = { tabId, allFrames: selectionOnly }; // a highlight can be inside a frame
  await chrome.scripting.executeScript({ target, files: ['pagelinks.js'] });
  const results = await chrome.scripting.executeScript({ target, func: (o) => globalThis.__luminaLinks?.read(o) ?? [], args: [{ selectionOnly }] });
  const seen = new Set();
  const out = [];
  for (const r of results) {
    for (const l of r.result ?? []) {
      if (seen.has(l.url)) continue;
      seen.add(l.url);
      out.push(l);
    }
  }
  return out.slice(0, 500);
}

/**
 * Send links the person picked. One goes through the ordinary path; several go as one batch so Lumina plans them together and the person
 * confirms once. A Lumina older than the batch request gets them one at a time, as before.
 * Resolves { accepted, count, reason }.
 */
async function sendLinks(urls, tab, names = {}) {
  const pageUrl = tab?.url;
  const pageTitle = tab?.title;
  if (urls.length === 1) {
    const r = await capture({ url: urls[0], kind: 'link', pageUrl, pageTitle, headers: recent.get(urls[0])?.headers });
    return { accepted: r.accepted, count: r.accepted ? 1 : 0, reason: r.reason };
  }
  const batch = await captureBatch({ urls, names, pageUrl, pageTitle });
  if (!batch.unsupported) return batch;
  let sent = 0;
  for (const url of urls) {
    const r = await capture({ url, kind: 'link', pageUrl, pageTitle, headers: recent.get(url)?.headers });
    if (r.accepted) sent++;
  }
  return { accepted: sent > 0, count: sent, reason: sent ? undefined : 'Lumina isn’t connected. Open Lumina, then try again.' };
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'lumina-all-links' || info.menuItemId === 'lumina-selection') {
    if (!tab?.id) return;
    const selectionOnly = info.menuItemId === 'lumina-selection';
    let links = [];
    try {
      links = await linksIn(tab.id, selectionOnly);
    } catch {
      flag('Couldn’t read the links on this page.');
      return;
    }
    if (!links.length) {
      flag(selectionOnly ? 'No download links in the selection.' : 'No download links found on this page.');
      return;
    }
    const r = await sendLinks(links.map((l) => l.url), tab, Object.fromEntries(links.filter((l) => l.text).map((l) => [l.url, l.text])));
    flag(r.accepted ? `Sent ${r.count} link${r.count === 1 ? '' : 's'} to Lumina.` : (r.reason || 'Lumina isn’t connected. Open Lumina, then try again.'));
    return;
  }
  const url = info.menuItemId === 'lumina-link' ? info.linkUrl : info.menuItemId === 'lumina-media' ? info.srcUrl : info.pageUrl;
  if (!url || !/^(https?:|magnet:)/.test(url)) {
    flag('That item only exists inside this page. Use the Lumina button to pick detected media instead.');
    return;
  }
  const sent = await capture({ url, kind: info.menuItemId === 'lumina-page' ? 'page' : 'link', pageUrl: tab?.url, pageTitle: tab?.title, headers: recent.get(url)?.headers });
  // Say what went wrong: a timeout and a link Lumina refused are not "not connected".
  if (!sent.accepted) flag(sent.reason || 'Lumina isn’t connected. Open Lumina, then click the Lumina button to connect.');
});

/* ---------- Taking over browser downloads ---------- */

let statusCache = { at: 0, value: null };
async function appStatus() {
  if (statusCache.value && Date.now() - statusCache.at < 5000) return statusCache.value;
  statusCache = { at: Date.now(), value: await hello() };
  return statusCache.value;
}

// Saved web pages and archives of pages belong to the browser.
const PAGE_TYPES = /^(text\/html|application\/xhtml\+xml|multipart\/related|message\/rfc822|application\/x-mimearchive)/i;

function skipReason(item, url, app, filename) {
  if (!/^https?:/i.test(url)) return 'not an http download';
  if (item.byExtensionId) return 'started by an extension';
  if (item.incognito) return 'private window';
  if (PAGE_TYPES.test(item.mime ?? '')) return 'saved page';
  if (recent.get(url)?.method && recent.get(url).method !== 'GET') return 'form submission';
  const ext = (filename.split('.').pop() ?? '').toLowerCase();
  if (filename.includes('.') && (app.skipExtensions ?? []).includes(ext)) return `.${ext} is on the skip list`;
  const host = new URL(url).hostname;
  if ((app.skipSites ?? []).some((s) => host === s || host.endsWith(`.${s}`))) return `${host} is on the skip list`;
  const size = item.fileSize > 0 ? item.fileSize : item.totalBytes;
  if (size > 0 && size < (app.minCaptureSizeMb ?? 0) * 1024 * 1024) return 'smaller than the minimum size';
  return null;
}

async function handOff(item, suggestedName) {
  if (handled.has(item.id)) return;
  handled.add(item.id);
  if (handled.size > 5000) handled.clear();

  const url = item.finalUrl || item.url;
  trace(item.id, url, 'seen', suggestedName);
  if (bypassOnce.delete(url)) return trace(item.id, url, 'skip', 'handed back earlier');
  const cfg = await getConfig();
  if (!cfg.token || !cfg.captureDownloads) return trace(item.id, url, 'skip', 'capture off or not paired');
  const app = await appStatus();
  // Lumina not running or not connected: never get in the browser's way.
  if (!app.running || !app.paired || !app.captureDownloads) return trace(item.id, url, 'skip', 'Lumina unavailable');

  const filename = (suggestedName || item.filename || '').split(/[\\/]/).pop();
  const skip = skipReason(item, url, app, filename);
  if (skip) return trace(item.id, url, 'skip', skip);

  // Hold the browser's download while Lumina tries; resume it if Lumina can't take over.
  try {
    await chrome.downloads.pause(item.id);
  } catch (err) {
    return trace(item.id, url, 'skip', `pause failed: ${err?.message ?? err}`);
  }
  const [paused] = await chrome.downloads.search({ id: item.id });
  if (!paused || paused.state !== 'in_progress') return trace(item.id, url, 'skip', `browser already ${paused?.state ?? 'gone'}`);
  trace(item.id, url, 'paused');

  const tracked = recent.get(url)?.headers ?? {};
  const size = item.fileSize > 0 ? item.fileSize : item.totalBytes;
  const result = await capture({
    url, kind: 'file', filename, sizeBytes: size > 0 ? size : undefined, mime: item.mime || undefined,
    pageUrl: item.referrer || tracked.Referer || tracked.referer || undefined, headers: tracked,
  }, HANDOFF_TIMEOUT_MS);
  trace(item.id, url, result.accepted ? 'accepted' : 'rejected', result.reason ?? '');

  const [current] = await chrome.downloads.search({ id: item.id });
  if (result.accepted) {
    if (current?.state === 'complete') {
      // The browser finished anyway (tiny file); keep one copy, Lumina's.
      await chrome.downloads.removeFile(item.id).catch(() => undefined);
    } else {
      await chrome.downloads.cancel(item.id).catch(() => undefined);
    }
    await chrome.downloads.erase({ id: item.id }).catch(() => undefined);
    return trace(item.id, url, 'done', 'Lumina has it');
  }

  // Give it back to the browser.
  if (current?.state === 'in_progress') {
    try {
      await chrome.downloads.resume(item.id);
      return trace(item.id, url, 'done', 'browser resumed');
    } catch (err) {
      trace(item.id, url, 'resume failed', err?.message ?? err);
    }
  }
  if (current?.state !== 'complete') {
    await chrome.downloads.cancel(item.id).catch(() => undefined);
    bypassOnce.add(url);
    let restarted = true;
    await chrome.downloads.download({ url, filename: filename || undefined, conflictAction: 'uniquify' }).catch((err) => {
      bypassOnce.delete(url);
      restarted = false;
      trace(item.id, url, 'restart failed', err?.message ?? err);
    });
    // Lumina did not take it and the browser could not start it again: the download is gone, and the person must hear it from us.
    if (!restarted) flag('Lumina did not take that download and the browser could not restart it. Try the link again.');
    trace(item.id, url, restarted ? 'done' : 'lost', restarted ? 'browser restarted' : 'could not restart');
  }
}

if (!isFirefox && chrome.downloads.onDeterminingFilename) {
  // Chrome knows the final file name here; keep the browser's choice and hand off.
  chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    suggest();
    void handOff(item, item.filename);
  });
} else {
  chrome.downloads.onCreated.addListener((item) => void handOff(item, item.filename));
}

let flagTimer = null;
function flag(message) {
  void chrome.action.setBadgeText({ text: '!' });
  void chrome.action.setTitle({ title: `Lumina: ${message}` });
  // A second message inside the six seconds restarts the wait; the first one's timer must not wipe the second one early.
  clearTimeout(flagTimer);
  flagTimer = setTimeout(() => {
    void chrome.action.setBadgeText({ text: '' });
    void chrome.action.setTitle({ title: 'Lumina' });
  }, 6000);
}

/* ---------- Episodes of a series ---------- */

// One check per source tab. It lives in the worker's memory and, after every change, in session storage, so the popup can be closed and
// opened again (or the worker restarted) while the episodes are still being checked.
const episodeJobs = new Map();
const jobKey = (tabId) => `episodes:${tabId}`;
let keepAlive = null;
let probesRunning = 0; // checks in progress on all tabs: one timer serves them all, and the last one to end stops it

/** The episode list on a tab, or null. Injects episodes.js (it does nothing if already there) and asks it. */
async function episodesIn(tabId) {
  const target = { tabId };
  await chrome.scripting.executeScript({ target, files: ['episodes.js'] });
  const [result] = await chrome.scripting.executeScript({ target, func: () => globalThis.__luminaEpisodes?.read() ?? null });
  return result?.result ?? null;
}

const snapshotOf = (job) => ({ show: job.show, running: job.running, items: job.items.map((i) => ({ key: i.key, status: i.status, reason: i.reason, kind: i.video?.kind })) });

async function saveJob(job) {
  await chrome.storage.session.set({ [jobKey(job.tabId)]: { ...snapshotOf(job), full: job.items } }).catch(() => undefined);
}

/** What is known about the check on a tab: from memory, or from storage after the worker restarted. null when there is none. */
async function episodeSnapshot(tabId) {
  const live = episodeJobs.get(tabId);
  if (live) return snapshotOf(live);
  const saved = (await chrome.storage.session.get(jobKey(tabId)))[jobKey(tabId)];
  // A check that was running when the worker stopped is not running now.
  return saved ? { show: saved.show, running: false, items: saved.items } : null;
}

const waitMs = (ms) => new Promise((r) => setTimeout(r, ms));

// The tabs opened to check an episode. A streaming page often tries to open an advert in another tab; nobody asked for that one, so it is closed.
const probeTabs = new Set();
chrome.tabs.onCreated.addListener((tab) => {
  if (tab.openerTabId !== undefined && probeTabs.has(tab.openerTabId)) {
    probeTabs.add(tab.id); // whatever it opens in turn is closed as well
    void chrome.tabs.remove(tab.id).catch(() => undefined);
  }
});

/** Try to start the player on a probe tab: unmuted video is refused by the browser, a muted one is not, and many players only start on a click. */
async function nudgePlayer(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => {
      for (const v of document.querySelectorAll('video')) {
        v.muted = true;
        v.play?.().catch(() => undefined);
      }
      const buttons = ['.vjs-big-play-button', '.jw-icon-display', '.plyr__control--overlaid', 'button[aria-label*="play" i]', '[class*="play-button" i]', '[class*="playbtn" i]', '[class*="PlayButton"]', '.play', '#play'];
      for (const sel of buttons) {
        const el = document.querySelector(sel);
        if (el instanceof HTMLElement) { el.click(); break; }
      }
    },
  });
}

/** Start checking which of the listed episodes have a video. Resolves the snapshot straight away; the check goes on in the background. */
async function startEpisodeProbe({ tabId, show, episodes }) {
  if (episodeJobs.get(tabId)?.running) return snapshotOf(episodeJobs.get(tabId));
  const source = await chrome.tabs.get(tabId).catch(() => null);
  if (!source) return null;
  const list = (Array.isArray(episodes) ? episodes : []).filter((e) => e && typeof e.url === 'string' && /^https?:/.test(e.url)).slice(0, 300);
  const job = {
    tabId, show: String(show ?? '').slice(0, 200), running: true, stop: false,
    items: list.map((e, i) => ({ key: String(i), number: e.number, season: e.season ?? 1, title: e.title ?? '', url: e.url, current: Boolean(e.current), status: 'waiting' })),
  };
  episodeJobs.set(tabId, job);
  await saveJob(job);
  probesRunning++;
  keepAlive ??= setInterval(() => void chrome.runtime.getPlatformInfo(), 20_000);

  // The episode being watched may already have played: what the tab detected is its answer, with no second page to open.
  const known = {};
  // Only what was detected on this very page: a single-page site changes episode without a reload, and the tab then still holds the earlier episode's stream.
  const mine = pickVideo((await listFor(tabId)).filter((i) => i.pageUrl === source.url));
  if (mine) {
    const at = job.items.findIndex((i) => i.current);
    if (at >= 0) known[at] = mine;
  }

  const deps = {
    open: async (url) => {
      const tab = await chrome.tabs.create({ url, active: false, windowId: source.windowId });
      probeTabs.add(tab.id);
      await chrome.tabs.update(tab.id, { muted: true }).catch(() => undefined);
      return tab.id;
    },
    close: (id) => { probeTabs.delete(id); return chrome.tabs.remove(id); },
    found: (id) => listFor(id),
    nudge: nudgePlayer,
    sleep: waitMs,
    now: () => Date.now(),
  };
  void probeEpisodes(job.items, deps, {
    concurrency: 2, known, shouldStop: () => job.stop,
    onUpdate: (i, state) => {
      const item = job.items[i];
      item.status = state.status;
      item.reason = state.reason;
      if (state.video) item.video = { url: state.video.url, kind: state.video.kind, headers: state.video.headers ?? {}, pageUrl: state.video.pageUrl };
      void saveJob(job);
    },
  }).catch((err) => trace(0, '', 'episodes failed', err?.message ?? err)).finally(() => {
    job.running = false;
    if (--probesRunning <= 0) {
      probesRunning = 0;
      clearInterval(keepAlive);
      keepAlive = null;
    }
    void saveJob(job);
  });
  return snapshotOf(job);
}

/** Send the episodes that have a video, as one series. `keys` limits it to the ones the person ticked. */
async function sendEpisodes({ tabId, show, keys }) {
  const job = episodeJobs.get(tabId);
  const saved = job ? job.items : (await chrome.storage.session.get(jobKey(tabId)))[jobKey(tabId)]?.full;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const wanted = new Set(Array.isArray(keys) ? keys.map(String) : (saved ?? []).map((i) => i.key));
  const items = (saved ?? []).filter((i) => i.status === 'found' && i.video && wanted.has(i.key));
  if (!items.length) return { accepted: false, count: 0, reason: 'No episode with a video is picked' };
  const r = await captureEpisodes({
    show: String(show || job?.show || tab?.title || 'Series').slice(0, 200),
    items: items.map((i) => ({ number: i.number, season: i.season, title: i.title, url: i.video.url, kind: i.video.kind, headers: i.video.headers, pageUrl: i.url })),
    pageUrl: tab?.url, pageTitle: tab?.title,
  });
  if (r.unsupported) return { accepted: false, count: 0, reason: 'This version of Lumina can’t take a whole series yet. Update Lumina.' };
  return r;
}

chrome.tabs.onRemoved.addListener((tabId) => {
  const job = episodeJobs.get(tabId);
  if (job) job.stop = true;
  episodeJobs.delete(tabId);
  void chrome.storage.session.remove(jobKey(tabId));
});

/* ---------- Messages from the popup ---------- */

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type === 'episodes-read') {
    episodesIn(msg.tabId).then(reply, () => reply(null));
    return true;
  }
  if (msg?.type === 'episodes-probe') {
    startEpisodeProbe(msg).then(reply, () => reply(null));
    return true;
  }
  if (msg?.type === 'episodes-status') {
    episodeSnapshot(msg.tabId).then(reply, () => reply(null));
    return true;
  }
  if (msg?.type === 'episodes-stop') {
    const job = episodeJobs.get(msg.tabId);
    if (job) job.stop = true;
    reply(true);
    return false;
  }
  if (msg?.type === 'episodes-send') {
    sendEpisodes(msg).then(reply, () => reply({ accepted: false, count: 0, reason: 'Couldn’t send the episodes' }));
    return true;
  }
  // Every link on a tab that Lumina can use: the popup lists them for the person to choose from.
  if (msg?.type === 'page-links') {
    linksIn(msg.tabId, false).then(reply, () => reply([]));
    return true;
  }
  // Links the person chose, from the popup or from the prompt beside a highlighted selection.
  if (msg?.type === 'send-links') {
    const urls = Array.isArray(msg.urls) ? msg.urls.filter((u) => typeof u === 'string').slice(0, 500) : [];
    if (!urls.length) {
      reply({ accepted: false, count: 0, reason: 'No links to send' });
      return false;
    }
    const tab = msg.tabId ? chrome.tabs.get(msg.tabId) : Promise.resolve(sender.tab);
    const names = msg.names && typeof msg.names === 'object' ? msg.names : {};
    tab.then((t) => sendLinks(urls, t, names)).then(reply, () => reply({ accepted: false, count: 0, reason: 'Couldn’t send the links' }));
    return true;
  }
  // How many links are highlighted now: the right-click item says so.
  if (msg?.type === 'selection') {
    const count = Number(msg.count) || 0;
    void chrome.contextMenus.update('lumina-selection', { title: count >= 2 ? `Send ${count} selected links to Lumina` : SELECTION_TITLE }).catch(() => undefined);
    return false;
  }
  if (msg?.type === 'detected') {
    void listFor(msg.tabId).then(reply);
    return true;
  }
  if (msg?.type === 'send') {
    void capture(msg.payload).then((r) => reply(r.accepted));
    return true;
  }
  return false;
});
