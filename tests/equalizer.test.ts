import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  EQ_BANDS, EQ_BAND_TYPES, EQ_GAIN_LIMIT, EQ_GROUP_LABELS, EQ_PROFILES, MAX_USER_PRESETS, QUICK_PROFILE_IDS, bandResponseDb, cleanPresetName, curveDb, curveFrequencies, fromFiveBands,
  freshPresetName, gainForTarget, gainsFor, headroomDb, newPresetId, normalizeBands, peakBoostDb, profileById, profileName, responseDb, sanitizeUserPresets, snapGain,
} from '@core/equalizer';

const flat = EQ_BANDS.map(() => 0);

describe('the bands and the built-in presets', () => {
  it('has ten bands an octave apart, shelves at the two ends and peaking bands between', () => {
    expect(EQ_BANDS).toHaveLength(10);
    for (let i = 1; i < EQ_BANDS.length; i++) expect(EQ_BANDS[i]! / EQ_BANDS[i - 1]!).toBeGreaterThan(1.4);
    for (let i = 1; i < EQ_BANDS.length - 1; i++) expect(EQ_BANDS[i]! / EQ_BANDS[i - 1]!).toBeGreaterThan(1.9);
    expect(EQ_BAND_TYPES[0]).toBe('lowshelf');
    expect(EQ_BAND_TYPES.at(-1)).toBe('highshelf');
    expect(EQ_BAND_TYPES.slice(1, -1).every((t) => t === 'peaking')).toBe(true);
  });

  it('gives every preset a gain per band, inside the limit, with a distinct id and name', () => {
    for (const p of EQ_PROFILES) {
      expect(p.gains, p.id).toHaveLength(EQ_BANDS.length);
      for (const g of p.gains) expect(Math.abs(g), p.id).toBeLessThanOrEqual(EQ_GAIN_LIMIT);
      expect(Object.keys(EQ_GROUP_LABELS)).toContain(p.group);
    }
    expect(new Set(EQ_PROFILES.map((p) => p.id)).size).toBe(EQ_PROFILES.length);
    expect(new Set(EQ_PROFILES.map((p) => p.name.toLowerCase())).size).toBe(EQ_PROFILES.length);
    expect(QUICK_PROFILE_IDS.every((id) => profileById(id))).toBe(true);
  });

  it('keeps the presets earlier versions had, under the same ids', () => {
    for (const id of ['flat', 'clarity', 'bass', 'vocal', 'treble', 'warm', 'loudness']) expect(profileById(id), id).toBeTruthy();
  });

  it('has presets that do what their names say, judged by the real curve', () => {
    const at = (id: string, hz: number) => responseDb(profileById(id)!.gains, hz);
    expect(at('bass', 62)).toBeGreaterThan(5);
    expect(at('bass', 4000)).toBeLessThan(0.5);
    expect(at('bass-reducer', 62)).toBeLessThan(-4);
    expect(at('treble', 8000)).toBeGreaterThan(4);
    expect(at('treble', 125)).toBeLessThan(0.5);
    expect(at('vocal', 2000)).toBeGreaterThan(3);
    expect(at('vocal', 62)).toBeLessThan(-1);
    expect(at('speech', 40)).toBeLessThan(-3.5); // no rumble
    expect(at('small-speakers', 40)).toBeLessThan(-3); // nothing for speakers that cannot play it
    expect(at('small-speakers', 250)).toBeGreaterThan(2);
    expect(at('warm', 62)).toBeGreaterThan(2);
    expect(at('warm', 8000)).toBeLessThan(-2);
    expect(at('loudness', 62)).toBeGreaterThan(3);
    expect(at('loudness', 8000)).toBeGreaterThan(3);
    expect(at('flat', 1000)).toBe(0);
  });
});

describe('the maths of the curve', () => {
  it('a peaking band gives its own gain at its centre and nothing far away', () => {
    for (const g of [-12, -6, 3, 9, 12]) {
      expect(bandResponseDb(5, g, 1000)).toBeCloseTo(g, 1);
      expect(Math.abs(bandResponseDb(5, g, 31))).toBeLessThan(0.5);
      expect(Math.abs(bandResponseDb(5, g, 16000))).toBeLessThan(0.7);
    }
  });

  it('a low shelf lifts everything below it and leaves the top alone; a high shelf the other way round', () => {
    expect(bandResponseDb(0, 6, 20)).toBeGreaterThan(5);
    expect(bandResponseDb(0, 6, 31)).toBeCloseTo(3, 0); // half the gain at its corner
    expect(Math.abs(bandResponseDb(0, 6, 4000))).toBeLessThan(0.1);
    expect(bandResponseDb(9, 6, 20000)).toBeGreaterThan(5);
    expect(Math.abs(bandResponseDb(9, 6, 250))).toBeLessThan(0.1);
  });

  it('is exactly flat for a flat curve, at every frequency', () => {
    for (const f of curveFrequencies(40)) expect(responseDb(flat, f)).toBe(0);
  });

  it('adds the bands in decibels, and a cut undoes a boost', () => {
    const a = [0, 0, 0, 0, 0, 4, 0, 0, 0, 0];
    const b = [0, 0, 0, 0, 0, -4, 0, 0, 0, 0];
    for (const f of [200, 1000, 3000]) expect(responseDb(a, f) + responseDb(b, f)).toBeCloseTo(0, 6);
    const both = [0, 0, 0, 0, 0, 4, 4, 0, 0, 0];
    expect(responseDb(both, 1400)).toBeCloseTo(responseDb(a, 1400) + responseDb([0, 0, 0, 0, 0, 0, 4, 0, 0, 0], 1400), 6);
  });

  it('draws 96 points across the audible range by default', () => {
    expect(curveDb(flat)).toHaveLength(96);
    const f = curveFrequencies();
    expect(f[0]).toBeCloseTo(20, 6);
    expect(f.at(-1)).toBeCloseTo(20000, 3);
  });
});

describe('headroom', () => {
  it('is none for a curve that only cuts, or lifts by 2 dB or less', () => {
    expect(headroomDb(flat)).toBe(0);
    expect(headroomDb(profileById('bass-reducer')!.gains)).toBe(0);
    expect(headroomDb([0, 0, 0, 0, 0, 1.5, 0, 0, 0, 0])).toBe(0);
  });

  it('takes off 60% of what the curve lifts above 2 dB, never positive, in tenths', () => {
    const peak = peakBoostDb(profileById('bass')!.gains);
    expect(peak).toBeGreaterThan(6);
    expect(headroomDb(profileById('bass')!.gains)).toBeCloseTo(-Math.round((peak - 2) * 0.6 * 10) / 10, 6);
    fc.assert(fc.property(fc.array(fc.integer({ min: -24, max: 24 }).map((n) => n / 2), { minLength: 10, maxLength: 10 }), (g) => {
      const h = headroomDb(g);
      expect(h).toBeLessThanOrEqual(0);
      expect(Math.round(h * 10) / 10).toBe(h);
      // Whatever the curve, the loudest point ends at most 40% of its excess above 2 dB over where it started.
      expect(peakBoostDb(g) + h).toBeLessThanOrEqual(2 + (peakBoostDb(g) - 2) * 0.4 + 0.06 + (peakBoostDb(g) < 2 ? 1e9 : 0));
    }), { numRuns: 200 });
  });

  it('keeps best sound’s own curve nearly at the level it was measured at', () => {
    expect(headroomDb(profileById('clarity')!.gains)).toBeGreaterThanOrEqual(-1);
  });
});

describe('dragging a dot', () => {
  it('puts the curve through the pointer at that band, whatever its neighbours are doing', () => {
    const neighbours = [3, -2, 4, 1, 0, 0, 2, -1, 5, 2];
    for (let band = 0; band < 10; band++) {
      for (const target of [-9, -3, 0, 2.5, 7]) {
        const g = gainForTarget(neighbours, band, target);
        const next = neighbours.map((v, i) => (i === band ? g : v));
        // The band moves in half-decibels, so the curve gets within a quarter of a decibel of the pointer (unless the band hit its limit).
        if (Math.abs(g) < EQ_GAIN_LIMIT) expect(Math.abs(responseDb(next, EQ_BANDS[band]!) - target), `band ${band} to ${target}`).toBeLessThanOrEqual(0.26);
      }
    }
  });

  it('stops a shelf at its limit when the pointer is beyond what it can reach', () => {
    expect(gainForTarget(flat, 0, 11)).toBe(EQ_GAIN_LIMIT); // a shelf gives about half its gain at its corner
    expect(gainForTarget(flat, 0, -11)).toBe(-EQ_GAIN_LIMIT);
    expect(gainForTarget(flat, 0, 3)).toBeCloseTo(6, 0);
    expect(gainForTarget(flat, 5, 3)).toBe(3);
  });

  it('never goes beyond the limit and always lands on a half-decibel', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 9 }), fc.double({ min: -40, max: 40, noNaN: true }), (band, target) => {
      const g = gainForTarget(flat, band, target);
      expect(Math.abs(g)).toBeLessThanOrEqual(EQ_GAIN_LIMIT);
      expect(g * 2).toBe(Math.round(g * 2));
    }), { numRuns: 200 });
    expect(snapGain(3.26)).toBe(3.5);
    expect(snapGain(-100)).toBe(-12);
    expect(snapGain(Number.NaN)).toBe(0);
  });
});

describe('curves saved by earlier versions', () => {
  it('re-fits a five-band curve to ten bands, keeping what it did at the old frequencies', () => {
    const old = [6, 0, 0, 0, 6]; // a V: bass and treble up
    const ten = normalizeBands(old);
    expect(ten).toHaveLength(10);
    expect(ten[1]).toBeGreaterThanOrEqual(5.5); // 62 Hz sits at the old 60 Hz band
    expect(ten[5]).toBe(0); // 1 kHz was flat
    expect(ten[9]).toBe(6); // beyond the old top band the value is held
    expect(ten[0]).toBe(6);
  });

  it('keeps a flat curve flat and a short or hostile array safe', () => {
    expect(fromFiveBands([0, 0, 0, 0, 0])).toEqual(flat);
    fc.assert(fc.property(fc.array(fc.oneof(fc.double({ noNaN: false }), fc.constant(Number.NaN)), { maxLength: 30 }), (a) => {
      const out = normalizeBands(a);
      expect(out).toHaveLength(10);
      for (const g of out) expect(Math.abs(g)).toBeLessThanOrEqual(EQ_GAIN_LIMIT);
    }), { numRuns: 300 });
    expect(normalizeBands(undefined)).toEqual(flat);
    expect(normalizeBands([50])).toEqual([12, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('choosing a curve', () => {
  it('resolves a built-in, a saved preset, and the person’s own edit', () => {
    const saved = [{ id: 'u-abc123', name: 'Mine', bands: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }];
    expect(gainsFor('flat', undefined)).toEqual(flat);
    expect(gainsFor('bass', undefined)).toEqual(profileById('bass')!.gains);
    expect(gainsFor('u-abc123', undefined, saved)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(gainsFor('custom', [3, -3, 100, Number.NaN])).toEqual([3, -3, 12, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('falls back to flat for a preset that no longer exists', () => {
    expect(gainsFor('does-not-exist', undefined)).toEqual(flat);
    expect(gainsFor('u-gone00', undefined, [])).toEqual(flat);
  });

  it('names a selection for display', () => {
    expect(profileName('bass')).toBe('Bass boost');
    expect(profileName('custom')).toBe('Edited');
    expect(profileName('u-abc123', [{ id: 'u-abc123', name: 'Mine', bands: flat }])).toBe('Mine');
    expect(profileName('u-gone00')).toBe('Saved preset');
  });
});

describe('saved presets', () => {
  const ok = (id: string, name: string, bands: unknown = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) => ({ id, name, bands });

  it('keeps good ones and clamps their gains', () => {
    const out = sanitizeUserPresets([ok('u-aaaaaa', '  Night  mix '), ok('u-bbbbbb', 'Loud', [99, -99, 0, 0, 0, 0, 0, 0, 0, 0])]);
    expect(out.map((p) => p.name)).toEqual(['Night mix', 'Loud']);
    expect(out[1]!.bands.slice(0, 2)).toEqual([12, -12]);
  });

  it('drops what cannot be used: bad ids, empty or repeated names, no bands, junk', () => {
    const out = sanitizeUserPresets([ok('flat', 'x'), ok('u-', 'x'), ok('u-aaaaaa', '   '), ok('u-bbbbbb', 'Same'), ok('u-cccccc', 'same'), ok('u-bbbbbb', 'Other'), ok('u-dddddd', 'NoBands', 'x'), null, 5, 'x']);
    expect(out.map((p) => p.id)).toEqual(['u-bbbbbb']);
    expect(sanitizeUserPresets('nope')).toEqual([]);
    expect(sanitizeUserPresets(undefined)).toEqual([]);
  });

  it('keeps at most 24', () => {
    const many = Array.from({ length: 40 }, (_, i) => ok(`u-p${String(i).padStart(4, '0')}`, `Preset ${i}`));
    expect(sanitizeUserPresets(many)).toHaveLength(MAX_USER_PRESETS);
  });

  it('cleans a name to one short line', () => {
    expect(cleanPresetName('a\nb\t c')).toBe('a b c');
    expect(cleanPresetName('x'.repeat(100))).toHaveLength(30);
    expect(cleanPresetName(42)).toBe('');
  });

  it('finds a free name, counting the built-in names as taken', () => {
    expect(freshPresetName('Mine', [])).toBe('Mine');
    expect(freshPresetName('Mine', ['Mine'])).toBe('Mine 2');
    expect(freshPresetName('mine', ['Mine', 'Mine 2'])).toBe('mine 3');
    expect(freshPresetName('Flat', [])).toBe('Flat 2');
    expect(freshPresetName('   ', [])).toBe('My preset');
    expect(freshPresetName('y'.repeat(60), ['y'.repeat(30)]).length).toBeLessThanOrEqual(30);
  });

  it('makes ids that the sanitiser accepts and that are not already used', () => {
    const id = newPresetId([]);
    expect(id).toMatch(/^u-[a-z0-9]{6}$/);
    expect(sanitizeUserPresets([{ id, name: 'x', bands: flat }])).toHaveLength(1);
    let calls = 0;
    expect(newPresetId(['u-000000'], () => (calls++ === 0 ? 0 : 0.5))).not.toBe('u-000000');
  });
});
