import { app, dialog, type BrowserWindow } from 'electron';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import { z } from 'zod';
import type { RequestInfo } from '../../shared/types';
import { requestInfoSchema } from '../../shared/ipc';
import { settings } from '../settings';
import { loadSecret, saveSecret } from '../secrets';
import { logger } from '../log';

const log = logger('bridge');
const MAX_BODY = 512 * 1024;
const EXTENSION_ORIGIN = /^(chrome|moz|edge|safari-web)-extension:\/\/[a-z0-9-]{8,64}$/i;

export interface PairedBrowser {
  id: string;
  browser: string;
  origin: string;
  tokenHash: string;
  createdAt: number;
  lastUsedAt: number;
}

export interface CaptureRequest {
  url: string;
  /** file = a download the browser started; the rest come from the menu or popup. */
  kind: 'page' | 'file' | 'stream' | 'media' | 'link';
  request: RequestInfo;
  filename?: string;
  sizeBytes?: number;
  mime?: string;
}

export interface CaptureResult {
  accepted: boolean;
  reason?: string;
  jobId?: string;
}

const captureSchema = z.object({
  url: z.string().min(1).max(16_384).refine((u) => /^(https?:\/\/|magnet:\?)/i.test(u), 'Only http(s) and magnet links'),
  kind: z.enum(['page', 'file', 'stream', 'media', 'link']).catch('link'),
  filename: z.string().max(512).optional(),
  sizeBytes: z.number().nonnegative().optional(),
  mime: z.string().max(200).optional(),
  request: requestInfoSchema.catch({ headers: {}, cookies: [] }),
});
const pairSchema = z.object({ browser: z.string().min(1).max(60) });

const sha = (s: string) => createHash('sha256').update(s).digest();

let pairsCache: PairedBrowser[] | null = null;
let lastUsedWrite = 0;

export function pairedBrowsers(): PairedBrowser[] {
  pairsCache ??= loadSecret<PairedBrowser[]>('extension-pairs') ?? [];
  return pairsCache;
}

function savePairs(pairs: PairedBrowser[]) {
  pairsCache = pairs;
  saveSecret('extension-pairs', pairs);
}

export function revokeBrowser(id: string) {
  savePairs(pairedBrowsers().filter((p) => p.id !== id));
}

function authenticate(req: http.IncomingMessage): PairedBrowser | null {
  const token = req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token) return null;
  const hash = sha(token);
  const pairs = pairedBrowsers();
  const match = pairs.find((p) => timingSafeEqual(Buffer.from(p.tokenHash, 'hex'), hash));
  if (match) {
    match.lastUsedAt = Date.now();
    // Many captures can arrive per second; persist "last used" at most once a minute.
    if (Date.now() - lastUsedWrite > 60_000) {
      lastUsedWrite = Date.now();
      savePairs(pairs);
    }
  }
  return match ?? null;
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw Object.assign(new Error('Request too large'), { status: 413 });
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('Invalid JSON'), { status: 400 });
  }
}

export interface BridgeHandlers {
  window: () => BrowserWindow | null;
  /** Resolve once Lumina has really taken over (or refused). The signal aborts if the extension gives up waiting. */
  onCapture: (capture: CaptureRequest, signal: AbortSignal) => Promise<CaptureResult>;
  onPaired: () => void;
}

class BridgeServer {
  private server: http.Server | null = null;
  private port = 0;
  private pairing = false;
  /**
   * Whether the socket is genuinely bound, and why not when it isn't.
   *
   * Kept here rather than inferred from the setting: a busy port used to leave Settings saying
   * "Listening only on this computer" while nothing was listening at all, so the extension looked
   * broken and the one thing that would fix it — changing the port — was never suggested.
   */
  private listening = false;
  private lastError: string | null = null;
  /** Told when the bridge starts or stops listening, so Settings can follow along. */
  onStateChange: (() => void) | null = null;

  get state(): { listening: boolean; error: string | null } {
    return { listening: this.listening, error: this.lastError };
  }

  private setState(listening: boolean, error: string | null) {
    if (this.listening === listening && this.lastError === error) return;
    this.listening = listening;
    this.lastError = error;
    this.onStateChange?.();
  }

  start(handlers: BridgeHandlers) {
    const s = settings.get().extension;
    if (!s.enabled) return this.stop();
    if (this.server && this.port === s.port) return;
    this.stop();
    this.port = s.port;

    this.server = http.createServer((req, res) => {
      void this.handle(req, res, handlers).catch((err: Error & { status?: number }) => {
        if (!res.headersSent) this.json(res, err.status ?? 500, { error: err.status ? err.message : 'Internal error' }, req.headers.origin);
        if (!err.status) log.warn('Bridge request failed', err);
      });
    });
    // Keep-alive lets bursts of captures reuse connections.
    this.server.keepAliveTimeout = 30_000;
    this.server.on('error', (err: NodeJS.ErrnoException) => {
      const busy = err.code === 'EADDRINUSE';
      const message = busy
        ? `Port ${this.port} is already used by another program, so the extension can't reach Lumina. Pick a different port below.`
        : err.message;
      log.warn(busy ? `Port ${this.port} is in use; the browser extension can't connect. Change it in Settings › Browser extension.` : 'Bridge server error', err);
      this.setState(false, message);
    });
    // Loopback only: nothing on the network can reach this.
    this.server.listen(this.port, '127.0.0.1', () => {
      log.info(`Extension bridge listening on 127.0.0.1:${this.port}`);
      this.setState(true, null);
    });
  }

  stop() {
    this.server?.close();
    this.server = null;
    this.setState(false, null);
  }

  private json(res: http.ServerResponse, status: number, body: unknown, origin?: string) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    if (origin && EXTENSION_ORIGIN.test(origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers.Vary = 'Origin';
    }
    res.writeHead(status, headers);
    res.end(JSON.stringify(body));
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse, h: BridgeHandlers) {
    // Defeat DNS rebinding: the Host must be the loopback address we listen on.
    const host = req.headers.host ?? '';
    if (host !== `127.0.0.1:${this.port}` && host !== `localhost:${this.port}`) return this.json(res, 421, { error: 'Wrong host' });

    // Web pages can't use this API; only browser extensions. Extensions send their own Origin on most requests,
    // but Chrome omits it on simple GETs, so the extension also sends X-Lumina-Client. A web page can't add that
    // header without a CORS preflight, and preflights are only approved for extension origins.
    const origin = req.headers.origin ?? '';
    const fromExtension = EXTENSION_ORIGIN.test(origin) || (!origin && req.headers['x-lumina-client'] === 'extension');
    if (!fromExtension) return this.json(res, 403, { error: 'Only the Lumina browser extension can connect' });

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Lumina-Client',
        'Access-Control-Max-Age': '600', Vary: 'Origin',
      });
      return res.end();
    }

    const url = new URL(req.url ?? '/', `http://${host}`);
    const paired = authenticate(req);

    if (req.method === 'GET' && url.pathname === '/v1/hello') {
      const s = settings.get().extension;
      return this.json(res, 200, {
        app: 'Lumina', version: app.getVersion(), paired: Boolean(paired),
        captureDownloads: s.captureDownloads, minCaptureSizeMb: s.minCaptureSizeMb,
        skipExtensions: s.skipExtensions, skipSites: s.skipSites,
      }, origin);
    }

    if (req.method === 'POST' && url.pathname === '/v1/pair') {
      const body = pairSchema.safeParse(await readJson(req));
      if (!body.success) return this.json(res, 400, { error: 'Invalid pairing request' }, origin);
      if (this.pairing) return this.json(res, 429, { error: 'Another pairing request is waiting in Lumina' }, origin);
      this.pairing = true;
      try {
        // Automated tests in development approve without a dialog; packaged builds always ask.
        const autoApprove = !app.isPackaged && process.env.LUMINA_TEST_AUTO_APPROVE === '1';
        if (!autoApprove) {
          const win = h.window();
          win?.show();
          win?.focus();
          const options = {
            type: 'question' as const, buttons: ['Allow', 'Don’t allow'], defaultId: 1, cancelId: 1, noLink: true,
            title: 'Connect browser extension',
            message: `Allow the Lumina extension in ${body.data.browser} to send downloads?`,
            detail: 'It will be able to add links, files and streams you choose to Lumina’s queue. You can disconnect it any time in Settings › Browser extension.',
          };
          const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
          if (response !== 0) return this.json(res, 403, { error: 'Pairing was declined in Lumina' }, origin);
        }
        const token = randomBytes(32).toString('hex');
        const pairs = pairedBrowsers().filter((p) => !origin || p.origin !== origin);
        pairs.push({ id: randomBytes(8).toString('hex'), browser: body.data.browser, origin, tokenHash: sha(token).toString('hex'), createdAt: Date.now(), lastUsedAt: Date.now() });
        savePairs(pairs);
        h.onPaired();
        return this.json(res, 200, { token }, origin);
      } finally {
        this.pairing = false;
      }
    }

    if (!paired) return this.json(res, 401, { error: 'Not paired. Open the extension and connect it to Lumina.' }, origin);

    if (req.method === 'POST' && url.pathname === '/v1/capture') {
      const body = captureSchema.safeParse(await readJson(req));
      if (!body.success) return this.json(res, 400, { error: body.error.issues[0]?.message ?? 'Invalid request' }, origin);
      // If the extension stops waiting (timeout, tab closed), Lumina backs out so there's never a duplicate.
      const abort = new AbortController();
      res.on('close', () => {
        if (!res.writableFinished) abort.abort();
      });
      const result = await h.onCapture(body.data as CaptureRequest, abort.signal);
      if (abort.signal.aborted) return;
      return this.json(res, result.accepted ? 202 : 200, result, origin);
    }

    return this.json(res, 404, { error: 'Not found' }, origin);
  }
}

export const bridge = new BridgeServer();
