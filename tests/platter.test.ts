import { describe, expect, it } from 'vitest';
import { PLATTER_PERIOD_MS, platterRate } from '@core/platter';

const run = (start: number, playing: boolean, ms: number, step = 16) => {
  let r = start;
  for (let t = 0; t < ms; t += step) r = platterRate(r, playing, step);
  return r;
};

describe('platterRate', () => {
  it('speeds up smoothly and never overshoots full speed', () => {
    let r = 0;
    let last = 0;
    for (let i = 0; i < 400; i++) {
      r = platterRate(r, true, 16);
      expect(r).toBeGreaterThanOrEqual(last);
      expect(r).toBeLessThanOrEqual(1);
      last = r;
    }
    expect(r).toBe(1);
  });

  it('is not at full speed the instant playback starts', () => {
    expect(platterRate(0, true, 16)).toBeLessThan(0.1);
  });

  it('coasts to a stop more slowly than it spins up', () => {
    const afterUp = run(0, true, 1000);
    const afterDown = run(1, false, 1000);
    expect(1 - afterDown).toBeLessThan(afterUp);
  });

  it('lands exactly on the target so the animation loop can stop', () => {
    expect(run(1, false, 12_000)).toBe(0);
    expect(run(0, true, 12_000)).toBe(1);
  });

  it('does not jump when a frame is very late', () => {
    expect(platterRate(0, true, 60_000)).toBe(platterRate(0, true, 100));
  });

  it('survives junk input', () => {
    expect(platterRate(Number.NaN, true, 16)).toBe(1);
    expect(platterRate(0.5, true, Number.NaN)).toBe(0.5);
    expect(platterRate(7, false, 16)).toBeLessThanOrEqual(1);
  });

  it('keeps a turn slower than a real 33 1/3 rpm record', () => {
    expect(PLATTER_PERIOD_MS).toBeGreaterThan(1800);
  });
});
