import { describe, it, expect } from 'vitest';
import {
  MAX_VOLUME, clampVolume, isBoosting, limiterSettings, nextVolume, volumeLabel, volumePercent, volumeSplit,
} from '@core/volume';

describe('splitting a volume between the element and the graph', () => {
  it('leaves everything to the media element up to 100%', () => {
    // Below unity the Web Audio graph is not involved at all, so an ordinary listener's audio path
    // has nothing of ours in it.
    for (const v of [0, 0.25, 0.5, 0.8, 1]) {
      expect(volumeSplit(v)).toEqual({ elementVolume: v, boostGain: 1 });
    }
  });

  it('pins the element at unity above 100% and puts the rest on the graph', () => {
    // The element clamps to 1 by specification, so anything above it has to come from elsewhere.
    expect(volumeSplit(1.5)).toEqual({ elementVolume: 1, boostGain: 1.5 });
    expect(volumeSplit(MAX_VOLUME)).toEqual({ elementVolume: 1, boostGain: MAX_VOLUME });
  });

  it('multiplies back to the volume that was asked for', () => {
    for (let v = 0; v <= MAX_VOLUME; v += 0.05) {
      const { elementVolume, boostGain } = volumeSplit(v);
      expect(elementVolume * boostGain, `at ${v}`).toBeCloseTo(v, 6);
    }
  });

  it('refuses to go past the ceiling, or below silence, or to accept nonsense', () => {
    expect(volumeSplit(99).boostGain).toBe(MAX_VOLUME);
    expect(volumeSplit(-3).elementVolume).toBe(0);
    // Nonsense falls back to 100%, not to the ceiling — a garbage value must never come out loud.
    expect(clampVolume(Number.NaN)).toBe(1);
    expect(clampVolume(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe('the limiter', () => {
  it('does nothing at all below 100%', () => {
    // Ratio 1 passes the signal through untouched, so normal listening is not coloured.
    for (const gain of [0.5, 1]) {
      expect(limiterSettings(gain).ratio).toBe(1);
      expect(limiterSettings(gain).threshold).toBe(0);
    }
  });

  it('becomes a brick wall below full scale as soon as the boost is on', () => {
    const l = limiterSettings(1.5);
    expect(l.threshold).toBeLessThan(0);
    expect(l.threshold).toBeGreaterThanOrEqual(-3);
    expect(l.ratio).toBeGreaterThanOrEqual(10);
    expect(l.knee).toBe(0);
  });

  it('catches a transient but does not pump', () => {
    const l = limiterSettings(MAX_VOLUME);
    expect(l.attack).toBeLessThanOrEqual(0.005);
    expect(l.release).toBeGreaterThanOrEqual(0.1);
  });

  it('turns on at exactly the point the boost does', () => {
    // If these two ever disagree, boosted audio clips or normal audio is compressed for nothing.
    for (const v of [0.9, 1, 1.01, 1.5, MAX_VOLUME]) {
      expect(limiterSettings(volumeSplit(v).boostGain).ratio > 1, `at ${v}`).toBe(isBoosting(v));
    }
  });
});

describe('what the listener reads', () => {
  it('says whole percent', () => {
    expect(volumeLabel(0)).toBe('0%');
    expect(volumeLabel(0.8)).toBe('80%');
    expect(volumeLabel(1)).toBe('100%');
    expect(volumeLabel(MAX_VOLUME)).toBe('200%');
    expect(volumePercent(1.234)).toBe(123);
  });

  it('knows when it is above normal', () => {
    expect(isBoosting(1)).toBe(false);
    expect(isBoosting(1.01)).toBe(true);
  });
});

describe('stepping the volume', () => {
  it('goes past 100% instead of stopping there', () => {
    expect(nextVolume(0.95, 0.1)).toBe(1.05);
    expect(nextVolume(1, 0.5)).toBe(1.5);
  });

  it('stops at the ceiling and at silence', () => {
    expect(nextVolume(MAX_VOLUME, 0.5)).toBe(MAX_VOLUME);
    expect(nextVolume(0.05, -0.5)).toBe(0);
  });

  it('lands on whole percents rather than drifting', () => {
    expect(nextVolume(0.2, 0.1)).toBe(0.3); // not 0.30000000000000004
  });
});
