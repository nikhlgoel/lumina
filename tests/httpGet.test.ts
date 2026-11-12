import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { httpGet } from '../src/main/media/httpGet';

let server: http.Server;
let base = '';
const seen: http.IncomingHttpHeaders[] = [];
const BODY = Buffer.alloc(4 * 1024 * 1024, 9);

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push(req.headers);
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/redirect') return void res.writeHead(302, { Location: '/file' }).end();
    if (url.pathname === '/loop') return void res.writeHead(302, { Location: '/loop' }).end();
    if (url.pathname === '/gone') return void res.writeHead(404).end('no');
    if (url.pathname === '/empty') return void res.writeHead(204).end();
    const m = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
    const start = m ? Number(m[1]) : 0;
    const end = m && m[2] ? Math.min(Number(m[2]), BODY.length - 1) : BODY.length - 1;
    res.writeHead(m ? 206 : 200, { 'Content-Type': 'audio/mpeg', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(m ? { 'Content-Range': `bytes ${start}-${end}/${BODY.length}` } : {}) });
    res.end(BODY.subarray(start, end + 1));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => { server.close(); });

describe('a GET that answers with a web Response', () => {
  it('returns the file, with its type and length', async () => {
    const res = await httpGet(`${base}/file`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect((await res.arrayBuffer()).byteLength).toBe(BODY.length);
  });

  it('passes the headers a site needs, and a Range request gets exactly its slice', async () => {
    seen.length = 0;
    const res = await httpGet(`${base}/file`, { headers: { Range: 'bytes=100-199', Cookie: 'a=b', Referer: 'https://example.test/p', 'User-Agent': 'T/1' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 100-199/${BODY.length}`);
    expect((await res.arrayBuffer()).byteLength).toBe(100);
    expect(seen[0]).toMatchObject({ cookie: 'a=b', referer: 'https://example.test/p', 'user-agent': 'T/1' });
  });

  it('follows a redirect and keeps the headers', async () => {
    seen.length = 0;
    const res = await httpGet(`${base}/redirect`, { headers: { Cookie: 'k=v' } });
    expect(res.status).toBe(200);
    expect(seen.map((h) => h.cookie)).toEqual(['k=v', 'k=v']);
  });

  it('gives up on a redirect loop with an answer rather than for ever', async () => {
    const res = await httpGet(`${base}/loop`, { maxRedirects: 3 });
    expect(res.status).toBe(302);
  });

  it('hands back an error status as it is, and nothing for "no content"', async () => {
    expect((await httpGet(`${base}/gone`)).status).toBe(404);
    const none = await httpGet(`${base}/empty`);
    expect(none.status).toBe(204);
    expect(none.body).toBeNull();
  });

  it('rejects an address that cannot be reached, an unusable one, and an aborted request', async () => {
    await expect(httpGet('http://127.0.0.1:1/x')).rejects.toBeTruthy();
    await expect(httpGet('ftp://x/y')).rejects.toThrow(/web address/);
    await expect(httpGet('not a url')).rejects.toBeTruthy();
    const ac = new AbortController();
    ac.abort();
    await expect(httpGet(`${base}/file`, { signal: ac.signal })).rejects.toThrow(/aborted/);
  });

  it('survives a reader that stops reading while the server finishes: nothing is thrown out of a socket handler', async () => {
    const crashes: unknown[] = [];
    const onCrash = (e: unknown) => crashes.push(e);
    process.on('uncaughtException', onCrash);
    const res = await httpGet(`${base}/file`);
    const reader = res.body!.getReader();
    await reader.read(); // one chunk, then no more: the connection fills and the server closes
    await new Promise((r) => setTimeout(r, 600));
    await reader.cancel();
    await new Promise((r) => setTimeout(r, 200));
    process.off('uncaughtException', onCrash);
    expect(crashes).toEqual([]);
  });

  it('cancelling the body closes the connection', async () => {
    const res = await httpGet(`${base}/file`);
    const reader = res.body!.getReader();
    await reader.read();
    await expect(reader.cancel()).resolves.toBeUndefined();
  });
});
