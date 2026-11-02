import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { entriesToMove, isPlainName, moveTorrentEntries } from '../src/main/jobs/moveTorrent';

let root: string;
let from: string;
let to: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumina-move-'));
  from = path.join(root, 'from');
  to = path.join(root, 'to');
  fs.mkdirSync(path.join(from, 'Game', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(from, 'Game', 'a.bin'), 'aaaa');
  fs.writeFileSync(path.join(from, 'Game', 'sub', 'b.bin'), 'bb');
  fs.writeFileSync(path.join(from, 'Game.aria2'), 'ctl');
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('moving a torrent to another folder', () => {
  it('moves the data folder and its control file together', async () => {
    const done = await moveTorrentEntries(from, to, 'Game');
    expect(done).toEqual(['Game', 'Game.aria2']);
    expect(fs.readFileSync(path.join(to, 'Game', 'sub', 'b.bin'), 'utf8')).toBe('bb');
    expect(fs.readFileSync(path.join(to, 'Game.aria2'), 'utf8')).toBe('ctl');
    expect(fs.existsSync(path.join(from, 'Game'))).toBe(false);
    expect(fs.existsSync(path.join(from, 'Game.aria2'))).toBe(false);
  });

  it('copies and then removes the original when the drives differ (rename fails with EXDEV)', async () => {
    const real = fs.promises.rename;
    vi.spyOn(fs.promises, 'rename').mockImplementation(async (a, b) => {
      if (String(a).startsWith(from)) throw Object.assign(new Error('cross-device'), { code: 'EXDEV' });
      return real(a, b);
    });
    await moveTorrentEntries(from, to, 'Game');
    expect(fs.readFileSync(path.join(to, 'Game', 'a.bin'), 'utf8')).toBe('aaaa');
    expect(fs.readFileSync(path.join(to, 'Game.aria2'), 'utf8')).toBe('ctl');
    expect(fs.existsSync(path.join(from, 'Game'))).toBe(false);
  });

  it('never overwrites, and moves nothing when the destination already has the name', async () => {
    fs.mkdirSync(path.join(to, 'Game'), { recursive: true });
    await expect(moveTorrentEntries(from, to, 'Game')).rejects.toThrow(/already exists/);
    expect(fs.existsSync(path.join(from, 'Game', 'a.bin'))).toBe(true);
    expect(fs.existsSync(path.join(from, 'Game.aria2'))).toBe(true);
  });

  it('refuses the same folder and a name that is missing', async () => {
    await expect(moveTorrentEntries(from, from, 'Game')).rejects.toThrow(/already the folder/);
    await expect(moveTorrentEntries(from, to, 'Nope')).rejects.toThrow(/nothing to move/);
  });

  it('moves a single-file torrent without a control file too', async () => {
    fs.writeFileSync(path.join(from, 'one.iso'), 'iso');
    expect(await moveTorrentEntries(from, to, 'one.iso')).toEqual(['one.iso']);
    expect(fs.existsSync(path.join(to, 'one.iso'))).toBe(true);
  });
});

describe('which names may be moved', () => {
  it('accepts an ordinary torrent name', () => {
    expect(isPlainName('Battlefield 6 [FitGirl Repack]')).toBe(true);
  });

  it('rejects a name that could reach outside the download folder', () => {
    for (const bad of ['', '.', '..', '..\\x', '../x', 'a/b', 'C:\\x', 'a|b']) expect(isPlainName(bad)).toBe(false);
  });

  it('lists nothing when the data itself is missing, even if a control file is left', () => {
    fs.rmSync(path.join(from, 'Game'), { recursive: true });
    expect(entriesToMove(from, 'Game')).toEqual([]);
  });
});
