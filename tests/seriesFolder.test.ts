import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { seriesFolder } from '../src/main/batchFolder';

let base = '';
beforeEach(() => { base = fs.mkdtempSync(path.join(os.tmpdir(), 'lumina-series-')); });
afterEach(() => { fs.rmSync(base, { recursive: true, force: true }); });

describe('the folder a series goes in', () => {
  it('is the show, then its season, and is not created by asking (typing a name must not leave empty folders)', () => {
    const f = seriesFolder(base, 'The Replica Show', 1);
    expect(f.dir).toBe(path.join(base, 'The Replica Show', 'Season 01'));
    expect(f.have).toEqual([]);
    expect(fs.readdirSync(base)).toEqual([]);
    for (const partial of ['T', 'The', 'The R', 'The Rep']) seriesFolder(base, partial, 1);
    expect(fs.readdirSync(base)).toEqual([]);
  });

  it('lists what is already there by name without its extension, leaving out unfinished files', () => {
    const dir = path.join(base, 'Show', 'Season 02');
    fs.mkdirSync(dir, { recursive: true });
    for (const n of ['Show - S02E01.mkv', 'Show - S02E02.mp4', 'Show - S02E03.mkv.aria2', 'Show - S02E04.mkv.part', 'notes.txt']) fs.writeFileSync(path.join(dir, n), 'x');
    const f = seriesFolder(base, 'Show', 2);
    expect(f.have.sort()).toEqual(['notes', 'show - s02e01', 'show - s02e02']);
  });

  it('keeps a show name that is not safe for a folder from escaping the chosen folder', () => {
    const f = seriesFolder(base, '..\\..\\Windows: *?', 1);
    expect(path.relative(base, f.dir).split(path.sep)[0]).not.toBe('..');
    expect(f.dir.startsWith(base)).toBe(true);
  });
});
