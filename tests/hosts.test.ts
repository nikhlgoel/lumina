import { describe, expect, it } from 'vitest';
import { directApiUrl, isPageHost, queueUrlFor, siteOf } from '@core/hosts';
import { installerIn, parseListing, parseProgress, unpackError } from '@core/archive';
import { planBatch, releaseTagFor } from '@core/batch';

describe('file hosts', () => {
  it('recognises download-page hosts including subdomains', () => {
    expect(isPageHost('https://datanodes.to/ax1/Game.part01.rar')).toBe(true);
    expect(isPageHost('https://www.mediafire.com/file/x/y.zip/file')).toBe(true);
    expect(isPageHost('https://cdn.example.org/y.zip')).toBe(false);
    expect(isPageHost('not a url')).toBe(false);
  });

  it('rewrites pixeldrain share links to the file API', () => {
    expect(directApiUrl('https://pixeldrain.com/u/AbC123')).toBe('https://pixeldrain.com/api/file/AbC123?download');
    expect(directApiUrl('https://example.com/u/AbC123')).toBeNull();
  });

  it('reduces host names to the site they belong to', () => {
    expect(siteOf('www.datanodes.to')).toBe('datanodes.to');
    expect(siteOf('dl3.cdn.datanodes.to')).toBe('datanodes.to');
    expect(siteOf('files.example.co.uk')).toBe('example.co.uk');
  });
});

describe('7-Zip output', () => {
  const listing = [
    '7-Zip 26.03 (x64)', '', 'Listing archive: Game.part01.rar', '', '--', 'Path = Game.part01.rar', 'Type = Rar5', 'Physical Size = 2147483648', '',
    '----------',
    'Path = Game', 'Folder = +', 'Size = 0', '',
    'Path = Game/setup.exe', 'Folder = -', 'Size = 3000000', 'Encrypted = -', '',
    'Path = Game/fg-01.bin', 'Folder = -', 'Size = 90000000000', 'Encrypted = -', '',
  ].join('\n');

  it('sums unpacked size and spots encryption', () => {
    expect(parseListing(listing)).toEqual({ totalBytes: 90003000000, files: 2, encrypted: false });
    expect(parseListing(listing.replace('Encrypted = -', 'Encrypted = +')).encrypted).toBe(true);
  });

  it('reads progress and explains failures', () => {
    expect(parseProgress('  7% 2 - Game/fg-01.bin\b\b\b\b 12% 3 - Game')).toBe(12);
    expect(parseProgress('nothing here')).toBeNull();
    expect(unpackError(2, 'ERROR: CRC Failed : Game/fg-01.bin')).toMatch(/damaged/);
    expect(unpackError(2, 'Missing volume : Game.part07.rar')).toMatch(/Game.part07.rar/);
    expect(unpackError(2, 'ERROR: Wrong password : x')).toMatch(/password/);
    expect(unpackError(8, '')).toMatch(/memory/);
  });

  it('finds the installer closest to the top', () => {
    expect(installerIn(['D:/g/Game/redist/setup.exe', 'D:/g/Game/setup.exe', 'D:/g/Game/fg-01.bin'])).toBe('D:/g/Game/setup.exe');
    expect(installerIn(['D:/g/readme.txt'])).toBeNull();
  });
});

describe('release tags', () => {
  it('tags archive volumes, optional extras and loose files for assembly', () => {
    const h = 'https://host.example/';
    const plan = planBatch([h + 'a/R.part01.rar', h + 'b/R.part02.rar', h + 'c/fg-optional-german-vo.bin', h + 'd/fg-optional-hd.part1.rar', h + 'e/fg-optional-hd.part2.rar']);
    const base = { id: 'r1', title: plan.title, dir: 'D:/R', unpack: true, deleteArchives: true };
    const tags = plan.groups.flatMap((g) => g.items.map((i) => releaseTagFor(g, i, base)));
    expect(tags.map((t) => [t.role, t.set ?? null, t.part ?? null, t.parts ?? null])).toEqual([
      ['archive', 'set:r.rar', 1, 2], ['archive', 'set:r.rar', 2, 2],
      ['optional', null, null, null],
      ['optional', 'set:fg-optional-hd.rar', 1, 2], ['optional', 'set:fg-optional-hd.rar', 2, 2],
    ]);
  });
});

describe('the address a download is queued under', () => {
  const direct = (url: string, hosted = false) => ({ sourceKind: 'direct', url, direct: { hosted } });

  it('is the direct file address the probe found, not the share page the person pasted', () => {
    const api = 'https://pixeldrain.com/api/file/Zawwdeun?download';
    expect(queueUrlFor(direct(api), 'https://pixeldrain.com/u/Zawwdeun')).toBe(api);
  });

  it('keeps the pasted address for a file host that opens a download page, which is the page', () => {
    const page = 'https://fuckingfast.co/abc#Game.part1.rar';
    expect(queueUrlFor(direct(page, true), page)).toBe(page);
  });

  it('keeps the pasted address for anything that is not a direct file', () => {
    expect(queueUrlFor({ sourceKind: 'single', url: 'https://www.youtube.com/watch?v=x&t=1' }, 'https://youtu.be/x')).toBe('https://youtu.be/x');
    expect(queueUrlFor({ sourceKind: 'torrent', url: 'magnet:?xt=urn:btih:a' }, 'magnet:?xt=urn:btih:a')).toBe('magnet:?xt=urn:btih:a');
  });

  it('keeps the pasted address when the probe gave nothing usable', () => {
    expect(queueUrlFor({ sourceKind: 'direct', url: '' }, 'https://a.example/f.zip')).toBe('https://a.example/f.zip');
    expect(queueUrlFor({ sourceKind: 'direct', url: 'ftp://a.example/f.zip' }, 'https://a.example/f.zip')).toBe('https://a.example/f.zip');
    expect(queueUrlFor({ sourceKind: 'direct' }, 'https://a.example/f.zip')).toBe('https://a.example/f.zip');
  });
});

describe('the direct address of a Pixeldrain share link', () => {
  it('is its API address, for either of its domains', () => {
    expect(directApiUrl('https://pixeldrain.com/u/Zawwdeun')).toBe('https://pixeldrain.com/api/file/Zawwdeun?download');
    expect(directApiUrl('https://pixeldra.in/u/Zawwdeun')).toBe('https://pixeldrain.com/api/file/Zawwdeun?download');
  });
  it('is nothing for other hosts or for a link with no file in it', () => {
    expect(directApiUrl('https://example.com/u/abc')).toBeNull();
    expect(directApiUrl('https://pixeldrain.com/l/abc')).toBeNull();
  });
  it('answers for a stand-in host only when the self-test names it, and keeps that host’s own origin', () => {
    expect(directApiUrl('http://127.0.0.1:5000/u/abc')).toBeNull();
    expect(directApiUrl('http://127.0.0.1:5000/u/abc', '127.0.0.1')).toBe('http://127.0.0.1:5000/api/file/abc?download');
  });
});
