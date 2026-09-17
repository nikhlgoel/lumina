// The in-app browser: a real Chromium view (WebContentsView) the person drives themselves. Because a human
// browses and solves any checks here — exactly as they would in Chrome or Brave — sites and their Cloudflare/
// Turnstile challenges work normally, and downloads it starts are handed to Lumina's engine. One persistent
// session keeps logins and site clearances across restarts, like a normal browser profile.
import { WebContentsView, type Rectangle } from 'electron';
import { EventEmitter } from 'node:events';
import type { BrowserState } from '../shared/types';
import { logger } from './log';
import { mainWindow } from './window';

const log = logger('browser');

const SEARCH = (q: string) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`;

// A clean, self-contained start page instead of a busy search-engine homepage: just a search box.
// Typing a query submits to DuckDuckGo; the address bar handles direct links and site names.
const START_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Lumina</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}html,body{height:100%}
body{margin:0;display:grid;place-items:center;background:#0d0b12;color:#f3f1f8;
font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{width:min(560px,90vw);text-align:center;transform:translateY(-6vh)}
.brand{font-size:40px;font-weight:700;letter-spacing:-.02em;margin:0 0 24px}
.brand b{color:#ff7a45;font-weight:700}
input{width:100%;height:54px;border-radius:14px;border:1px solid rgba(255,255,255,.12);
background:rgba(255,255,255,.05);color:#f3f1f8;font-size:16px;padding:0 18px;outline:none;
transition:border-color .15s,background .15s}
input:focus{border-color:#ff7a45;background:rgba(255,255,255,.08)}
input::placeholder{color:rgba(243,241,248,.45)}
.hint{margin-top:16px;font-size:13px;color:rgba(243,241,248,.5)}
</style></head><body><main class="wrap">
<h1 class="brand">Lumin<b>a</b></h1>
<form action="https://duckduckgo.com/" method="GET">
<input name="q" type="text" autofocus autocomplete="off" spellcheck="false"
placeholder="Search the web" aria-label="Search the web"></form>
<p class="hint">Browse to any site and start a download — Lumina catches it automatically.</p>
</main></body></html>`;

/** Minimal in-app start page as a data URL (kept out of history/address bar; see emitState). */
const HOME = `data:text/html;charset=utf-8,${encodeURIComponent(START_HTML)}`;

export interface BrowserDownload {
  url: string;
  filename: string;
  totalBytes: number;
}
export const browserEvents = new EventEmitter<{ download: [BrowserDownload] }>();

let view: WebContentsView | null = null;
let visible = false;

function scaled(b: Rectangle): Rectangle {
  const z = mainWindow()?.webContents.getZoomFactor() ?? 1;
  return { x: Math.round(b.x * z), y: Math.round(b.y * z), width: Math.max(0, Math.round(b.width * z)), height: Math.max(0, Math.round(b.height * z)) };
}

function emitState() {
  const wc = view?.webContents;
  const main = mainWindow();
  if (!wc || wc.isDestroyed() || !main || main.isDestroyed()) return;
  const rawUrl = wc.getURL();
  const state: BrowserState = {
    // The start page is a data: URL — show it as a blank address bar, like a real new-tab page.
    url: rawUrl.startsWith('data:') ? '' : rawUrl,
    title: wc.getTitle(),
    loading: wc.isLoading(),
    canGoBack: wc.navigationHistory.canGoBack(),
    canGoForward: wc.navigationHistory.canGoForward(),
  };
  main.webContents.send('browser:state', state);
}

function ensure(): WebContentsView {
  const main = mainWindow();
  if (!main) throw new Error('No window to attach the browser to');
  if (view && !view.webContents.isDestroyed()) return view;

  view = new WebContentsView({
    webPreferences: { partition: 'persist:browser', sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: true },
  });
  const wc = view.webContents;
  // Open target=_blank / window.open in the same view rather than spawning stray windows.
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void wc.loadURL(url);
    return { action: 'deny' };
  });
  for (const ev of ['did-navigate', 'did-navigate-in-page', 'did-start-loading', 'did-stop-loading', 'page-title-updated'] as const) {
    wc.on(ev as 'did-navigate', () => emitState());
  }
  // A download the person starts here is caught and handed to Lumina's engine instead of the browser's.
  wc.session.on('will-download', (event, item) => {
    const chain = item.getURLChain();
    const dl: BrowserDownload = { url: chain[chain.length - 1] ?? item.getURL(), filename: item.getFilename(), totalBytes: item.getTotalBytes() };
    event.preventDefault();
    browserEvents.emit('download', dl);
  });
  main.contentView.addChildView(view);
  view.setVisible(false);
  return view;
}

function toUrl(input: string): string {
  const s = input.trim();
  if (!s) return HOME;
  if (/^https?:\/\//i.test(s)) return s;
  // A bare domain becomes https://; anything else is a search.
  if (!s.includes(' ') && /^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(s)) return `https://${s}`;
  return SEARCH(s);
}

export function browserShow(bounds: Rectangle) {
  const v = ensure();
  v.setBounds(scaled(bounds));
  v.setVisible(true);
  visible = true;
  if (!v.webContents.getURL()) void v.webContents.loadURL(HOME).catch((e) => log.debug(`home load: ${e}`));
  emitState();
}

export function browserHide() {
  visible = false;
  if (view && !view.webContents.isDestroyed()) view.setVisible(false);
}

export function browserBounds(bounds: Rectangle) {
  if (view && visible && !view.webContents.isDestroyed()) view.setBounds(scaled(bounds));
}

export function browserGo(input: string) {
  const v = ensure();
  const url = toUrl(input);
  void v.webContents.loadURL(url).catch((e) => log.debug(`load ${url}: ${e}`));
}

export function browserBack() {
  if (view?.webContents.navigationHistory.canGoBack()) view.webContents.navigationHistory.goBack();
}
export function browserForward() {
  if (view?.webContents.navigationHistory.canGoForward()) view.webContents.navigationHistory.goForward();
}
export function browserReload() {
  if (view && !view.webContents.isDestroyed()) view.webContents.reload();
}
export function browserStop() {
  if (view && !view.webContents.isDestroyed()) view.webContents.stop();
}
