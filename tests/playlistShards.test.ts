import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PLAYLIST_WORKERS, MAX_PLAYLIST_WORKERS, aggregateProgress, allItems, planShards,
  playlistItemsArg, workerCount,
} from '@core/playlistShards';

describe('how many processes to run', () => {
  it('uses the configured number for a long playlist', () => {
    expect(workerCount(433, 4)).toBe(4);
  });

  it('never starts more workers than there are items', () => {
    // Three workers for two songs is two idle processes and a wasted interpreter start.
    expect(workerCount(2, 4)).toBe(2);
    expect(workerCount(1, 4)).toBe(1);
    expect(workerCount(0, 4)).toBe(1);
  });

  it('refuses to go past the ceiling, whatever it is asked for', () => {
    // More than this and YouTube answers with rate limits instead of data.
    expect(workerCount(433, 99)).toBe(MAX_PLAYLIST_WORKERS);
  });

  it('treats one or fewer as "do not shard at all"', () => {
    expect(workerCount(433, 1)).toBe(1);
    expect(workerCount(433, 0)).toBe(1);
    expect(workerCount(433, -5)).toBe(1);
  });

  it('copes with a nonsense setting instead of starting NaN processes', () => {
    expect(workerCount(433, Number.NaN)).toBe(DEFAULT_PLAYLIST_WORKERS);
  });
});

describe('dealing the items out', () => {
  it('gives every item to exactly one worker', () => {
    const shards = planShards(allItems(433), 4);
    const all = shards.flat().sort((a, b) => a - b);
    expect(all).toEqual(allItems(433));
    expect(shards).toHaveLength(4);
  });

  it('deals round-robin, so a run of long tracks is spread rather than landing on one worker', () => {
    expect(planShards([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([[1, 4, 7], [2, 5], [3, 6]]);
  });

  it('shares the work out evenly', () => {
    const sizes = planShards(allItems(433), 4).map((s) => s.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it('returns one shard when sharding is off, and none for an empty playlist', () => {
    expect(planShards([1, 2, 3], 1)).toEqual([[1, 2, 3]]);
    expect(planShards([], 4)).toEqual([]);
  });

  it('never returns an empty shard, so every process spawned has work', () => {
    for (const items of [1, 2, 3, 5, 9, 100]) {
      for (const w of [1, 2, 3, 4, 8]) {
        for (const shard of planShards(allItems(items), w)) expect(shard.length).toBeGreaterThan(0);
      }
    }
  });

  it('shards a hand-picked selection rather than the whole playlist', () => {
    // Choosing items 2, 5, 9 and 40 of a long playlist is a job of four, split two and two.
    expect(planShards([2, 5, 9, 40], 2)).toEqual([[2, 9], [5, 40]]);
  });
});

describe('the --playlist-items argument', () => {
  it('collapses a whole playlist to a range', () => {
    expect(playlistItemsArg(allItems(433))).toBe('1-433');
  });

  it('lists a round-robin shard', () => {
    expect(playlistItemsArg([1, 5, 9])).toBe('1,5,9');
  });

  it('writes a pair as two numbers rather than a range of two', () => {
    expect(playlistItemsArg([4, 5])).toBe('4,5');
    expect(playlistItemsArg([4, 5, 6])).toBe('4-6');
  });

  it('mixes runs and singles', () => {
    expect(playlistItemsArg([1, 2, 3, 7, 10, 11, 12, 20])).toBe('1-3,7,10-12,20');
  });

  it('sorts and de-duplicates, so a caller cannot produce a double download', () => {
    expect(playlistItemsArg([9, 1, 5, 1, 9])).toBe('1,5,9');
  });

  it('says nothing for nothing', () => {
    expect(playlistItemsArg([])).toBe('');
  });
});

describe('rolling the workers up into one set of figures', () => {
  it('adds the speeds, because that is what the link is really carrying', () => {
    const a = aggregateProgress([
      { finished: 10, total: 25, speedBps: 800_000 },
      { finished: 8, total: 25, speedBps: 1_200_000 },
    ]);
    expect(a.speedBps).toBe(2_000_000);
    expect(a.finished).toBe(18);
    expect(a.total).toBe(50);
    expect(a.percent).toBe(36);
  });

  it('reports no speed at all rather than zero when nothing is moving', () => {
    // Zero would render as "0 B/s", which reads as stalled rather than as "not known yet".
    expect(aggregateProgress([{ finished: 0, total: 5, speedBps: null }]).speedBps).toBeNull();
    expect(aggregateProgress([{ finished: 0, total: 5, speedBps: 0 }]).speedBps).toBeNull();
  });

  it('never reads as complete while a worker is still going', () => {
    const a = aggregateProgress([{ finished: 25, total: 25, speedBps: null }, { finished: 24, total: 25, speedBps: 10 }]);
    expect(a.percent).toBeLessThanOrEqual(99);
  });

  it('copes with no workers', () => {
    expect(aggregateProgress([])).toEqual({ percent: 0, finished: 0, total: 0, speedBps: null });
  });
});
