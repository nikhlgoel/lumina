import { describe, it, expect } from 'vitest';
import { BUSY_GRACE_MS, initialStall, isLostFromEngine, needsSparse, rpcAction, sleptBetween, stallStep, type StallState } from '@core/engineWatch';

describe('an engine that no longer has a download', () => {
  it('recognises the engine saying it has never heard of the download (the owner\'s log line)', () => {
    expect(isLostFromEngine(new Error('GID 80acf7aeeb9c332c is not found'))).toBe(true);
    expect(isLostFromEngine('Error: GID d6ff0173df61232d is not found')).toBe(true);
  });

  it('does not take a silent, broken or busy engine for a lost download', () => {
    for (const e of ['TimeoutError: The operation was aborted due to timeout', 'TypeError: fetch failed', 'Error: ECONNREFUSED', 'Error: Cannot change option for GID#774956d041783b57', '']) {
      expect(isLostFromEngine(e), e).toBe(false);
    }
  });
});

describe('telling a sleeping computer from a silent engine', () => {
  it('does not call a normal poll gap sleep, even when a poll waited out its 10 s timeout', () => {
    expect(sleptBetween(1_000, 2_000)).toBe(false);
    expect(sleptBetween(1_000, 12_000)).toBe(false);
  });

  it('calls a gap of minutes sleep (the log showed 1524 s)', () => {
    expect(sleptBetween(1_000, 1_000 + 1_524_000)).toBe(true);
  });

  it('has no opinion before the first poll', () => {
    expect(sleptBetween(0, 5_000_000)).toBe(false);
  });
});

describe('which files are made sparse', () => {
  it('flags big files on Windows, where a far write blocks for as long as it takes to zero the gap', () => {
    expect(needsSparse('win32', 4 * 2 ** 30)).toBe(true);
    expect(needsSparse('win32', 100 * 2 ** 30)).toBe(true);
  });

  it('skips small files, whose gap is zeroed in well under a second', () => {
    expect(needsSparse('win32', 10 * 2 ** 20)).toBe(false);
    expect(needsSparse('win32', 0)).toBe(false);
  });

  it('leaves other platforms alone, where holes in a file cost nothing', () => {
    expect(needsSparse('linux', 100 * 2 ** 30)).toBe(false);
    expect(needsSparse('darwin', 100 * 2 ** 30)).toBe(false);
  });
});

describe('an engine that stops answering', () => {
  it('is left alone while it is alive and inside the grace period', () => {
    // The owner's log: 3 polls x 10 s = 30 s of silence used to kill it. A 20 GB-gap write takes 37 s.
    expect(rpcAction(30_000, true)).toBe('wait');
    expect(rpcAction(BUSY_GRACE_MS - 1, true)).toBe('wait');
  });

  it('is restarted once it has been silent longer than any disk write explains', () => {
    expect(rpcAction(BUSY_GRACE_MS, true)).toBe('restart');
  });

  it('is restarted at once when the process is gone', () => {
    expect(rpcAction(0, false)).toBe('restart');
  });
});

describe('a download that stops moving', () => {
  const run = (samples: Array<[number, number]>, opts?: { waitingForMetadata?: boolean; flowing?: boolean }) => {
    let s: StallState = initialStall(0, 0);
    const actions: string[] = [];
    for (const [t, bytes] of samples) {
      const r = stallStep(s, t * 1000, bytes, opts);
      s = r.state;
      if (r.action !== 'none') actions.push(`${t}s:${r.action}`);
    }
    return actions;
  };
  const every = (from: number, to: number, bytes: number, step = 5): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    for (let t = from; t <= to; t += step) out.push([t, bytes]);
    return out;
  };

  it('does nothing while bytes keep arriving', () => {
    const moving: Array<[number, number]> = Array.from({ length: 200 }, (_, i) => [i * 5, i * 1000]);
    expect(run(moving)).toEqual([]);
  });

  it('steps up from a re-announce to a re-add to an engine restart, and no faster', () => {
    expect(run([[0, 500], ...every(5, 500, 500)])).toEqual(['60s:nudge', '180s:readd', '420s:restart']);
  });

  it('keeps trying the heaviest step on a long stall instead of giving up', () => {
    const actions = run([[0, 500], ...every(10, 2400, 500, 10)]);
    expect(actions.slice(0, 3)).toEqual(['60s:nudge', '180s:readd', '420s:restart']);
    expect(actions.slice(3)).toEqual(['1020s:restart', '1620s:restart', '2220s:restart']);
  });

  it('starts the ladder over as soon as one byte arrives', () => {
    const actions = run([[0, 500], ...every(5, 100, 500), [105, 501], ...every(110, 160, 501)]);
    expect(actions).toEqual(['60s:nudge']);
  });

  it('does not drop the swarm of a download that is receiving data, even if the completed count is stuck', () => {
    // The owner's log: 61 s "stalled" while the engine reported 300 to 750 KB/s, then a pause and resume threw every peer away.
    expect(run([[0, 500], ...every(5, 300, 500)], { flowing: true })).toEqual([]);
  });

  it('still catches data that arrives but never completes, just much later', () => {
    expect(run([[0, 500], ...every(5, 5000, 500, 5)], { flowing: true }).slice(0, 2)).toEqual(['600s:nudge', '1800s:readd']);
  });

  it('counts growth from the new figure when the completed count drops (a different file choice), instead of waiting to catch up', () => {
    // 5 MB done, then the choice changes and the engine reports 1 MB. Growth from 1 MB is progress, though it is still below the old 5 MB.
    const growing: Array<[number, number]> = Array.from({ length: 30 }, (_, i) => [30 + i * 5, 1_000_000 + (i + 1) * 100_000]);
    expect(run([[0, 5_000_000], ...every(5, 20, 5_000_000), [25, 1_000_000], ...growing])).toEqual([]);
  });

  it('still catches a download whose count dropped and then really stopped, on the original schedule', () => {
    expect(run([[0, 5_000_000], [25, 1_000_000], ...every(30, 100, 1_000_000)])).toEqual(['60s:nudge']);
  });

  it('never calls the wait for a magnet link’s metadata a stall', () => {
    expect(run(every(0, 900, 0), { waitingForMetadata: true })).toEqual([]);
  });

  it('never acts on a finished download that is only seeding', () => {
    let s = initialStall(0, 1000);
    const r = stallStep(s, 999_000, 1000, { finished: true });
    expect(r.action).toBe('none');
    s = r.state;
    expect(stallStep(s, 1_000_000, 1000).action).toBe('none');
  });
});
