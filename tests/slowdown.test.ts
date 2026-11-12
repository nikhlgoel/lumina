import { describe, expect, it } from 'vitest';
import { HostPeaks, SlowdownWatch } from '@core/slowdown';

const MB = 1024 * 1024;
const S = 1000;

/** Feed one reading a second at `speed` for `seconds`, from `start`; returns the time after and the last answer. */
function run(w: SlowdownWatch, start: number, seconds: number, speed: number | null): { t: number; limited: boolean } {
  let limited = false;
  let t = start;
  for (let i = 0; i < seconds; i++) {
    t += S;
    limited = w.update(t, speed);
  }
  return { t, limited };
}

describe('noticing that a host has started limiting a download', () => {
  it('flags a collapse from a high speed that stays down, as the owner’s batch did (25 MB/s, then 1 MB/s)', () => {
    const w = new SlowdownWatch();
    const fast = run(w, 0, 120, 25 * MB);
    expect(fast.limited).toBe(false);
    const slow = run(w, fast.t, 90, 1 * MB);
    expect(slow.limited).toBe(true);
  });

  it('does not call a short dip a limit', () => {
    const w = new SlowdownWatch();
    const fast = run(w, 0, 120, 25 * MB);
    const dip = run(w, fast.t, 20, 1 * MB);
    expect(dip.limited).toBe(false);
    expect(run(w, dip.t, 60, 25 * MB).limited).toBe(false);
  });

  it('does not call a download that was always slow a limited one', () => {
    const w = new SlowdownWatch();
    expect(run(w, 0, 600, 1 * MB).limited).toBe(false);
    const w2 = new SlowdownWatch();
    const a = run(w2, 0, 120, 4 * MB); // a peak under the line that matters
    expect(run(w2, a.t, 300, 0.2 * MB).limited).toBe(false);
  });

  it('says the limit is over once the speed comes back', () => {
    const w = new SlowdownWatch();
    const fast = run(w, 0, 120, 25 * MB);
    const slow = run(w, fast.t, 90, 1 * MB);
    expect(slow.limited).toBe(true);
    expect(run(w, slow.t, 60, 24 * MB).limited).toBe(false);
  });

  it('ignores pauses and gaps: no reading is neither a limit nor the end of one', () => {
    const w = new SlowdownWatch();
    const fast = run(w, 0, 120, 25 * MB);
    const slow = run(w, fast.t, 90, 1 * MB);
    expect(run(w, slow.t, 30, null).limited).toBe(true); // a gap does not clear it
    const w2 = new SlowdownWatch();
    const f2 = run(w2, 0, 120, 25 * MB);
    expect(run(w2, f2.t, 120, null).limited).toBe(false); // and a gap alone does not start one
    expect(run(w2, f2.t + 120 * S, 120, 0).limited).toBe(false);
  });

  it('forgets how fast it once was after ten minutes, so an old peak does not condemn a new pace', () => {
    const w = new SlowdownWatch();
    const fast = run(w, 0, 60, 25 * MB);
    // a slide to 5 MB/s is not a collapse (20% of the peak); after eleven minutes the old 25 is forgotten, so 1 MB/s is 20% of what it is now
    const slid = run(w, fast.t, 11 * 60, 5 * MB);
    expect(slid.limited).toBe(false);
    expect(run(w, slid.t, 120, 1.2 * MB).limited).toBe(false);
  });

  it('keeps saying so for as long as a limit lasts, even past ten minutes', () => {
    const w = new SlowdownWatch();
    const fast = run(w, 0, 120, 25 * MB);
    expect(run(w, fast.t, 20 * 60, 1 * MB).limited).toBe(true);
  });

  it('can be reset when the person’s own speed limit changes, and then reads nothing into the old speeds', () => {
    const w = new SlowdownWatch();
    const fast = run(w, 0, 120, 25 * MB);
    w.reset();
    expect(run(w, fast.t, 300, 0.5 * MB).limited).toBe(false);
  });
});

describe('a file that starts already throttled (the second part of the owner’s batch)', () => {
  it('is recognised from what the first file from the same host reached', () => {
    const peaks = new HostPeaks();
    const first = new SlowdownWatch({ host: 'pixeldrain.com', peaks });
    const fast = run(first, 0, 120, 25 * MB);
    expect(fast.limited).toBe(false);
    const second = new SlowdownWatch({ host: 'pixeldrain.com', peaks });
    expect(run(second, fast.t, 30, 1 * MB).limited).toBe(false); // not at once: a dip is not a limit
    expect(run(second, fast.t + 30 * S, 60, 1 * MB).limited).toBe(true);
  });

  it('says nothing for another host, or for a file that is the only one from its host', () => {
    const peaks = new HostPeaks();
    run(new SlowdownWatch({ host: 'a.test', peaks }), 0, 120, 25 * MB);
    expect(run(new SlowdownWatch({ host: 'b.test', peaks }), 200 * S, 120, 1 * MB).limited).toBe(false);
    expect(run(new SlowdownWatch({ host: 'c.test', peaks: new HostPeaks() }), 0, 300, 1 * MB).limited).toBe(false);
  });

  it('forgets the host’s old speed after half an hour', () => {
    const peaks = new HostPeaks();
    const a = run(new SlowdownWatch({ host: 'a.test', peaks }), 0, 120, 25 * MB);
    const later = new SlowdownWatch({ host: 'a.test', peaks });
    expect(run(later, a.t + 31 * 60 * S, 200, 1 * MB).limited).toBe(false);
  });

  it('clears once the speed is back near what the host gave before', () => {
    const peaks = new HostPeaks();
    const a = run(new SlowdownWatch({ host: 'a.test', peaks }), 0, 120, 25 * MB);
    const second = new SlowdownWatch({ host: 'a.test', peaks });
    const slow = run(second, a.t, 90, 1 * MB);
    expect(slow.limited).toBe(true);
    expect(run(second, slow.t, 60, 24 * MB).limited).toBe(false);
  });
});

describe('what each host is remembered to have reached', () => {
  const MIN = 60_000;
  it('knows nothing about a host it has not seen', () => {
    expect(new HostPeaks().recent('never.test', 0)).toBe(0);
  });

  it('keeps the best speed: a slower reading later does not replace it, a faster one does', () => {
    const peaks = new HostPeaks();
    peaks.note('a.test', 10 * MB, 0);
    peaks.note('a.test', 3 * MB, 1000);
    expect(peaks.recent('a.test', 1000)).toBe(10 * MB);
    peaks.note('a.test', 30 * MB, 2000);
    expect(peaks.recent('a.test', 2000)).toBe(30 * MB);
  });

  it('forgets a speed after half an hour, to the minute, and takes a slower one then', () => {
    const peaks = new HostPeaks();
    peaks.note('a.test', 10 * MB, 0);
    expect(peaks.recent('a.test', 30 * MIN)).toBe(10 * MB); // exactly half an hour is still remembered
    expect(peaks.recent('a.test', 30 * MIN + 1)).toBe(0);
    peaks.note('a.test', 3 * MB, 31 * MIN);
    expect(peaks.recent('a.test', 31 * MIN)).toBe(3 * MB);
  });

  it('a reading equal to the best renews it, so a host that keeps giving the same speed is not forgotten', () => {
    const peaks = new HostPeaks();
    peaks.note('a.test', 10 * MB, 0);
    peaks.note('a.test', 10 * MB, 20 * MIN);
    expect(peaks.recent('a.test', 45 * MIN)).toBe(10 * MB);
  });
});

describe('between "limited" and "recovered"', () => {
  it('stays limited while the speed is only a little better (a quarter of the best), and clears once it is back to a good share', () => {
    const w = new SlowdownWatch();
    const fast = run(w, 0, 120, 24 * MB);
    const slow = run(w, fast.t, 120, 1 * MB);
    expect(slow.limited).toBe(true);
    const better = run(w, slow.t, 120, 6 * MB); // 25% of 24: above the line it fell under (15%), below the one that clears it (40%)
    expect(better.limited).toBe(true);
    expect(run(w, better.t, 120, 14 * MB).limited).toBe(false); // 58%
  });

  it('is not limited the moment it is reset, and a gap right after says so too', () => {
    const w = new SlowdownWatch();
    const fast = run(w, 0, 120, 25 * MB);
    expect(run(w, fast.t, 90, 1 * MB).limited).toBe(true);
    w.reset();
    expect(w.update(500 * S, null)).toBe(false);
  });
});
