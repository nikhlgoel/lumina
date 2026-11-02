import { describe, expect, it } from 'vitest';
import { CHALLENGE_COOKIE as extensionList, isChallengeCookie, withoutChallengeCookies } from '@core/challengeCookies';
import { isLinkFromPage, isPageHost } from '@core/hosts';
// The extension is plain browser JavaScript, so it has no type declarations; importing it here is what keeps its copy of the list honest.
// @ts-expect-error TS7016: no declaration file for a plain .js module
import { CHALLENGE_COOKIE as extensionCopy, fitToBridge, MAX_BODY_BYTES } from '../extension/lib.js';

describe('cookies that prove a bot check was passed', () => {
  it('are recognised by name', () => {
    for (const name of ['cf_clearance', '__cf_bm', 'cf_chl_opt', '__cf_chl_rt_tk', 'cf_chl_2', 'datadome', 'CF_CLEARANCE']) {
      expect(isChallengeCookie(name), name).toBe(true);
    }
  });

  it('leave every other cookie alone', () => {
    for (const name of ['file_code', 'session', 'PHPSESSID', 'xfsts', 'lang', '_cfuvid', 'cf_other', 'my_cf_clearance', 'datadomeish']) {
      expect(isChallengeCookie(name), name).toBe(false);
    }
  });

  it('are dropped from a list of cookies, keeping the order of the rest', () => {
    const jar = [{ name: 'file_code', value: 'a' }, { name: 'cf_clearance', value: 'x' }, { name: 'lang', value: 'en' }, { name: '__cf_bm', value: 'y' }];
    expect(withoutChallengeCookies(jar).map((c) => c.name)).toEqual(['file_code', 'lang']);
  });

  it('are the same list in the extension and in the app', () => {
    expect(extensionCopy.source).toBe(extensionList.source);
    expect(extensionCopy.flags).toBe(extensionList.flags);
  });
});

describe('a capture that is too big for the bridge', () => {
  const cookie = (domain: string, i: number, size = 3500) => ({ name: `c${i}`, value: 'x'.repeat(size), domain, path: '/', secure: true, httpOnly: false });
  const bodyWith = (cookies: ReturnType<typeof cookie>[], urls = 3) => ({
    urls: Array.from({ length: urls }, (_, i) => `https://datanodes.to/x${i}/F.part${i}.rar`),
    request: { pageUrl: 'https://forum.example.org/post/1', pageTitle: 'Post', headers: { Referer: 'https://forum.example.org/post/1' }, cookies },
  });
  const bytes = (b: unknown) => new TextEncoder().encode(JSON.stringify(b)).length;

  it('is left exactly as it is when it already fits', () => {
    const body = bodyWith([cookie('forum.example.org', 1, 100)]);
    expect(fitToBridge(body)).toBe(body);
  });

  it('loses the cookies of other sites first, and keeps the page’s own', () => {
    const own = Array.from({ length: 10 }, (_, i) => cookie('.forum.example.org', i)); // 35 KB
    const other = Array.from({ length: 150 }, (_, i) => cookie('.tracker.example.net', i)); // 525 KB
    const fitted = fitToBridge(bodyWith([...own, ...other]));
    expect(bytes(fitted)).toBeLessThanOrEqual(MAX_BODY_BYTES);
    expect(fitted.request.cookies).toHaveLength(10);
    expect(fitted.request.cookies.every((c: { domain: string }) => c.domain === '.forum.example.org')).toBe(true);
  });

  it('loses every cookie rather than fail, and never touches the links or the page', () => {
    const own = Array.from({ length: 150 }, (_, i) => cookie('forum.example.org', i)); // the page's own cookies alone are too big
    const body = bodyWith(own, 40);
    const fitted = fitToBridge(body);
    expect(fitted.request.cookies).toEqual([]);
    expect(fitted.urls).toEqual(body.urls);
    expect(fitted.request.pageUrl).toBe(body.request.pageUrl);
    expect(bytes(fitted)).toBeLessThanOrEqual(MAX_BODY_BYTES);
  });

  it('stays under what the bridge accepts', () => {
    expect(MAX_BODY_BYTES).toBeLessThan(512 * 1024);
  });
});

describe('a link picked on a page versus a file the browser was already fetching', () => {
  it('is a page link when nothing came with it (pasted, typed)', () => {
    expect(isLinkFromPage(undefined)).toBe(true);
    expect(isLinkFromPage(null)).toBe(true);
  });

  it('is a page link when the extension says the person picked it, even though a request came with it', () => {
    expect(isLinkFromPage({ fromLink: true })).toBe(true);
  });

  it('is not a page link when the browser had already started the download', () => {
    expect(isLinkFromPage({})).toBe(false);
    expect(isLinkFromPage({ fromLink: false })).toBe(false);
  });

  it('together decide that a file-host link sent from the browser is a download page to click through', () => {
    const link = 'https://datanodes.to/ax1/Game.part01.rar';
    expect(isPageHost(link) && isLinkFromPage({ fromLink: true })).toBe(true);
    expect(isPageHost(link) && isLinkFromPage({})).toBe(false);
  });
});
