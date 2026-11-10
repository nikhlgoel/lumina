import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const { PORT } = vi.hoisted(() => ({ PORT: 17971 }));

// The bridge only needs these four things from the rest of the app; none of them may touch a real profile or open a window.
vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0-test', isPackaged: false }, dialog: { showMessageBox: vi.fn() } }));
vi.mock('../src/main/settings', () => ({
  settings: { get: () => ({ extension: { enabled: true, port: PORT, captureDownloads: true, minCaptureSizeMb: 0, skipExtensions: [], skipSites: [] } }) },
}));
vi.mock('../src/main/secrets', () => {
  let stored: unknown = null;
  return { loadSecret: () => stored, saveSecret: (_key: string, value: unknown) => { stored = value; } };
});
vi.mock('../src/main/log', () => ({ logger: () => ({ info: () => undefined, warn: () => undefined, debug: () => undefined, error: () => undefined }) }));

type Bridge = (typeof import('../src/main/bridge/server'))['bridge'];
let bridge: Bridge;
let token = '';
const batches: { urls: string[]; request: { cookies: { name: string }[]; fromLink?: boolean; pageUrl?: string } }[] = [];
const captures: { kind: string; request: { cookies: { name: string }[]; fromLink?: boolean } }[] = [];
const logins: { site: string; names: string[] }[] = [];

const call = (path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}) =>
  fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: init.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Lumina-Client': 'extension', ...(init.auth === false ? {} : { Authorization: `Bearer ${token}` }) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

const jar = (names: string[]) => names.map((name) => ({ name, value: 'v', domain: 'host.test', path: '/', secure: true, httpOnly: false }));

beforeAll(async () => {
  process.env.LUMINA_TEST_AUTO_APPROVE = '1';
  ({ bridge } = await import('../src/main/bridge/server'));
  bridge.start({
    window: () => null,
    onCapture: async (c) => { captures.push(c as never); return { accepted: true }; },
    onCaptureBatch: async (urls, request) => { batches.push({ urls, request: request as never }); return { accepted: true, count: urls.length }; },
    onAccountCookies: async (site, cookies) => {
      logins.push({ site, names: cookies.map((c) => c.name) });
      return { saved: cookies.length, signedIn: cookies.some((c) => c.name === 'SID') };
    },
    onPaired: () => undefined,
  });
  for (let i = 0; i < 50 && !bridge.state.listening; i++) await new Promise((r) => setTimeout(r, 50));
  expect(bridge.state.listening).toBe(true);
  const paired = await call('/v1/pair', { method: 'POST', body: { browser: 'Test' }, auth: false });
  token = ((await paired.json()) as { token: string }).token;
  expect(token).toMatch(/^[a-f0-9]{64}$/);
});

afterAll(() => bridge.stop());

describe('the extension bridge', () => {
  it('tells the extension that batches are understood', async () => {
    const hello = (await (await call('/v1/hello')).json()) as { batch?: boolean; paired?: boolean };
    expect(hello).toMatchObject({ batch: true, paired: true });
  });

  it('takes several links as one batch, each once, in order', async () => {
    const res = await call('/v1/capture-batch', {
      method: 'POST',
      body: { urls: ['https://fuckingfast.co/a#File.part1.rar', 'https://fuckingfast.co/b#File.part2.rar', 'https://fuckingfast.co/a#File.part1.rar'], request: { pageUrl: 'https://example.org/post', headers: {}, cookies: [] } },
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ accepted: true, count: 2 });
    expect(batches.at(-1)!.urls).toEqual(['https://fuckingfast.co/a#File.part1.rar', 'https://fuckingfast.co/b#File.part2.rar']);
    expect(batches.at(-1)!.request.pageUrl).toBe('https://example.org/post');
  });

  it('never passes on cookies that prove a bot check was passed, whatever the extension sent', async () => {
    await call('/v1/capture-batch', {
      method: 'POST',
      body: { urls: ['https://datanodes.to/x/F.rar'], request: { headers: {}, cookies: jar(['file_code', 'cf_clearance', '__cf_bm', 'cf_chl_opt', 'datadome', 'lang']) } },
    });
    expect(batches.at(-1)!.request.cookies.map((c) => c.name)).toEqual(['file_code', 'lang']);

    await call('/v1/capture', {
      method: 'POST',
      body: { url: 'https://datanodes.to/x/F.rar', kind: 'link', request: { headers: {}, cookies: jar(['cf_clearance', 'session']) } },
    });
    expect(captures.at(-1)!.request.cookies.map((c) => c.name)).toEqual(['session']);
  });

  it('marks links picked on a page, so a file host’s page is clicked through, and leaves browser downloads alone', async () => {
    expect(batches.at(-1)!.request.fromLink).toBe(true);
    await call('/v1/capture', { method: 'POST', body: { url: 'https://example.org/a.zip', kind: 'link', request: { headers: {}, cookies: [] } } });
    expect(captures.at(-1)!.request.fromLink).toBe(true);
    await call('/v1/capture', { method: 'POST', body: { url: 'https://example.org/a.zip', kind: 'page', request: { headers: {}, cookies: [] } } });
    expect(captures.at(-1)!.request.fromLink).toBe(true);
    await call('/v1/capture', { method: 'POST', body: { url: 'https://example.org/a.zip', kind: 'file', request: { headers: {}, cookies: [] } } });
    expect(captures.at(-1)!.request.fromLink).toBeUndefined();
  });

  it('refuses a batch from anyone who has not paired', async () => {
    const res = await call('/v1/capture-batch', { method: 'POST', auth: false, body: { urls: ['https://example.org/a.zip'], request: { headers: {}, cookies: [] } } });
    expect(res.status).toBe(401);
  });

  it('refuses anything that is not a web or magnet link, an empty batch, and an oversized one', async () => {
    const bad = (urls: unknown[]) => call('/v1/capture-batch', { method: 'POST', body: { urls, request: { headers: {}, cookies: [] } } });
    expect((await bad(['file:///etc/passwd'])).status).toBe(400);
    expect((await bad(['javascript:alert(1)'])).status).toBe(400);
    expect((await bad([])).status).toBe(400);
    expect((await bad(Array.from({ length: 501 }, (_, i) => `https://example.org/${i}.zip`))).status).toBe(400);
    expect((await bad(Array.from({ length: 500 }, (_, i) => `https://example.org/${i}.zip`))).status).toBe(202);
  });

  it('answers an oversized request with a refusal, and keeps serving', async () => {
    const before = batches.length;
    const huge = await call('/v1/capture-batch', { method: 'POST', body: { urls: ['https://example.org/a.zip'], request: { headers: {}, cookies: [], pad: 'x'.repeat(700_000) } } });
    // The sender must be told why, not just dropped.
    expect(huge.status).toBe(413);
    expect(await huge.json()).toMatchObject({ error: 'Request too large' });
    expect(batches.length).toBe(before);
    expect((await call('/v1/hello')).status).toBe(200); // still alive
  }, 15_000);

  it('answers broken JSON with a 400', async () => {
    const broken = await fetch(`http://127.0.0.1:${PORT}/v1/capture-batch`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Lumina-Client': 'extension', Authorization: `Bearer ${token}` }, body: '{"urls": [' });
    expect(broken.status).toBe(400);
  });

  it('answers a wrongly shaped batch with a 400', async () => {
    for (const body of [{}, { urls: 'https://example.org/a.zip' }, { urls: [42] }, { urls: [null] }, { request: {} }]) {
      expect((await call('/v1/capture-batch', { method: 'POST', body })).status, JSON.stringify(body)).toBe(400);
    }
    expect((await call('/v1/hello')).status).toBe(200);
  });

  it('does not hand a batch to the app when one link in it is not a link', async () => {
    const before = batches.length;
    const res = await call('/v1/capture-batch', { method: 'POST', body: { urls: ['https://example.org/a.zip', 'ftp://example.org/b.zip'], request: { headers: {}, cookies: [] } } });
    expect(res.status).toBe(400);
    expect(batches.length).toBe(before);
  });

  describe('handing over a site’s sign-in from the person’s own browser', () => {
    const body = (site: string, names: string[]) => ({ site, request: { headers: {}, cookies: jar(names) } });

    it('tells the extension that the app can take a sign-in, so an older app is simply not offered one', async () => {
      expect(((await (await call('/v1/hello')).json()) as { accounts?: boolean }).accounts).toBe(true);
    });

    it('takes the cookies for a site it knows and says it is signed in', async () => {
      const res = await call('/v1/account-cookies', { method: 'POST', body: body('youtube', ['SID', 'PREF']) });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ saved: 2, signedIn: true });
      expect(logins.at(-1)).toEqual({ site: 'youtube', names: ['SID', 'PREF'] });
    });

    it('answers 422 with a plain reason when the browser holds no sign-in', async () => {
      const res = await call('/v1/account-cookies', { method: 'POST', body: body('youtube', ['PREF']) });
      expect(res.status).toBe(422);
      expect(((await res.json()) as { error: string }).error).toMatch(/isn’t signed in/);
    });

    it('refuses a site it does not know how to sign in to, and never calls the app for it', async () => {
      const before = logins.length;
      expect((await call('/v1/account-cookies', { method: 'POST', body: body('bank', ['SID']) })).status).toBe(400);
      expect((await call('/v1/account-cookies', { method: 'POST', body: body('toString', ['SID']) })).status).toBe(400);
      expect((await call('/v1/account-cookies', { method: 'POST', body: { request: { headers: {}, cookies: [] } } })).status).toBe(400);
      expect(logins.length).toBe(before);
    });

    it('refuses anyone who has not paired, and a web page pretending to be the extension', async () => {
      expect((await call('/v1/account-cookies', { method: 'POST', auth: false, body: body('youtube', ['SID']) })).status).toBe(401);
      const res = await fetch(`http://127.0.0.1:${PORT}/v1/account-cookies`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example', Authorization: `Bearer ${token}` }, body: JSON.stringify(body('youtube', ['SID'])),
      });
      expect(res.status).toBe(403);
    });
  });

  it('still refuses a web page pretending to be the extension', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/v1/capture-batch`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ urls: ['https://example.org/a.zip'], request: { headers: {}, cookies: [] } }),
    });
    expect(res.status).toBe(403);
  });
});
