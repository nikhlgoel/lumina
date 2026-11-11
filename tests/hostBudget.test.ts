import { describe, expect, it } from 'vitest';
import { HostBudgets, hostOfUrl, looksLikeThrottle } from '@core/hostBudget';

const MIN = 60_000;
const settings = { files: 8, connections: 16 };

describe('what one file host may be asked for at once', () => {
  it('holds Pixeldrain to one file and four connections from the start, whatever the settings say', () => {
    const b = new HostBudgets();
    expect(b.budget('pixeldrain.com', settings, 0)).toEqual({ files: 1, connections: 4 });
    expect(b.budget('pixeldra.in', settings, 0)).toEqual({ files: 1, connections: 4 });
  });

  it('never gives a host more than the person asked for', () => {
    const b = new HostBudgets();
    expect(b.budget('pixeldrain.com', { files: 1, connections: 2 }, 0)).toEqual({ files: 1, connections: 2 });
  });

  it('leaves any other host on the person’s settings until it shows trouble', () => {
    const b = new HostBudgets();
    expect(b.budget('example.com', settings, 0)).toEqual(settings);
    expect(b.budget(null, settings, 0)).toEqual(settings);
  });

  it('holds a host that showed trouble to the strict budget, then lets go after twenty minutes', () => {
    const b = new HostBudgets();
    b.noteTrouble('example.com', 0);
    expect(b.budget('example.com', settings, 10 * MIN)).toEqual({ files: 1, connections: 4 });
    expect(b.budget('example.com', settings, 21 * MIN)).toEqual(settings);
    expect(b.budget('other.example', settings, 10 * MIN)).toEqual(settings);
  });
});

describe('telling throttling from a dead link', () => {
  it('reads the failures a throttling host causes', () => {
    for (const m of [
      'SSL/TLS handshake failure: Error: An existing connection was forcibly closed by the remote host.',
      'Connection reset by peer', 'HTTP 429 Too Many Requests', 'rate limit exceeded',
    ]) expect(looksLikeThrottle(m), m).toBe(true);
  });

  it('does not read a missing file, a full disk, or a web page in place of the file as throttling', () => {
    // A web page instead of the file was a share page downloaded by mistake, not a host pushing back.
    for (const m of ['The server sent a web page instead of the file (the link may need a browser, a login or has expired).', 'File not found', 'HTTP 404', 'Not enough disk space', '', null, undefined]) expect(looksLikeThrottle(m as string | null | undefined), String(m)).toBe(false);
  });
});

describe('which site a link belongs to', () => {
  it('is the registrable site of a web address', () => {
    expect(hostOfUrl('https://pixeldrain.com/api/file/abc?download')).toBe('pixeldrain.com');
    expect(hostOfUrl('https://www.pixeldrain.com/u/abc')).toBe('pixeldrain.com');
    expect(hostOfUrl('https://files.example.co.uk/x')).toBe('example.co.uk');
  });
  it('is nothing for a magnet link or text that is not an address', () => {
    expect(hostOfUrl('magnet:?xt=urn:btih:abc')).toBeNull();
    expect(hostOfUrl('not a url')).toBeNull();
    expect(hostOfUrl('C:/Users/me/file.torrent')).toBeNull();
  });
});
