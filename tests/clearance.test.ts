import { describe, expect, it } from 'vitest';
import { CLEARANCE_MAX_AGE_MS, ClearanceJar, clearanceSite, isClearanceProof, type ClearanceCookie } from '@core/clearance';

const MIN = 60_000;
const cookie = (name: string, domain = '.host.example', extra: Partial<ClearanceCookie> = {}): ClearanceCookie =>
  ({ name, value: `v-${name}`, domain, path: '/', secure: true, httpOnly: true, ...extra });

describe('which cookies prove a person passed a check', () => {
  it('are the ones that say so, and not the check’s own working state', () => {
    for (const n of ['cf_clearance', '__cf_bm', 'datadome', 'CF_CLEARANCE']) expect(isClearanceProof(n), n).toBe(true);
    for (const n of ['cf_chl_opt', '__cf_chl_rt_tk', 'cf_chl_2', 'file_code', 'session', 'PHPSESSID', 'xfsts']) expect(isClearanceProof(n), n).toBe(false);
  });
});

describe('remembering a check the person solved, for the rest of that site’s files', () => {
  it('keeps only the proof, never the cookie that says which file this page is for', () => {
    const jar = new ClearanceJar();
    const kept = jar.remember('host.example', [cookie('cf_clearance'), cookie('file_code'), cookie('session'), cookie('cf_chl_opt')], 0);
    expect(kept).toBe(1);
    expect(jar.recall('host.example', 1).map((c) => c.name)).toEqual(['cf_clearance']);
  });

  it('hands the proof only to the site it came from', () => {
    const jar = new ClearanceJar();
    jar.remember('host.example', [cookie('cf_clearance')], 0);
    expect(jar.recall('other.example', 1)).toEqual([]);
    expect(jar.recall('sub.host.example', 1)).toEqual([]);
  });

  it('refuses a cookie that belongs to another site, even when it arrives with this site’s page', () => {
    const jar = new ClearanceJar();
    expect(jar.remember('host.example', [cookie('cf_clearance', '.ads.example'), cookie('datadome', 'www.host.example')], 0)).toBe(1);
    expect(jar.recall('host.example', 1).map((c) => c.domain)).toEqual(['www.host.example']);
  });

  it('forgets the proof after it has been kept too long, whatever the site said about its expiry', () => {
    const jar = new ClearanceJar();
    jar.remember('host.example', [cookie('cf_clearance', '.host.example', { expirationDate: (10 * 24 * 3600 * 1000) / 1000 })], 0);
    expect(jar.recall('host.example', CLEARANCE_MAX_AGE_MS - 1)).toHaveLength(1);
    expect(jar.recall('host.example', CLEARANCE_MAX_AGE_MS + 1)).toEqual([]);
    expect(jar.has('host.example', CLEARANCE_MAX_AGE_MS + 1)).toBe(false);
  });

  it('forgets a cookie the site itself had already expired', () => {
    const jar = new ClearanceJar();
    jar.remember('host.example', [cookie('cf_clearance', '.host.example', { expirationDate: 5 * 60 })], 0);
    expect(jar.recall('host.example', 4 * MIN)).toHaveLength(1);
    expect(jar.recall('host.example', 6 * MIN)).toEqual([]);
  });

  it('does not keep a cookie that was already expired when it was offered', () => {
    const jar = new ClearanceJar();
    expect(jar.remember('host.example', [cookie('cf_clearance', '.host.example', { expirationDate: 100 })], 200_000)).toBe(0);
    expect(jar.has('host.example', 200_000)).toBe(false);
  });

  it('keeps the newest value when the same check is solved again', () => {
    const jar = new ClearanceJar();
    jar.remember('host.example', [cookie('cf_clearance', '.host.example', { value: 'old' })], 0);
    jar.remember('host.example', [cookie('cf_clearance', '.host.example', { value: 'new' })], 1000);
    expect(jar.recall('host.example', 2000).map((c) => c.value)).toEqual(['new']);
  });

  it('can be told to let go, for one site or for all', () => {
    const jar = new ClearanceJar();
    jar.remember('a.example', [cookie('cf_clearance', '.a.example')], 0);
    jar.remember('b.example', [cookie('cf_clearance', '.b.example')], 0);
    jar.forget('a.example');
    expect(jar.has('a.example', 1)).toBe(false);
    expect(jar.has('b.example', 1)).toBe(true);
    jar.clear();
    expect(jar.has('b.example', 1)).toBe(false);
  });

  it('copes with nothing to remember', () => {
    const jar = new ClearanceJar();
    expect(jar.remember('host.example', [], 0)).toBe(0);
    expect(jar.recall('never-seen.example', 0)).toEqual([]);
  });
});

describe('which site a solved check belongs to', () => {
  it('is the site, so a host’s other subdomains share it', () => {
    expect(clearanceSite('www.host.example')).toBe('host.example');
    expect(clearanceSite('dl.host.example')).toBe('host.example');
    expect(clearanceSite('files.host.co.uk')).toBe('host.co.uk');
  });

  it('is the address itself for an IP address or a single-word host, which have no site above them', () => {
    expect(clearanceSite('127.0.0.1')).toBe('127.0.0.1');
    expect(clearanceSite('192.168.1.20')).toBe('192.168.1.20');
    expect(clearanceSite('localhost')).toBe('localhost');
    expect(clearanceSite('[::1]')).toBe('[::1]');
    expect(clearanceSite('::1')).toBe('::1');
  });
});

describe('platforms where strangers share one domain', () => {
  it('are told apart by the name each got, so one tenant’s solved check is not another’s', () => {
    expect(clearanceSite('alice.github.io')).toBe('alice.github.io');
    expect(clearanceSite('www.alice.github.io')).toBe('alice.github.io');
    expect(clearanceSite('bob.github.io')).not.toBe(clearanceSite('alice.github.io'));
    expect(clearanceSite('shop.pages.dev')).toBe('shop.pages.dev');
    expect(clearanceSite('app.netlify.app')).toBe('app.netlify.app');
  });

  it('leave an ordinary site alone', () => {
    expect(clearanceSite('dl.example.com')).toBe('example.com');
    expect(clearanceSite('files.example.co.uk')).toBe('example.co.uk');
  });
});
