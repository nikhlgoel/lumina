import { describe, it, expect } from 'vitest';
import { EQ_BANDS, EQ_PROFILES, gainsFor, normalizeBands, profileById } from '@core/equalizer';

describe('equalizer', () => {
  it('has a gain per band for every built-in profile', () => {
    for (const p of EQ_PROFILES) expect(p.gains).toHaveLength(EQ_BANDS.length);
  });

  it('resolves a built-in profile to its gains', () => {
    expect(gainsFor('flat', undefined)).toEqual(EQ_BANDS.map(() => 0));
    expect(gainsFor('bass', undefined)).toEqual(profileById('bass')!.gains);
  });

  it('falls back to flat for an unknown profile', () => {
    expect(gainsFor('does-not-exist', undefined)).toEqual(EQ_BANDS.map(() => 0));
  });

  it('uses custom bands for the custom profile, clamped and length-normalised', () => {
    const out = gainsFor('custom', [3, -3, 100, Number.NaN]);
    expect(out).toHaveLength(EQ_BANDS.length);
    expect(out[0]).toBe(3);
    expect(out[1]).toBe(-3);
    expect(out[2]).toBe(12); // clamped to +12
    expect(out[3]).toBe(0); // NaN -> 0
    expect(out[4]).toBe(0); // missing -> 0
  });

  it('normalizeBands pads short arrays and clamps out-of-range', () => {
    expect(normalizeBands([50])).toEqual([12, 0, 0, 0, 0]);
    expect(normalizeBands(undefined)).toEqual(EQ_BANDS.map(() => 0));
  });
});
