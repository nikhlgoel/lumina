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
const HOME = 'https://duckduckgo.com/';

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
  const state: BrowserState = {
    url: wc.getURL(),
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
  return `https://duckduckgo.com/?q=${encodeURIComponent(s)}`;
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
