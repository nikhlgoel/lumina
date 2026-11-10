import { describe, expect, it } from 'vitest';
// The extension's mirror helpers are plain ES functions with no browser APIs, so the real file is what is tested.
// @ts-expect-error TS7016: no declaration file for a plain .js module (the same way tests/extensionLinks.test.ts imports lib.js)
import { chooseMirror, groupByHost, hostOf, linkName } from '../extension/mirrors.js';

type Group = { host: string; links: unknown[] };

const L =(url: string, text = '') => ({ url, text });
const part = (host: string, n: number) => L(`https://${host}/f/${n}`, `Release.part${n}.rar`);

describe('a page that offers the same files on several mirrors', () => {
  const page = [
    ...[1, 2, 3].map((n) => part('fileditchfiles.st', n)),
    ...[1, 2, 3].map((n) => part('pixeldrain.com', n)),
    ...[1, 2, 3].map((n) => part('gofile.io', n)),
  ];

  it('groups the links by host', () => {
    expect(groupByHost(page).map((g: Group) => [g.host, g.links.length])).toEqual([['fileditchfiles.st', 3], ['pixeldrain.com', 3], ['gofile.io', 3]]);
  });

  it('starts with the host Lumina handles best (Pixeldrain has a direct address), not the first on the page', () => {
    expect(chooseMirror(groupByHost(page))).toBe('pixeldrain.com');
  });

  it('falls back to the biggest group when no host is a preferred one', () => {
    const odd = [...[1, 2, 3].map((n) => part('a.example', n)), ...[1, 2].map((n) => part('b.example', n))];
    expect(chooseMirror(groupByHost(odd))).toBe('a.example');
  });

  it('does not call it a set of mirrors when there is one host, or one stray link elsewhere', () => {
    expect(chooseMirror(groupByHost([1, 2, 3].map((n) => part('fileditchfiles.st', n))))).toBeNull();
    expect(chooseMirror(groupByHost([...[1, 2, 3].map((n) => part('fileditchfiles.st', n)), L('https://pixeldrain.com/u/x')]))).toBeNull();
  });

  it('keeps magnet links out of the mirrors', () => {
    const withMagnets = [...page, L('magnet:?xt=urn:btih:a'), L('magnet:?xt=urn:btih:b')];
    expect(groupByHost(withMagnets).some((g: Group) => g.host === 'magnet')).toBe(true);
    expect(chooseMirror(groupByHost(withMagnets))).toBe('pixeldrain.com');
  });
});

describe('what a link is called in the list', () => {
  it('uses its own words when they say something', () => {
    expect(linkName(L('https://h.test/x', 'Game.part01.rar'))).toBe('Game.part01.rar');
  });

  it('does not call a dozen rows "Download": it reaches for the name in the address instead', () => {
    expect(linkName(L('https://fuckingfast.co/abc#Game.part01.rar', 'Download'))).toBe('Game.part01.rar');
    expect(linkName(L('https://h.test/files/Setup.exe?token=1', 'Download now'))).toBe('Setup.exe');
    expect(linkName(L('https://h.test/get/abc', 'Click here'))).toBe('abc');
  });

  it('names a magnet link from its display name', () => {
    expect(linkName(L('magnet:?xt=urn:btih:a&dn=Some+Release', ''))).toBe('Some Release');
  });

  it('copes with something that is not an address', () => {
    expect(linkName(L('not a url', ''))).toBe('not a url');
    expect(hostOf('not a url')).toBe('');
    expect(hostOf('https://www.Example.org/a')).toBe('example.org');
  });
});
