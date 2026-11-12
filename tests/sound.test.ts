import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { BEST_SOUND_TARGET_LUFS, CLARITY_GAINS, effectiveEq, effectiveLoudnessTarget, eqPlan, isFlat, needsLimiter } from '@core/sound';
import { EQ_BANDS, EQ_GAIN_LIMIT, EQ_PROFILES, gainsFor, profileById, responseDb } from '@core/equalizer';
import { limiterSettings } from '@core/volume';
import { settingsSchema } from '@shared/settings';

describe('best sound: the loudness it matches to', () => {
  it('raises the usual -14 LUFS to -12, and never lowers a louder choice', () => {
    expect(effectiveLoudnessTarget(true, -14)).toBe(-12);
    expect(effectiveLoudnessTarget(true, -20)).toBe(-12);
    expect(effectiveLoudnessTarget(true, -12)).toBe(-12);
    expect(effectiveLoudnessTarget(true, -9)).toBe(-9);
    expect(effectiveLoudnessTarget(true, -5)).toBe(-5);
  });

  it('leaves the person’s own target alone when it is off', () => {
    for (const t of [-30, -14, -9, -5]) expect(effectiveLoudnessTarget(false, t)).toBe(t);
  });

  it('falls back to -12 for a target that is not a number', () => {
    expect(effectiveLoudnessTarget(true, NaN)).toBe(BEST_SOUND_TARGET_LUFS);
    expect(effectiveLoudnessTarget(false, NaN)).toBe(BEST_SOUND_TARGET_LUFS);
  });
});

describe('best sound: the curve it applies', () => {
  it('is gentle: every band within 3 dB, and the same count as the equalizer has bands', () => {
    expect(CLARITY_GAINS).toHaveLength(EQ_BANDS.length);
    for (const g of CLARITY_GAINS) expect(Math.abs(g)).toBeLessThanOrEqual(3);
  });

  it('warms the bottom, clears the mud, and adds presence and air', () => {
    // Judged on the real curve: warmth at 62 Hz, a dip around 250 Hz, presence at 4 kHz and air at 8 kHz.
    expect(responseDb(CLARITY_GAINS, 62)).toBeGreaterThan(1);
    expect(responseDb(CLARITY_GAINS, 250)).toBeLessThan(-0.5);
    expect(responseDb(CLARITY_GAINS, 4000)).toBeGreaterThan(1.5);
    expect(responseDb(CLARITY_GAINS, 8000)).toBeGreaterThan(1.5);
  });

  it('is also an equalizer profile people can pick, with the same numbers', () => {
    expect(profileById('clarity')?.gains).toEqual([...CLARITY_GAINS]);
    expect(EQ_PROFILES.map((p) => p.id)).toContain('clarity');
  });

  it('is used when the equalizer is off, and replaced by the person’s own curve when it is on', () => {
    const mine = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(effectiveEq(true, false, mine.map(() => 9))).toEqual([...CLARITY_GAINS]);
    expect(effectiveEq(true, true, mine)).toEqual(mine); // not layered on top
    expect(effectiveEq(false, false, mine)).toEqual(EQ_BANDS.map(() => 0));
    expect(effectiveEq(false, true, mine)).toEqual(mine);
  });

  it('always gives one gain per band, however short the person’s curve is', () => {
    fc.assert(fc.property(fc.boolean(), fc.boolean(), fc.array(fc.integer({ min: -12, max: 12 }), { maxLength: 8 }), (best, on, user) => {
      const out = effectiveEq(best, on, user);
      expect(out).toHaveLength(EQ_BANDS.length);
      for (const g of out) expect(Math.abs(g)).toBeLessThanOrEqual(EQ_GAIN_LIMIT);
    }), { numRuns: 300 });
  });

  it('knows a curve that changes nothing', () => {
    expect(isFlat([0, 0, 0, 0, 0])).toBe(true);
    expect(isFlat(CLARITY_GAINS)).toBe(false);
    expect(isFlat(gainsFor('flat', undefined))).toBe(true);
  });
});

describe('best sound: the limiter', () => {
  it('is on whenever best sound is on, or anything has added gain, and off for plain playback', () => {
    expect(needsLimiter({ bestSound: true, trackGain: 1, boostGain: 1 })).toBe(true);
    expect(needsLimiter({ bestSound: false, trackGain: 1.4, boostGain: 1 })).toBe(true); // loudness matching lifted a quiet track
    expect(needsLimiter({ bestSound: false, trackGain: 1, boostGain: 1.5 })).toBe(true); // the volume boost
    expect(needsLimiter({ bestSound: false, trackGain: 0.7, boostGain: 1 })).toBe(false); // only turned down: nothing to catch
    expect(needsLimiter({ bestSound: false, trackGain: 1, boostGain: 1 })).toBe(false);
  });

  it('is on when the equalizer lifts anything, even with best sound off (a bass boost on a loud track used to clip)', () => {
    expect(needsLimiter({ bestSound: false, trackGain: 1, boostGain: 1, eqPeakDb: 6 })).toBe(true);
    expect(needsLimiter({ bestSound: false, trackGain: 1, boostGain: 1, eqPeakDb: 0.2 })).toBe(true);
    expect(needsLimiter({ bestSound: false, trackGain: 1, boostGain: 1, eqPeakDb: 0 })).toBe(false); // a curve that only cuts needs none
  });

  it('plans the equalizer stage: the curve, the headroom it asks for, and how high it lifts', () => {
    const bass = eqPlan(false, true, profileById('bass')!.gains);
    expect(bass.gains).toEqual(profileById('bass')!.gains);
    expect(bass.peakDb).toBeGreaterThan(6);
    expect(bass.headroomDb).toBeLessThan(-2);
    const off = eqPlan(false, false, profileById('bass')!.gains);
    expect(off).toEqual({ gains: EQ_BANDS.map(() => 0), headroomDb: 0, peakDb: 0 });
    expect(eqPlan(true, false, []).gains).toEqual([...CLARITY_GAINS]);
  });

  it('is a wall just under full scale when it is on, and passes the signal untouched when it is off', () => {
    const wall = limiterSettings(1, true);
    expect(wall.ratio).toBeGreaterThanOrEqual(20);
    expect(wall.threshold).toBeLessThan(0);
    expect(wall.threshold).toBeGreaterThanOrEqual(-3);
    expect(wall.attack).toBeLessThanOrEqual(0.005); // quick enough to catch a transient
    expect(limiterSettings(1, false)).toMatchObject({ ratio: 1, threshold: 0 });
    expect(limiterSettings(1.5, false)).toEqual(wall); // the boost uses the same wall
  });
});

describe('the settings', () => {
  it('turn best sound on by default, and keep the person’s own equalizer choice off until they turn it on', () => {
    const p = settingsSchema.parse({}).player;
    expect(p.bestSound).toBe(true);
    expect(p.normalizeLoudness).toBe(true);
    expect(p.eqEnabled).toBe(false);
  });

  it('start the equalizer flat, with no saved presets, and read a five-band curve from an earlier version', () => {
    const p = settingsSchema.parse({}).player;
    expect(p.eqBands).toHaveLength(10);
    expect(p.eqPresets).toEqual([]);
    expect(p.eqBase).toBe('flat');
    const old = settingsSchema.parse({ player: { eqEnabled: true, eqProfile: 'custom', eqBands: [3, 0, 0, 0, -3] } }).player;
    expect(old.eqBands).toEqual([3, 0, 0, 0, -3]); // kept as stored; core/equalizer re-fits it when it is read
    expect(gainsFor('custom', old.eqBands)).toHaveLength(10);
  });

  it('survive a hand-edited file with junk where saved presets go', () => {
    const p = settingsSchema.parse({ player: { eqPresets: 'nonsense', eqBase: 5 } }).player;
    expect(p.eqPresets).toEqual([]);
    expect(p.eqBase).toBe('flat');
  });

  it('give an old settings file (without the new switch) best sound too', () => {
    const old = settingsSchema.parse({ player: { eqEnabled: false, normalizeLoudness: true, loudnessTarget: -14, volume: 0.8 } }).player;
    expect(old.bestSound).toBe(true);
    expect(effectiveLoudnessTarget(old.bestSound, old.loudnessTarget)).toBe(-12);
  });
});
