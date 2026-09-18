import { describe, it, expect } from 'vitest';
import { compareVersions, isNewerVersion, parseVersion, pickUpdate } from '@core/version';

describe('parseVersion', () => {
  it('parses a plain and a tagged version', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] });
    expect(parseVersion('v3.0.0')).toEqual({ major: 3, minor: 0, patch: 0, prerelease: [] });
  });

  it('splits prerelease identifiers, keeping numbers numeric', () => {
    expect(parseVersion('3.0.0-alpha.1')!.prerelease).toEqual(['alpha', 1]);
  });

  it('ignores build metadata', () => {
    expect(parseVersion('1.0.0+20260918')!.prerelease).toEqual([]);
  });

  it('returns null for junk', () => {
    expect(parseVersion('latest')).toBeNull();
    expect(parseVersion('1.2')).toBeNull();
    expect(parseVersion('')).toBeNull();
  });
});

describe('compareVersions', () => {
  it('orders by major, minor, then patch', () => {
    expect(compareVersions('1.0.0', '2.0.0')).toBe(-1);
    expect(compareVersions('1.2.0', '1.1.9')).toBe(1);
    expect(compareVersions('1.1.1', '1.1.1')).toBe(0);
  });

  it('ranks a prerelease below the release it leads to', () => {
    expect(compareVersions('3.0.0-alpha.0', '3.0.0')).toBe(-1);
    expect(compareVersions('3.0.0', '3.0.0-beta.9')).toBe(1);
  });

  it('orders prerelease identifiers the semver way', () => {
    expect(compareVersions('3.0.0-alpha.1', '3.0.0-alpha.2')).toBe(-1);
    expect(compareVersions('3.0.0-alpha.9', '3.0.0-beta.0')).toBe(-1);
    // Numeric identifiers rank below alphanumeric ones.
    expect(compareVersions('3.0.0-1', '3.0.0-alpha')).toBe(-1);
    // A longer prerelease with the same prefix is the later one.
    expect(compareVersions('3.0.0-alpha', '3.0.0-alpha.1')).toBe(-1);
  });

  it('treats an unparseable version as older, and never throws', () => {
    expect(compareVersions('nightly', '1.0.0')).toBe(-1);
    expect(compareVersions('1.0.0', 'nightly')).toBe(1);
    expect(compareVersions('junk', 'junk')).toBe(0);
  });

  it('isNewerVersion reads the comparison the obvious way', () => {
    expect(isNewerVersion('3.0.0-alpha.1', '3.0.0-alpha.0')).toBe(true);
    expect(isNewerVersion('3.0.0-alpha.0', '3.0.0-alpha.0')).toBe(false);
  });
});

describe('pickUpdate', () => {
  const current = '3.0.0-alpha.0';
  const rel = (tag: string, extra: Record<string, unknown> = {}) =>
    ({ tag_name: tag, html_url: `https://example.invalid/${tag}`, body: 'notes', published_at: '2026-09-18T00:00:00Z', ...extra });

  it('offers the highest newer stable release', () => {
    const got = pickUpdate([rel('v3.0.0'), rel('v3.1.0'), rel('v2.9.0')], current);
    expect(got?.version).toBe('3.1.0');
    expect(got?.url).toBe('https://example.invalid/v3.1.0');
  });

  it('offers nothing when nothing is newer', () => {
    expect(pickUpdate([rel('v3.0.0-alpha.0'), rel('v2.0.0')], current, { allowPrerelease: true })).toBeNull();
    expect(pickUpdate([], current)).toBeNull();
  });

  it('hides prereleases unless the user opted in', () => {
    const releases = [rel('v3.0.0-alpha.5', { prerelease: true })];
    expect(pickUpdate(releases, current)).toBeNull();
    expect(pickUpdate(releases, current, { allowPrerelease: true })?.version).toBe('3.0.0-alpha.5');
  });

  it('treats a version with a prerelease tag as a prerelease even if the flag is missing', () => {
    expect(pickUpdate([rel('v3.0.0-beta.1')], current)).toBeNull();
  });

  it('skips drafts and the version the user dismissed', () => {
    expect(pickUpdate([rel('v3.1.0', { draft: true })], current)).toBeNull();
    expect(pickUpdate([rel('v3.1.0')], current, { skipVersion: '3.1.0' })).toBeNull();
    expect(pickUpdate([rel('v3.1.0'), rel('v3.2.0')], current, { skipVersion: '3.1.0' })?.version).toBe('3.2.0');
  });

  it('survives junk from the network instead of throwing', () => {
    expect(pickUpdate(null, current)).toBeNull();
    expect(pickUpdate({ message: 'rate limited' }, current)).toBeNull();
    expect(pickUpdate([null, 'nope', { tag_name: 42 }, rel('not-a-version')], current)).toBeNull();
  });

  it('tolerates missing optional fields', () => {
    const got = pickUpdate([{ tag_name: 'v4.0.0' }], current);
    expect(got).toMatchObject({ version: '4.0.0', url: '', notes: '', publishedAt: null });
  });
});
