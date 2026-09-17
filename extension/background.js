import { capture, cookiesFor, getConfig, hello, pair, setConfig } from './lib.js';

// Recent hand-off decisions, for troubleshooting in the extension's DevTools and for automated tests.
const events = [];
function trace(id, url, step, detail = '') {
  events.push({ t: Date.now(), id, url: url?.slice(0, 200), step, detail: String(detail).slice(0, 200) });
  if (events.length > 400) events.shift();
}

// Handles for automated tests (reachable only from the extension's own DevTools context).
globalThis.lumina = { hello, pair, getConfig, setConfig, cookiesFor, events };

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

async function rememberMedia(tabId, item) {
  const list = await listFor(tabId);
  if (list.some((x) => x.url === item.url)) return;
  const next = [item, ...list].sort((a, b) => (b.kind === 'stream') - (a.kind === 'stream') || b.time - a.time).slice(0, 30);
  await chrome.storage.session.set({ [key(tabId)]: next });
  await chrome.action.setBadgeText({ tabId, text: String(next.length) });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: '#E0762A' });
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
  });
});

// Runs in the page: collect the download-worthy links (file hosts, direct files, magnets), deduped.
// Self-contained — chrome.scripting serialises this function, so it can't reference anything outside it.
function collectDownloadLinks() {
  const HOSTS = /(?:datanodes|ddownload|rapidgator|nitroflare|katfile|uploadrar|mega4upload|hexload|usersdrive|drop\.download|clicknupload|userupload|uptobox|send\.cm|krakenfiles|mediafire|1fichier|turbobit|hitfile|buzzheavier|qiwi\.gg|fuckingfast|pixeldrain|gofile|1drv|dropbox)\./i;
  const EXT = /\.(rar|zip|7z|iso|bin|exe|apk|dmg|mkv|mp4|avi|mov|mp3|flac|wav|pdf|epub|part\d+\.rar|\d{3})(?:\?|#|$)/i;
  const out = [];
  const seen = new Set();
  for (const a of document.querySelectorAll('a[href]')) {
    const href = a.href;
    if (!href || seen.has(href)) continue;
    const ok = /^magnet:/i.test(href) || (/^https?:/i.test(href) && (HOSTS.test(href) || EXT.test(href)));
    if (ok) {
      seen.add(href);
      out.push(href);
    }
  }
  return out.slice(0, 200);
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'lumina-all-links') {
    if (!tab?.id) return;
    let links = [];
    try {
      const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collectDownloadLinks });
      links = res?.result ?? [];
    } catch {
      flag('Couldn’t read the links on this page.');
      return;
    }
    if (!links.length) {
      flag('No download links found on this page.');
      return;
    }
    let sent = 0;
    for (const link of links) {
      const { accepted } = await capture({ url: link, kind: 'link', pageUrl: tab.url, pageTitle: tab.title, headers: recent.get(link)?.headers });
      if (accepted) sent++;
    }
    flag(sent ? `Sent ${sent} link${sent === 1 ? '' : 's'} to Lumina.` : 'Lumina isn’t connected. Open Lumina, then try again.');
    return;
  }
  const url = info.menuItemId === 'lumina-link' ? info.linkUrl : info.menuItemId === 'lumina-media' ? info.srcUrl : info.pageUrl;
  if (!url || !/^(https?:|magnet:)/.test(url)) {
    flag('That item only exists inside this page. Use the Lumina button to pick detected media instead.');
    return;
  }
  const { accepted } = await capture({ url, kind: info.menuItemId === 'lumina-page' ? 'page' : 'link', pageUrl: tab?.url, pageTitle: tab?.title, headers: recent.get(url)?.headers });
  if (!accepted) flag('Lumina isn’t connected. Open Lumina, then click the Lumina button to connect.');
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
    await chrome.downloads.download({ url, filename: filename || undefined, conflictAction: 'uniquify' }).catch(() => bypassOnce.delete(url));
    trace(item.id, url, 'done', 'browser restarted');
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

function flag(message) {
  void chrome.action.setBadgeText({ text: '!' });
  void chrome.action.setTitle({ title: `Lumina: ${message}` });
  setTimeout(() => {
    void chrome.action.setBadgeText({ text: '' });
    void chrome.action.setTitle({ title: 'Lumina' });
  }, 6000);
}

/* ---------- Messages from the popup ---------- */

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
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
