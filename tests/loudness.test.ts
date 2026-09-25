import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PEAK_CEILING_DB, DEFAULT_TARGET_LUFS, MAX_BOOST_DB, MAX_CUT_DB,
  describeGain, isSilent, measureArgs, normalizationGain, parseEbur128,
} from '@core/loudness';

/** The real summary ffmpeg printed for a library track — the one that peaks above full scale. */
const SUMMARY = `[Parsed_ebur128_0 @ 00000162d7875b40] Summary:

  Integrated loudness:
    I:          -8.7 LUFS
    Threshold: -18.7 LUFS

  Loudness range:
    LRA:         3.8 LU
    Threshold: -28.7 LUFS
    LRA low:   -11.2 LUFS
    LRA high:   -7.4 LUFS

  True peak:
    Peak:        1.9 dBFS
`;

describe('parseEbur128', () => {
  it('reads what ffmpeg actually printed', () => {
    expect(parseEbur128(SUMMARY)).toEqual({ integratedLufs: -8.7, lra: 3.8, truePeakDbfs: 1.9 });
  });

  it('reads a negative true peak', () => {
    expect(parseEbur128(SUMMARY.replace('1.9 dBFS', '-0.3 dBFS'))!.truePeakDbfs).toBe(-0.3);
  });

  it('copes when no true peak was requested', () => {
    const without = SUMMARY.slice(0, SUMMARY.indexOf('  True peak:'));
    expect(parseEbur128(without)!.truePeakDbfs).toBeNull();
    expect(parseEbur128(without)!.integratedLufs).toBe(-8.7);
  });

  it('takes the last summary when a file has several audio streams', () => {
    const two = `${SUMMARY}\n${SUMMARY.replace('-8.7 LUFS', '-20.5 LUFS')}`;
    expect(parseEbur128(two)!.integratedLufs).toBe(-20.5);
  });

  it('returns null rather than guessing when there is no summary', () => {
    // A decode failure must never become "0 LUFS", which would turn into a 14 dB cut.
    expect(parseEbur128('')).toBeNull();
    expect(parseEbur128('Invalid data found when processing input')).toBeNull();
    expect(parseEbur128('I: not-a-number LUFS')).toBeNull();
  });
});

describe('normalizationGain', () => {
  it('turns the measured track down to the target', () => {
    // -8.7 LUFS to -14 LUFS is a 5.3 dB cut, and its +1.9 dBFS peak then lands at -3.4 dBTP.
    const g = normalizationGain({ integratedLufs: -8.7, lra: 3.8, truePeakDbfs: 1.9 });
    expect(g.gainDb).toBeCloseTo(-5.3, 5);
    expect(g.peakLimited).toBe(false);
    expect(1.9 + g.gainDb).toBeLessThanOrEqual(DEFAULT_PEAK_CEILING_DB);
  });

  it('turns a quiet track up', () => {
    expect(normalizationGain({ integratedLufs: -20, lra: 6, truePeakDbfs: -12 }).gainDb).toBeCloseTo(6, 5);
  });

  it('refuses to boost a quiet track into clipping — the peak wins', () => {
    // Wants +8 dB to reach the target, but only 5 dB of headroom exists above its peak.
    const g = normalizationGain({ integratedLufs: -22, lra: 6, truePeakDbfs: -6 });
    expect(g.gainDb).toBeCloseTo(5, 5);
    expect(g.peakLimited).toBe(true);
    expect(-6 + g.gainDb).toBeCloseTo(DEFAULT_PEAK_CEILING_DB, 5);
  });

  it('never lets any track exceed the ceiling, across the whole plausible range', () => {
    for (let lufs = -30; lufs <= -5; lufs += 0.5) {
      for (let peak = -20; peak <= 3; peak += 0.5) {
        const g = normalizationGain({ integratedLufs: lufs, lra: null, truePeakDbfs: peak });
        // Allow the rounding-to-zero deadzone its quarter of a decibel.
        expect(peak + g.gainDb, `${lufs} LUFS / ${peak} dBFS`).toBeLessThanOrEqual(DEFAULT_PEAK_CEILING_DB + 0.25);
      }
    }
  });

  it('leaves a track alone when it is already at the target', () => {
    expect(normalizationGain({ integratedLufs: -14, lra: 5, truePeakDbfs: -3 }).gainDb).toBe(0);
    // And within a hair of it — a fifth of a decibel is not worth a gain node.
    expect(normalizationGain({ integratedLufs: -14.2, lra: 5, truePeakDbfs: -3 }).gainDb).toBe(0);
  });

  it('gives a linear multiplier a gain node can use', () => {
    expect(normalizationGain({ integratedLufs: -14, lra: null, truePeakDbfs: -3 }).gainLinear).toBe(1);
    const down6 = normalizationGain({ integratedLufs: -8, lra: null, truePeakDbfs: -10 });
    expect(down6.gainDb).toBeCloseTo(-6, 5);
    expect(down6.gainLinear).toBeCloseTo(0.501, 3);
  });

  it('honours a different target when asked', () => {
    expect(normalizationGain({ integratedLufs: -8.7, lra: null, truePeakDbfs: -20 }, -18).gainDb).toBeCloseTo(-9.3, 5);
  });

  it('works when the true peak is unknown', () => {
    const g = normalizationGain({ integratedLufs: -20, lra: null, truePeakDbfs: null });
    expect(g.gainDb).toBeCloseTo(6, 5);
    expect(g.peakLimited).toBe(false);
  });

  it('clamps absurd measurements instead of trusting them', () => {
    expect(normalizationGain({ integratedLufs: -60, lra: null, truePeakDbfs: null }).gainDb).toBe(MAX_BOOST_DB);
    expect(normalizationGain({ integratedLufs: 30, lra: null, truePeakDbfs: null }).gainDb).toBe(MAX_CUT_DB);
  });

  it('leaves silence alone', () => {
    expect(isSilent({ integratedLufs: -70, lra: null, truePeakDbfs: null })).toBe(true);
    expect(normalizationGain({ integratedLufs: -70, lra: null, truePeakDbfs: null }).gainDb).toBe(0);
    expect(normalizationGain({ integratedLufs: -Infinity, lra: null, truePeakDbfs: null }).gainDb).toBe(0);
  });
});

describe('measureArgs', () => {
  it('measures without writing a file', () => {
    const args = measureArgs('C:/Music/track.flac');
    expect(args).toContain('C:/Music/track.flac');
    expect(args.join(' ')).toContain('ebur128=peak=true');
    // "-f null -" means decode it and throw the output away.
    expect(args.slice(-2)).toEqual(['null', '-']);
  });
});

describe('describeGain', () => {
  it('says why a track was turned down, distinguishing the two reasons', () => {
    expect(describeGain({ gainDb: -5.3, gainLinear: 0.54, peakLimited: false })).toBe('Turned down 5.3 dB to match everything else');
    expect(describeGain({ gainDb: -5, gainLinear: 0.56, peakLimited: true })).toBe('Turned down 5.0 dB to stop it clipping');
  });

  it('says when nothing is being done', () => {
    expect(describeGain({ gainDb: 0, gainLinear: 1, peakLimited: false })).toBe('Playing at its own level');
  });

  it('says when a track was lifted', () => {
    expect(describeGain({ gainDb: 6, gainLinear: 2, peakLimited: false })).toBe('Turned up 6.0 dB to match everything else');
  });
});

describe('the defaults match what listeners are used to', () => {
  it('targets the streaming services’ level', () => {
    expect(DEFAULT_TARGET_LUFS).toBe(-14);
  });

  it('keeps a decibel of headroom below full scale', () => {
    expect(DEFAULT_PEAK_CEILING_DB).toBe(-1);
  });
});
