import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { CEILING, CEILING_KNEE, ceilingCurve, softCeiling } from '@core/volume';

describe('the soft ceiling after the limiter', () => {
  it('leaves everything below the knee exactly as it is', () => {
    for (const x of [0, 0.1, -0.5, 0.9, -0.93, CEILING_KNEE]) expect(softCeiling(x)).toBe(x);
  });

  it('bends what is above the knee, smoothly, and never lets it reach full scale', () => {
    expect(softCeiling(1)).toBeLessThan(CEILING);
    expect(softCeiling(1)).toBeGreaterThan(CEILING_KNEE);
    expect(softCeiling(10)).toBeLessThanOrEqual(CEILING);
    expect(softCeiling(1e9)).toBeLessThanOrEqual(CEILING);
    // The slope is 1 at the knee: no corner for the ear to hear.
    expect((softCeiling(CEILING_KNEE + 1e-4) - softCeiling(CEILING_KNEE)) / 1e-4).toBeGreaterThan(0.99);
  });

  it('is odd-symmetric, never decreasing, and bounded by the ceiling, for any input', () => {
    fc.assert(fc.property(fc.double({ min: -50, max: 50, noNaN: true }), fc.double({ min: -50, max: 50, noNaN: true }), (a, b) => {
      expect(softCeiling(-a)).toBeCloseTo(-softCeiling(a), 12);
      expect(Math.abs(softCeiling(a))).toBeLessThanOrEqual(CEILING);
      if (a <= b) expect(softCeiling(a)).toBeLessThanOrEqual(softCeiling(b) + 1e-12);
    }), { numRuns: 500 });
  });

  it('gives zero for something that is not a number', () => {
    expect(softCeiling(Number.NaN)).toBe(0);
    expect(softCeiling(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('is a table across -1..1 for the audio graph, identity in the middle and held at the ends', () => {
    const c = ceilingCurve(2049);
    expect(c).toHaveLength(2049);
    expect(c[1024]).toBeCloseTo(0, 6);
    expect(c[0]).toBeCloseTo(-softCeiling(1), 6);
    expect(c[2048]).toBeCloseTo(softCeiling(1), 6);
    for (let i = 1; i < c.length; i++) expect(c[i]!).toBeGreaterThanOrEqual(c[i - 1]!);
    for (let i = 0; i < c.length; i++) expect(Math.abs(c[i]!)).toBeLessThanOrEqual(CEILING);
    // Linear interpolation between table points must not change the part that should be untouched.
    const x = 0.5;
    expect(c[Math.round(((x + 1) / 2) * 2048)]).toBeCloseTo(x, 3);
  });
});
