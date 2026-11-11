import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isBotCheckResponse, isPageHost } from '@core/hosts';
import { isPrivateHost } from '@core/network';
import { fetchFollowing } from '@core/safeFetch';

describe('which addresses are this machine or its own network', () => {
  it.each(['localhost', 'LOCALHOST', 'app.localhost', '127.0.0.1', '127.1.2.3', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.1.1', '100.64.0.1', '0.0.0.0',
    '::1', '[::1]', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:127.0.0.1', 'printer.local', 'nas.lan', 'localhost.'])('%s is private', (h) => {
    expect(isPrivateHost(h), h).toBe(true);
  });

  it.each(['example.com', 'fileditchfiles.st', '8.8.8.8', '172.15.0.1', '172.32.0.1', '192.169.0.1', '100.63.0.1', '100.128.0.1', '2606:4700::1111', 'github.io', '1.1.1.1', ''])('%s is public', (h) => {
    expect(isPrivateHost(h), h).toBe(false);
  });
});

describe('telling a bot check from an ordinary refusal', () => {
  const h = (v: Record<string, string>) => (n: string) => v[n.toLowerCase()] ?? null;
  it('is a Cloudflare challenge answer', () => {
    expect(isBotCheckResponse(403, h({ 'cf-mitigated': 'challenge' }))).toBe(true);
    expect(isBotCheckResponse(503, h({ 'cf-mitigated': 'challenge' }))).toBe(true);
    expect(isBotCheckResponse(429, h({ 'cf-mitigated': 'challenge' }))).toBe(true);
  });
  it('is not a plain refusal, a missing file, or a success', () => {
    expect(isBotCheckResponse(403, h({}))).toBe(false);
    expect(isBotCheckResponse(403, h({ server: 'cloudflare' }))).toBe(false);
    expect(isBotCheckResponse(404, h({ 'cf-mitigated': 'challenge' }))).toBe(false);
    expect(isBotCheckResponse(200, h({ 'cf-mitigated': 'challenge' }))).toBe(false);
  });
});

describe('hosts Lumina opens a page for', () => {
  it('includes Gofile, whose links yt-dlp cannot read', () => {
    expect(isPageHost('https://gofile.io/d/AbC123')).toBe(true);
  });
});

// Two local servers that look like two different sites to the cookie rules: 127.0.0.1 and localhost.
describe('following a redirect without carrying what belongs to the first address', () => {
  let a: http.Server;
  let b: http.Server;
  let aPort = 0;
  let bPort = 0;
  const seenByB: http.IncomingHttpHeaders[] = [];

  beforeAll(async () => {
    b = http.createServer((req, res) => {
      seenByB.push(req.headers);
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('landed');
    });
    await new Promise<void>((r) => b.listen(0, '127.0.0.1', r));
    bPort = (b.address() as AddressInfo).port;
    a = http.createServer((req, res) => {
      const url = req.url ?? '/';
      if (url === '/to-other-site') return void res.writeHead(302, { Location: `http://localhost:${bPort}/final` }).end();
      if (url === '/to-private-from-public') return void res.writeHead(302, { Location: 'http://127.0.0.1:1/' }).end();
      if (url === '/loop') return void res.writeHead(302, { Location: '/loop' }).end();
      if (url === '/ftp') return void res.writeHead(302, { Location: 'ftp://example.com/x' }).end();
      res.writeHead(200).end('here');
    });
    await new Promise<void>((r) => a.listen(0, '127.0.0.1', r));
    aPort = (a.address() as AddressInfo).port;
  });
  afterAll(() => {
    a.close();
    b.close();
  });

  const cookie = (domain: string, name: string) => ({ name, value: `v-${name}`, domain, path: '/', secure: false, httpOnly: false });

  it('sends the next address only the cookies that belong to it, and not the credentials of the first', async () => {
    seenByB.length = 0;
    const { res, finalUrl } = await fetchFollowing(`http://127.0.0.1:${aPort}/to-other-site`, {
      headers: { 'User-Agent': 'test', Authorization: 'Bearer secret', Cookie: 'smuggled=1' },
      cookies: [cookie('127.0.0.1', 'for_first_site'), cookie('localhost', 'for_second_site')],
    });
    expect(await res.text()).toBe('landed');
    expect(finalUrl).toBe(`http://localhost:${bPort}/final`);
    const seen = seenByB[0];
    expect(seen?.cookie).toBe('for_second_site=v-for_second_site');
    expect(seen?.authorization).toBeUndefined();
    expect(seen?.['user-agent']).toBe('test');
  });

  it('stops a loop and a redirect to a non-web address', async () => {
    await expect(fetchFollowing(`http://127.0.0.1:${aPort}/loop`, { headers: {}, maxHops: 3 })).rejects.toThrow(/Too many redirects/);
    await expect(fetchFollowing(`http://127.0.0.1:${aPort}/ftp`, { headers: {} })).rejects.toThrow(/non-web/);
  });

  it('does not let a public address send Lumina to a private one', async () => {
    // A stand-in "public" server cannot be had on a loopback test, so drive the rule with a fetch that answers as one would.
    const fake: typeof fetch = async (input) => {
      const url = String(input);
      return url.startsWith('https://example.com/') ? new Response(null, { status: 302, headers: { Location: 'http://192.168.1.1/admin' } }) : new Response('private page');
    };
    await expect(fetchFollowing('https://example.com/start', { headers: {} }, fake)).rejects.toThrow(/private/);
  });

  it('lets a link that began on a private address go to another private address', async () => {
    const { res } = await fetchFollowing(`http://127.0.0.1:${aPort}/to-other-site`, { headers: {} });
    expect(res.status).toBe(200);
  });
});
