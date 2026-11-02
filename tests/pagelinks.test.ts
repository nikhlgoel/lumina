import { beforeAll, describe, expect, it } from 'vitest';
import { PAGE_HOSTS } from '@core/hosts';
// The extension's link finder is a classic browser script: importing it only defines globalThis.__luminaLinks.
import '../extension/pagelinks.js';

interface Found { url: string; text: string; worthy: boolean }
interface Finder {
  pick: (c: { href: string; text?: string }[], o?: { chosen?: boolean }) => Found[];
  textLinks: (t: string) => string[];
  worthy: (href: string) => boolean;
  isHosted: (href: string) => boolean;
}
let finder: Finder;
beforeAll(() => { finder = (globalThis as unknown as { __luminaLinks: Finder }).__luminaLinks; });

const link = (href: string, text = '') => ({ href, text });

describe('which links on a page are download links', () => {
  it('recognises magnets, file hosts and links that end in a file name', () => {
    expect(finder.worthy('magnet:?xt=urn:btih:abc')).toBe(true);
    expect(finder.worthy('https://fuckingfast.co/abc123#Game.part01.rar')).toBe(true);
    expect(finder.worthy('https://example.org/files/setup.exe?token=1')).toBe(true);
    expect(finder.worthy('https://example.org/files/archive.7z.001')).toBe(true);
  });

  it('leaves ordinary pages alone', () => {
    expect(finder.worthy('https://example.org/about')).toBe(false);
    expect(finder.worthy('mailto:me@example.org')).toBe(false);
    expect(finder.worthy('javascript:void(0)')).toBe(false);
  });

  it('knows every file host Lumina can click through, with or without a subdomain', () => {
    for (const host of PAGE_HOSTS) {
      expect(finder.isHosted(`https://${host}/x`), host).toBe(true);
      expect(finder.isHosted(`https://dl2.${host}/x`), `dl2.${host}`).toBe(true);
    }
    expect(finder.isHosted('https://notdatanodes.to/x')).toBe(false);
  });

  it('offers only usable links from a whole page, once each', () => {
    const found = finder.pick([
      link('https://example.org/'), link('https://datanodes.to/a/File.part1.rar', 'Part 1'), link('https://datanodes.to/a/File.part1.rar', 'Part 1 again'),
      link('https://example.org/tag/games'), link('magnet:?xt=urn:btih:abc', 'Torrent'),
    ]);
    expect(found.map((l) => l.url)).toEqual(['https://datanodes.to/a/File.part1.rar', 'magnet:?xt=urn:btih:abc']);
    expect(found[0]!.text).toBe('Part 1');
  });

  it('is capped, so a page of thousands of links cannot flood Lumina', () => {
    const many = Array.from({ length: 900 }, (_, i) => link(`https://datanodes.to/f${i}/x.rar`));
    expect(finder.pick(many)).toHaveLength(500);
  });
});

describe('links the person highlighted', () => {
  it('keeps only the recognised ones when there are any (a stray home link beside them is not wanted)', () => {
    const found = finder.pick([link('https://example.org/'), link('https://fuckingfast.co/1'), link('https://fuckingfast.co/2')], { chosen: true });
    expect(found.map((l) => l.url)).toEqual(['https://fuckingfast.co/1', 'https://fuckingfast.co/2']);
  });

  it('keeps every web link when none is recognised, because they chose them', () => {
    const found = finder.pick([link('https://files.example.org/get/1'), link('https://files.example.org/get/2'), link('mailto:a@b.c'), link('javascript:x()')], { chosen: true });
    expect(found.map((l) => l.url)).toEqual(['https://files.example.org/get/1', 'https://files.example.org/get/2']);
    expect(found.every((l) => !l.worthy)).toBe(true);
  });

  it('is empty when nothing usable was highlighted', () => {
    expect(finder.pick([], { chosen: true })).toEqual([]);
    expect(finder.pick([link('mailto:a@b.c')], { chosen: true })).toEqual([]);
  });

  it('reads links written out as plain text, without the punctuation after them', () => {
    const text = 'Mirror 1: https://rapidgator.net/file/abc/Game.part1.rar, Mirror 2 (https://nitroflare.com/view/XYZ/Game.part1.rar).\nmagnet:?xt=urn:btih:abc;';
    expect(finder.textLinks(text)).toEqual([
      'https://rapidgator.net/file/abc/Game.part1.rar', 'https://nitroflare.com/view/XYZ/Game.part1.rar', 'magnet:?xt=urn:btih:abc',
    ]);
  });
});
