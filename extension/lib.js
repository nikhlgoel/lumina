// Shared helpers for the background worker and the popup.

export const DEFAULT_PORT = 17865;
const isFirefox = typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent);

export async function getConfig() {
  const cfg = await chrome.storage.local.get({ port: DEFAULT_PORT, token: null, captureDownloads: true, selectionPrompt: true });
  return cfg;
}

export async function setConfig(patch) {
  await chrome.storage.local.set(patch);
}

export function browserName() {
  if (isFirefox) return 'Firefox';
  const brands = navigator.userAgentData?.brands?.map((b) => b.brand) ?? [];
  if (navigator.brave) return 'Brave';
  if (brands.some((b) => /Edge/i.test(b))) return 'Microsoft Edge';
  if (brands.some((b) => /Opera/i.test(b))) return 'Opera';
  if (brands.some((b) => /Vivaldi/i.test(b))) return 'Vivaldi';
  return 'Chrome';
}

/** Lumina's bridge refuses a body over 512 KB; stay well under it. */
export const MAX_BODY_BYTES = 400_000;

/**
 * Make a capture body fit the bridge. A site with large cookies could make a perfectly good batch fail with "Request too large", and the
 * cookies matter least (a file host's page is opened in Lumina's own browser with a fresh jar). So cookies go first: those of other sites,
 * then all of them. The links themselves are never cut.
 */
export function fitToBridge(body, max = MAX_BODY_BYTES) {
  const size = (b) => new TextEncoder().encode(JSON.stringify(b)).length;
  if (size(body) <= max) return body;
  const host = (() => { try { return new URL(body.request.pageUrl).hostname; } catch { return ''; } })();
  const ofPage = (c) => { const d = String(c.domain ?? '').replace(/^\./, ''); return Boolean(host) && Boolean(d) && (host === d || host.endsWith(`.${d}`)); };
  const pageOnly = { ...body, request: { ...body.request, cookies: body.request.cookies.filter(ofPage) } };
  if (size(pageOnly) <= max) return pageOnly;
  return { ...body, request: { ...body.request, cookies: [] } };
}

async function request(path, { method = 'GET', body, timeoutMs = 4000 } = {}) {
  const { port, token } = await getConfig();
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Lumina-Client': 'extension', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

/** { running, paired, captureDownloads, minCaptureSizeMb, version } */
export async function hello() {
  try {
    const r = await request('/v1/hello');
    return r.ok ? { running: true, ...r.data } : { running: true, paired: false };
  } catch {
    return { running: false, paired: false };
  }
}

export async function pair() {
  // Waits for the user to answer the prompt inside Lumina.
  const r = await request('/v1/pair', { method: 'POST', body: { browser: browserName() }, timeoutMs: 120_000 });
  if (!r.ok) throw new Error(r.data?.error ?? 'Pairing failed');
  await setConfig({ token: r.data.token });
}

// Cookies that prove a bot check was passed (Cloudflare clearance, DataDome). They stay in the browser: when a site puts up a check, the
// person solves it themselves, in Lumina's own browser. Same list as src/core/challengeCookies.ts; a test keeps the two together.
export const CHALLENGE_COOKIE = /^(?:cf_clearance|__cf_bm|__cf_chl_[\w-]*|cf_chl_[\w-]*|datadome)$/i;

export async function cookiesFor(...urls) {
  const seen = new Map();
  for (const url of urls) {
    if (!url || !/^https?:/.test(url)) continue;
    try {
      for (const c of await chrome.cookies.getAll({ url })) {
        if (CHALLENGE_COOKIE.test(c.name)) continue;
        seen.set(`${c.domain}|${c.path}|${c.name}`, {
          name: c.name, value: c.value, domain: c.domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly,
          ...(c.expirationDate ? { expirationDate: c.expirationDate } : {}),
        });
      }
    } catch {
      // cookies permission missing for this host
    }
  }
  return [...seen.values()].slice(0, 400);
}

/**
 * Send something to Lumina. Resolves { accepted, reason }.
 * For browser downloads Lumina answers only once data is flowing, so this can take a few seconds.
 */
export async function capture({ url, kind, pageUrl, pageTitle, headers = {}, filename, sizeBytes, mime }, timeoutMs = 8000) {
  const cookies = await cookiesFor(url, pageUrl);
  const cleanHeaders = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v && /^(referer|origin|user-agent|accept-language|authorization|x-[a-z0-9-]+)$/i.test(k)) cleanHeaders[k] = v;
  }
  if (pageUrl && /^https?:/.test(pageUrl) && !Object.keys(cleanHeaders).some((k) => k.toLowerCase() === 'referer')) cleanHeaders.Referer = pageUrl;
  try {
    const r = await request('/v1/capture', {
      method: 'POST',
      timeoutMs,
      body: fitToBridge({ url, kind, filename, sizeBytes, mime, request: { pageUrl, pageTitle, headers: cleanHeaders, cookies } }),
    });
    if (r.status === 401) await setConfig({ token: null });
    return { accepted: Boolean(r.ok && r.data?.accepted !== false), reason: r.data?.reason ?? r.data?.error };
  } catch (err) {
    return { accepted: false, reason: err?.name === 'TimeoutError' ? 'Lumina took too long to answer' : 'Lumina isn’t reachable' };
  }
}

/**
 * Send several links picked on one page as one request, so Lumina can plan them together (archive parts in order, optional extras and
 * checksums separated) and the person confirms once. Resolves { accepted, count, reason, unsupported }; `unsupported` means this Lumina is
 * older than the batch request, and the caller should send the links one at a time instead.
 */
export async function captureBatch({ urls, pageUrl, pageTitle }, timeoutMs = 15_000) {
  const origins = [...new Set(urls.map((u) => { try { return new URL(u).origin; } catch { return ''; } }).filter(Boolean))].slice(0, 6);
  const cookies = await cookiesFor(pageUrl, ...origins);
  const headers = pageUrl && /^https?:/.test(pageUrl) ? { Referer: pageUrl } : {};
  try {
    const r = await request('/v1/capture-batch', { method: 'POST', timeoutMs, body: fitToBridge({ urls, request: { pageUrl, pageTitle, headers, cookies } }) });
    if (r.status === 401) await setConfig({ token: null });
    if (r.status === 404) return { accepted: false, unsupported: true };
    return { accepted: Boolean(r.ok && r.data?.accepted !== false), count: r.data?.count ?? urls.length, reason: r.data?.reason ?? r.data?.error };
  } catch (err) {
    return { accepted: false, reason: err?.name === 'TimeoutError' ? 'Lumina took too long to answer' : 'Lumina isn’t reachable' };
  }
}

export const formatBytes = (n) => {
  if (!n) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
};
