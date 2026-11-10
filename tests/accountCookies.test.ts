import { describe, it, expect } from 'vitest';
import type { CapturedCookie } from '@shared/types';
import { cookieUrl, hasLiveSession, isLoginSite, loginCookies } from '@core/accountCookies';

const c = (name: string, domain: string, extra: Partial<CapturedCookie> = {}): CapturedCookie => ({
  name, value: 'v', domain, path: '/', secure: true, httpOnly: true, ...extra,
});
const NOW = 1_800_000_000;

describe('taking the sign-in of one site from the person’s browser', () => {
  it('keeps only the cookies on that site’s own domains, and drops everything else the browser sent', () => {
    const sent = [c('SID', '.google.com'), c('LOGIN_INFO', '.youtube.com'), c('PREF', 'www.youtube.com'), c('session', '.bank.example'), c('sid', 'evil-google.com.example')];
    expect(loginCookies(sent, 'youtube').map((x) => x.name)).toEqual(['SID', 'LOGIN_INFO', 'PREF']);
  });

  it('does not count a look-alike domain as the site', () => {
    expect(loginCookies([c('SID', 'notgoogle.com'), c('SID', 'google.com.evil.test')], 'youtube')).toEqual([]);
  });

  it('ignores a malformed entry instead of failing on it', () => {
    const odd = [null, { name: 5, value: 'x', domain: '.google.com' }, c('SID', '.google.com')] as unknown as CapturedCookie[];
    expect(loginCookies(odd, 'youtube')).toHaveLength(1);
  });
});

describe('whether those cookies are a live sign-in', () => {
  it('is signed in when a Google session cookie is present and has not expired', () => {
    expect(hasLiveSession([c('__Secure-3PSID', '.google.com', { expirationDate: NOW + 1000 })], 'youtube', NOW)).toBe(true);
  });

  it('counts a session cookie with no expiry, which lasts as long as the browser does', () => {
    expect(hasLiveSession([c('SID', '.google.com')], 'youtube', NOW)).toBe(true);
  });

  it('is not signed in with only ordinary cookies, or with an expired or empty session cookie', () => {
    expect(hasLiveSession([c('PREF', '.youtube.com'), c('CONSENT', '.google.com')], 'youtube', NOW)).toBe(false);
    expect(hasLiveSession([c('SID', '.google.com', { expirationDate: NOW - 5 })], 'youtube', NOW)).toBe(false);
    expect(hasLiveSession([c('SID', '.google.com', { value: '' })], 'youtube', NOW)).toBe(false);
  });

  it('is not signed in on the strength of a sign-in cookie from some other site', () => {
    expect(hasLiveSession([c('SID', '.example.com')], 'youtube', NOW)).toBe(false);
  });
});

describe('the pieces the cookie store needs', () => {
  it('builds the address a cookie belongs to', () => {
    expect(cookieUrl({ domain: '.google.com', path: '/', secure: true })).toBe('https://google.com/');
    expect(cookieUrl({ domain: 'www.youtube.com', path: '/watch', secure: false })).toBe('http://www.youtube.com/watch');
    expect(cookieUrl({ domain: '.youtube.com', path: '', secure: true })).toBe('https://youtube.com/');
  });

  it('only accepts sites it knows how to sign in to', () => {
    expect(isLoginSite('youtube')).toBe(true);
    expect(isLoginSite('toString')).toBe(false);
    expect(isLoginSite('bank')).toBe(false);
    expect(isLoginSite(undefined)).toBe(false);
  });
});
