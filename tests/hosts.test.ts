import { describe, expect, it } from 'vitest';
import { directApiUrl, isPageHost, siteOf } from '@core/hosts';
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
