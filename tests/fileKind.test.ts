import { describe, it, expect } from 'vitest';
import { isDownloaderArtifact, KIND_ORDER, extensionOf, fileKindOf, groupByKind, isTrailingVolume } from '@core/fileKind';

describe('extensionOf', () => {
  it('reads the last extension, lower-cased', () => {
    expect(extensionOf('Report.PDF')).toBe('pdf');
    expect(extensionOf('archive.tar.gz')).toBe('gz');
  });

  it('handles paths, not just names', () => {
    expect(extensionOf('C:\\Users\\me\\Setup.exe')).toBe('exe');
    expect(extensionOf('/home/me/notes.md')).toBe('md');
  });

  it('returns empty for no extension, a hidden file, or a trailing dot', () => {
    expect(extensionOf('README')).toBe('');
    expect(extensionOf('.gitignore')).toBe('');
    expect(extensionOf('weird.')).toBe('');
  });
});

describe('fileKindOf', () => {
  it('classifies the common downloads', () => {
    expect(fileKindOf('manual.pdf')).toBe('document');
    expect(fileKindOf('novel.epub')).toBe('ebook');
    expect(fileKindOf('pack.7z')).toBe('archive');
    expect(fileKindOf('photo.JPEG')).toBe('image');
    expect(fileKindOf('setup.exe')).toBe('app');
    expect(fileKindOf('movie.en.srt')).toBe('subtitle');
    expect(fileKindOf('data.json')).toBe('code');
  });

  it('falls back to "other" for anything unknown', () => {
    expect(fileKindOf('blob.qqq')).toBe('other');
    expect(fileKindOf('LICENSE')).toBe('other');
  });
});

describe('isTrailingVolume', () => {
  it('keeps the first volume and hides the rest', () => {
    expect(isTrailingVolume('Release.part01.rar')).toBe(false);
    expect(isTrailingVolume('Release.part02.rar')).toBe(true);
    expect(isTrailingVolume('Release.7z.001')).toBe(false);
    expect(isTrailingVolume('Release.7z.004')).toBe(true);
  });

  it('hides .rNN and .zNN continuation volumes, whose first part is the .rar/.zip', () => {
    expect(isTrailingVolume('Release.r00')).toBe(true);
    expect(isTrailingVolume('Release.z01')).toBe(true);
    expect(isTrailingVolume('Release.rar')).toBe(false);
  });

  it('still reads the volume number through Windows’ duplicate suffix', () => {
    expect(isTrailingVolume('Broken_Pack.7z (1).003')).toBe(true);
    expect(isTrailingVolume('Broken_Pack.7z (1).001')).toBe(false);
    expect(isTrailingVolume('Release (2).part03.rar')).toBe(true);
  });

  it('leaves ordinary files alone', () => {
    expect(isTrailingVolume('holiday.zip')).toBe(false);
    expect(isTrailingVolume('setup.exe')).toBe(false);
    expect(isTrailingVolume('Budget (1).pdf')).toBe(false);
  });
});

describe('groupByKind', () => {
  it('buckets files and keeps the display order', () => {
    const groups = groupByKind([
      { name: 'a.pdf' }, { name: 'b.exe' }, { name: 'c.pdf' }, { name: 'd.zip' },
    ]);
    expect(groups.map((g) => g.kind)).toEqual(['app', 'archive', 'document']);
    expect(groups.find((g) => g.kind === 'document')!.files.map((f) => f.name)).toEqual(['a.pdf', 'c.pdf']);
  });

  it('omits empty groups and returns nothing for no files', () => {
    expect(groupByKind([])).toEqual([]);
    const groups = groupByKind([{ name: 'only.exe' }]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBe('Apps and installers');
  });

  it('every kind it can produce has a place in the display order', () => {
    const kinds = new Set(['a.pdf', 'a.epub', 'a.zip', 'a.png', 'a.exe', 'a.srt', 'a.json', 'a.qqq'].map(fileKindOf));
    for (const k of kinds) expect(KIND_ORDER).toContain(k);
  });
});

describe('isDownloaderArtifact — the Files tab should show what the user got, not our bookkeeping', () => {
  it('hides the infohash torrent aria2 saves beside a magnet download', () => {
    // Exactly what turned up in a real downloads folder, listed under "Other files" as raw hex.
    expect(isDownloaderArtifact('c9625df298353912c52657774bb3de80a9941277.torrent')).toBe(true);
    expect(isDownloaderArtifact('DD8255ECDC7CA55FB0BBF81323D87062DB1F6D1C.TORRENT')).toBe(true);
  });

  it('keeps a torrent the user put there themselves', () => {
    expect(isDownloaderArtifact('ubuntu-24.04-desktop-amd64.iso.torrent')).toBe(false);
    expect(isDownloaderArtifact('Big Buck Bunny.torrent')).toBe(false);
    // Hex, but not an infohash: too short, too long, or not hex at all.
    expect(isDownloaderArtifact('c9625df.torrent')).toBe(false);
    expect(isDownloaderArtifact(`${'a'.repeat(41)}.torrent`)).toBe(false);
    expect(isDownloaderArtifact(`${'g'.repeat(40)}.torrent`)).toBe(false);
  });

  it('still hides the in-progress control files it always did', () => {
    for (const name of ['movie.mp4.aria2', 'movie.mp4.part', 'video.f137.ytdl', 'Lumina.exe.lumina-part']) {
      expect(isDownloaderArtifact(name), name).toBe(true);
    }
  });

  it('leaves ordinary downloads alone', () => {
    for (const name of ['Dune-Awakening-AnkerGames.zip', 'poster.jpg', 'Big Buck Bunny.en.srt', 'notes.txt']) {
      expect(isDownloaderArtifact(name), name).toBe(false);
    }
  });
});
