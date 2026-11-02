import { describe, expect, it } from 'vitest';
import { findActiveDuplicate } from '@core/jobDedupe';
import type { Job } from '@shared/types';

type Format = Job['options']['format'];
type J = Pick<Job, 'url' | 'status' | 'outputDir' | 'engine'> & { id: string; options: { contentType: Job['options']['contentType']; playlistItems: number[]; format: Format; release?: Job['options']['release'] } };
const mkv: Format = { kind: 'video', maxHeight: null, codec: 'any', container: 'mkv', maxFps: null, allowHdr: true, tvSafe: false };
const mp4: Format = { ...mkv, container: 'mp4' };
const job = (over: Partial<J> = {}): J => ({
  id: 'a', url: 'https://datanodes.to/x/Game.part1.rar', status: 'running', outputDir: 'D:/Games/Game', engine: 'aria2', options: { contentType: 'video', playlistItems: [], format: mkv }, ...over,
});
const wanted = (over: { url?: string; outputDir?: string | null; contentType?: J['options']['contentType']; playlistItems?: number[]; engine?: J['engine']; format?: Format } = {}) => ({
  url: over.url ?? 'https://datanodes.to/x/Game.part1.rar',
  outputDir: over.outputDir === undefined ? 'D:/Games/Game' : over.outputDir,
  engine: over.engine ?? 'aria2',
  options: { contentType: over.contentType ?? 'video', playlistItems: over.playlistItems ?? [], format: over.format ?? mkv },
});

describe('the same download sent twice', () => {
  it('is found while the first is still going', () => {
    for (const status of ['queued', 'running', 'paused', 'processing'] as const) {
      expect(findActiveDuplicate([job({ status })], wanted()), status).toBeTruthy();
    }
  });

  it('returns the job that is already there', () => {
    expect(findActiveDuplicate([job({ id: 'other', url: 'https://x.test/a' }), job({ id: 'mine' })], wanted())?.id).toBe('mine');
  });

  it('never blocks a deliberate second download once the first is over', () => {
    for (const status of ['completed', 'failed', 'cancelled'] as const) {
      expect(findActiveDuplicate([job({ status })], wanted()), status).toBeNull();
    }
  });

  it('is not the same when the link, the folder, the kind of download or the playlist selection differs', () => {
    expect(findActiveDuplicate([job()], wanted({ url: 'https://datanodes.to/x/Game.part2.rar' }))).toBeNull();
    expect(findActiveDuplicate([job()], wanted({ outputDir: 'D:/Other' }))).toBeNull();
    expect(findActiveDuplicate([job()], wanted({ contentType: 'music' }))).toBeNull();
    expect(findActiveDuplicate([job({ options: { contentType: 'video', playlistItems: [1, 2], format: mkv } })], wanted({ playlistItems: [1, 3] }))).toBeNull();
    expect(findActiveDuplicate([job({ options: { contentType: 'video', playlistItems: [1, 2], format: mkv } })], wanted({ playlistItems: [1, 2] }))).toBeTruthy();
  });

  it('is not the same when it belongs to a different release, so a new release is never short of a part', () => {
    const tag = (id: string) => ({ id, title: 'Game', dir: 'D:/Games/Game', role: 'archive' as const, unpack: true, deleteArchives: true });
    const inRelease = (id: string): J => job({ options: { contentType: 'video', playlistItems: [], format: mkv, release: tag(id) } });
    const asRelease = (id: string) => ({ ...wanted(), options: { ...wanted().options, release: tag(id) } });
    expect(findActiveDuplicate([job()], asRelease('r2'))).toBeNull(); // on its own before, now part of a release
    expect(findActiveDuplicate([inRelease('r1')], asRelease('r2'))).toBeNull();
    expect(findActiveDuplicate([inRelease('r1')], wanted())).toBeNull();
    expect(findActiveDuplicate([inRelease('r1')], asRelease('r1'))).toBeTruthy(); // the same release sent twice is still one job
  });

  it('is not the same when it is a different job on the same address: another format, or another engine', () => {
    // One file converted to two formats, or one link saved at two qualities, must both run.
    expect(findActiveDuplicate([job({ engine: 'convert' })], wanted({ engine: 'convert', format: mp4 }))).toBeNull();
    expect(findActiveDuplicate([job({ engine: 'convert' })], wanted({ engine: 'convert' }))).toBeTruthy();
    expect(findActiveDuplicate([job({ engine: 'ytdlp' })], wanted({ engine: 'aria2' }))).toBeNull();
  });

  it('ignores stray spaces around the link, and treats no folder as no folder', () => {
    expect(findActiveDuplicate([job({ url: '  https://datanodes.to/x/Game.part1.rar ' })], wanted())).toBeTruthy();
    expect(findActiveDuplicate([job({ outputDir: null })], wanted({ outputDir: null }))).toBeTruthy();
  });

  it('finds nothing in an empty queue', () => {
    expect(findActiveDuplicate([], wanted())).toBeNull();
  });
});
