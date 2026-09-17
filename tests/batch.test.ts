import { describe, expect, it } from 'vitest';
import { fileNameFromUrl, planBatch, prettyTitle, splitVolume } from '@core/batch';
import { checkHeader, parseChecksumManifest } from '@core/verify';

const host = 'https://files.example.net';
const parts = Array.from({ length: 12 }, (_, i) => `${host}/k${i}/Big_Project_--_mirror-site.org_--_.part${String(i + 1).padStart(2, '0')}.rar`);
const extras = [
  `${host}/a/fg-optional-german-vo.bin`,
  `${host}/b/fg-optional-japanese-vo.bin`,
  `${host}/c/fg-optional-hd-videos.part1.rar`,
  `${host}/d/fg-optional-hd-videos.part2.rar`,
];

describe('batch planning', () => {
  it('reads file names from URLs and magnets', () => {
    expect(fileNameFromUrl(`${host}/x/My%20File.part03.rar`)).toBe('My File.part03.rar');
    expect(fileNameFromUrl('magnet:?xt=urn:btih:abc&dn=Some.iso')).toBe('Some.iso');
    expect(fileNameFromUrl(`${host}/download/abc123`)).toBe('');
  });

  it('recognises split volumes', () => {
    expect(splitVolume('a.part07.rar')).toEqual({ base: 'a.rar', part: 7 });
    expect(splitVolume('a.7z.012')).toEqual({ base: 'a.7z', part: 12 });
    expect(splitVolume('a.r00')).toEqual({ base: 'a.rar', part: 2 });
    expect(splitVolume('a.z02')).toEqual({ base: 'a.zip', part: 2 });
    expect(splitVolume('a.rar')).toBeNull();
    expect(splitVolume('movie.mp4')).toBeNull();
  });

  it('cleans release titles', () => {
    expect(prettyTitle('Big_Project_--_mirror-site.org_--_.rar')).toBe('Big Project');
    expect(prettyTitle('Ubuntu 26.04 desktop amd64.iso')).toBe('Ubuntu 26.04 desktop amd64');
  });

  it('groups a pasted release into one set plus optional extras', () => {
    const plan = planBatch([...parts.slice().reverse(), ...extras, parts[0]!]);
    expect(plan.title).toBe('Big Project');
    const [set, ...rest] = plan.groups;
    expect(set!.kind).toBe('archive-set');
    expect(set!.items.map((i) => i.part)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(set!.missingParts).toEqual([]);
    expect(set!.defaultSelected).toBe(true);
    expect(rest.map((g) => [g.kind, g.label, g.items.length, g.defaultSelected])).toEqual([
      ['optional', 'German voice-over', 1, false],
      ['optional', 'Japanese voice-over', 1, false],
      ['optional', 'HD videos', 2, false],
    ]);
  });

  it('reports missing volumes and puts checksum files first', () => {
    const plan = planBatch([parts[0]!, parts[2]!, parts[3]!, `${host}/m/checksums.md5`, `${host}/s/readme.txt`]);
    expect(plan.groups[0]!.kind).toBe('checksum');
    expect(plan.groups[1]!.missingParts).toEqual([2]);
    expect(plan.groups[2]!.kind).toBe('file');
  });

  it('folds an old-style .rar head into its .r00 set', () => {
    const plan = planBatch([`${host}/1/data.r00`, `${host}/2/data.rar`, `${host}/3/data.r01`]);
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0]!.items.map((i) => i.filename)).toEqual(['data.rar', 'data.r00', 'data.r01']);
  });
});

describe('download verification', () => {
  const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(20).fill(0)]);
  it('accepts real archives and rejects HTML pages or wrong contents', () => {
    expect(checkHeader('x.part01.rar', bytes(0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00)).ok).toBe(true);
    expect(checkHeader('x.7z', bytes(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c)).ok).toBe(true);
    const html = checkHeader('x.part02.rar', new TextEncoder().encode('\n  <!DOCTYPE html><html><body>Captcha</body>'));
    expect(html.ok).toBe(false);
    expect(checkHeader('x.bin', new TextEncoder().encode('<html>')).ok).toBe(false);
    expect(checkHeader('x.zip', bytes(1, 2, 3, 4)).ok).toBe(false);
    expect(checkHeader('x.7z.002', bytes(9, 9, 9)).ok).toBe(true);
    expect(checkHeader('notes.txt', new TextEncoder().encode('<html>')).ok).toBe(true);
  });

  it('parses md5, sha256sums, BSD and sfv manifests', () => {
    const md5 = parseChecksumManifest('release.md5', 'd41d8cd98f00b204e9800998ecf8427e *MD5\\a.part01.rar\r\n; comment\n');
    expect(md5.get('a.part01.rar')).toEqual({ algo: 'md5', hash: 'd41d8cd98f00b204e9800998ecf8427e' });
    const sums = parseChecksumManifest('SHA256SUMS', `${'A'.repeat(64)}  ubuntu.iso`);
    expect(sums.get('ubuntu.iso')?.algo).toBe('sha256');
    expect(parseChecksumManifest('x.txt', `SHA1 (dir/f.bin) = ${'b'.repeat(40)}`).get('f.bin')?.algo).toBe('sha1');
    expect(parseChecksumManifest('set.sfv', 'My File.rar 0A1B2C3D').get('my file.rar')).toEqual({ algo: 'crc32', hash: '0a1b2c3d' });
  });
});
