import { describe, expect, it } from 'vitest';
import { ICON_EXTENSIONS, dominantKind, fileKindFor, fileKindOfName, type IconKind } from '@core/iconKind';

describe('what kind of file a name is', () => {
  it('reads archives, including split volumes, whatever the rest of the name looks like', () => {
    for (const n of ['a.rar', 'Game.Build.17072026-OFME.part01.rar', 'x.zip', 'x.7z', 'Game.rar.001', 'Game.r00', 'Game.z01', 'disc.iso']) {
      expect(fileKindOfName(n), n).toBe('archive');
    }
  });

  it('reads video, audio, images, documents, installers, torrents and subtitles', () => {
    expect(fileKindOfName('movie.MKV')).toBe('video');
    expect(fileKindOfName('song.flac')).toBe('audio');
    expect(fileKindOfName('cover.webp')).toBe('image');
    expect(fileKindOfName('book.pdf')).toBe('document');
    expect(fileKindOfName('setup.exe')).toBe('installer');
    expect(fileKindOfName('linux.torrent')).toBe('torrent');
    expect(fileKindOfName('magnet:?xt=urn:btih:abc')).toBe('torrent');
    expect(fileKindOfName('episode.en.srt')).toBe('subtitle');
  });

  it('looks at the file name, not the folders or the query of a link', () => {
    expect(fileKindOfName('https://host.test/dl.mp3/file.rar?x=song.mp3')).toBe('archive');
    expect(fileKindOfName('C:\\Music\\v1.2\\readme')).toBeNull();
  });

  it('says nothing for names that do not tell', () => {
    for (const n of ['', null, undefined, 'noextension', 'trailingdot.', 'weird.qqqq']) expect(fileKindOfName(n as string | null | undefined)).toBeNull();
  });
});

describe('the kind to show for a download', () => {
  it('trusts the file name over what the job was set up as (a .rar set up as "music" is still an archive)', () => {
    expect(fileKindFor(['ICARUS.part01.rar'], 'music')).toBe('archive');
  });

  it('falls back to the job type when the name says nothing, and to a plain file when nothing does', () => {
    expect(fileKindFor(['Some Title'], 'music')).toBe('audio');
    expect(fileKindFor(['Some Title'], 'video')).toBe('video');
    expect(fileKindFor(['Some Title'], 'series')).toBe('video');
    expect(fileKindFor(['Some Title'], null)).toBe('other');
  });

  it('tries each name in turn', () => {
    expect(fileKindFor(['A great title', 'https://x.test/get/file.zip'], 'music')).toBe('archive');
  });
});

describe('the kind that stands for a batch', () => {
  it('is the kind most files share, so twelve archive parts and a small repair file read as archives', () => {
    expect(dominantKind(['archive', 'archive', 'document', 'archive'])).toBe('archive');
  });

  it('breaks a tie towards the first file and gives a plain file for an empty batch', () => {
    expect(dominantKind(['video', 'audio'])).toBe('video');
    expect(dominantKind([])).toBe('other');
  });
});

describe('the table of extensions', () => {
  const entries = Object.entries(ICON_EXTENSIONS) as [Exclude<IconKind, 'other'>, string[]][];

  it('reads every listed extension back as its own kind, in any letter case', () => {
    for (const [kind, list] of entries) {
      for (const ext of list) {
        expect(fileKindOfName(`file.${ext}`), ext).toBe(kind);
        expect(fileKindOfName(`FILE.${ext.toUpperCase()}`), ext).toBe(kind);
      }
    }
  });

  it('lists no extension under two kinds (the later one would silently win)', () => {
    const all = entries.flatMap(([, list]) => list);
    expect(all.filter((e, i) => all.indexOf(e) !== i)).toEqual([]);
  });

  it('keeps split-volume names (.r00, .z01, .001) separate from the table', () => {
    expect(fileKindOfName('a.r00')).toBe('archive');
    expect(fileKindOfName('a.z17')).toBe('archive');
    expect(fileKindOfName('a.007')).toBe('archive');
    expect(fileKindOfName('a.r1')).toBeNull(); // not two digits
  });
});
