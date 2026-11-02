import { describe, expect, it } from 'vitest';
import { fileNameFromUrl, planBatch } from '@core/batch';

describe('the file name a link carries', () => {
  it('is the last part of the path when that is a file name', () => {
    expect(fileNameFromUrl('https://example.org/dl/Setup.exe')).toBe('Setup.exe');
    expect(fileNameFromUrl('https://example.org/dl/Setup%20File.exe?token=1')).toBe('Setup File.exe');
  });

  it('is the #fragment when the path is only an id (how several file hosts write their links)', () => {
    expect(fileNameFromUrl('https://fuckingfast.co/AbC123#Sample.Game.part01.rar')).toBe('Sample.Game.part01.rar');
    expect(fileNameFromUrl('https://host.example/x9#Name%20With%20Spaces.part2.rar')).toBe('Name With Spaces.part2.rar');
  });

  it('prefers a name in the path over one in the fragment', () => {
    expect(fileNameFromUrl('https://example.org/dl/Real.zip#Other.rar')).toBe('Real.zip');
  });

  it('is empty when neither part looks like a file name', () => {
    expect(fileNameFromUrl('https://example.org/page?id=7')).toBe('');
    expect(fileNameFromUrl('https://example.org/x#section-two')).toBe('');
    expect(fileNameFromUrl('https://example.org/x#')).toBe('');
  });

  it('does not throw on a fragment that is not valid percent-encoding, or on something that is not a link', () => {
    expect(fileNameFromUrl('https://example.org/x#100%.part1.rar')).toBe('100%.part1.rar');
    expect(fileNameFromUrl('not a link')).toBe('');
    expect(fileNameFromUrl('')).toBe('');
  });

  it('reads a magnet link’s display name', () => {
    expect(fileNameFromUrl('magnet:?xt=urn:btih:abc&dn=Some%20Torrent')).toBe('Some Torrent');
    expect(fileNameFromUrl('magnet:?xt=urn:btih:abc')).toBe('');
  });
});

describe('links picked together on a page', () => {
  const host = 'https://fuckingfast.co';

  it('become one set when the file names are in the fragments, in order whatever order they were picked in', () => {
    const plan = planBatch([`${host}/c#Sample.Game.part3.rar`, `${host}/a#Sample.Game.part1.rar`, `${host}/b#Sample.Game.part2.rar`]);
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0]!.kind).toBe('archive-set');
    expect(plan.groups[0]!.items.map((i) => i.part)).toEqual([1, 2, 3]);
    expect(plan.groups[0]!.missingParts).toEqual([]);
    expect(plan.title).toBe('Sample.Game');
  });

  it('flag a part that was left out of the pick', () => {
    const plan = planBatch([`${host}/a#Sample.Game.part1.rar`, `${host}/c#Sample.Game.part3.rar`, `${host}/d#Sample.Game.part4.rar`]);
    expect(plan.groups[0]!.missingParts).toEqual([2]);
  });

  it('keep an optional extra apart and unticked, and a checksum file first', () => {
    const plan = planBatch([
      `${host}/a#Sample.Game.part1.rar`, `${host}/b#Sample.Game.part2.rar`, `${host}/o#Sample.Game.optional.Soundtrack.rar`, `${host}/m#Sample.Game.md5`,
    ]);
    expect(plan.groups.map((g) => g.kind)).toEqual(['checksum', 'archive-set', 'optional']);
    expect(plan.groups.find((g) => g.kind === 'optional')!.defaultSelected).toBe(false);
    expect(plan.groups.find((g) => g.kind === 'archive-set')!.defaultSelected).toBe(true);
  });

  it('keep two releases picked together apart', () => {
    const plan = planBatch([`${host}/1#Alpha.part1.rar`, `${host}/2#Alpha.part2.rar`, `${host}/3#Beta.part1.rar`, `${host}/4#Beta.part2.rar`]);
    expect(plan.groups.filter((g) => g.kind === 'archive-set').map((g) => g.items.length)).toEqual([2, 2]);
  });

  it('cope with the biggest batch the bridge allows, quickly', () => {
    const links = Array.from({ length: 500 }, (_, i) => `${host}/x${i}#Big.Release.part${String(i + 1).padStart(3, '0')}.rar`);
    const started = performance.now();
    const plan = planBatch(links);
    expect(performance.now() - started).toBeLessThan(500);
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0]!.items).toHaveLength(500);
    expect(plan.groups[0]!.missingParts).toEqual([]);
  });

  it('turn magnets and unnamed links into files of their own without failing', () => {
    const plan = planBatch(['magnet:?xt=urn:btih:aaa&dn=One', 'magnet:?xt=urn:btih:bbb', 'https://example.org/page?id=7']);
    expect(plan.groups.reduce((n, g) => n + g.items.length, 0)).toBe(3);
    expect(plan.groups.every((g) => g.defaultSelected)).toBe(true);
  });
});
