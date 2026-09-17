/**
 * Equalizer profiles, shared by the player's Web Audio graph, the settings/player UI and the tray menu.
 * Bands are peaking filters at fixed centre frequencies; gains are in dB, clamped to ±12.
 */
export const EQ_BANDS = [60, 250, 1000, 4000, 12000] as const;
export const EQ_BAND_LABELS = ['60', '250', '1k', '4k', '12k'] as const;
export const EQ_GAIN_LIMIT = 12;

export interface EqProfile {
  id: string;
  name: string;
  description: string;
  gains: number[]; // one entry per EQ_BANDS, in dB
}

/** Built-in presets. `custom` is not here — it's the user's own band values from settings. */
export const EQ_PROFILES: readonly EqProfile[] = [
  { id: 'flat', name: 'Flat', description: 'No changes — the sound exactly as recorded.', gains: [0, 0, 0, 0, 0] },
  { id: 'bass', name: 'Bass boost', description: 'Deeper, punchier low end.', gains: [7, 4, 0, 0, 1] },
  { id: 'vocal', name: 'Vocal', description: 'Brings voices and dialogue forward.', gains: [-2, 0, 3, 3, 1] },
  { id: 'treble', name: 'Treble', description: 'Crisper highs and more detail.', gains: [0, 0, 0, 3, 6] },
  { id: 'warm', name: 'Warm', description: 'Smooth and mellow, easy on the ears.', gains: [3, 2, 0, -1, -3] },
  { id: 'loudness', name: 'Loudness', description: 'Boosted lows and highs for quiet listening.', gains: [6, 3, 0, 3, 6] },
] as const;

export const DEFAULT_EQ_BANDS: number[] = EQ_BANDS.map(() => 0);

export function profileById(id: string): EqProfile | undefined {
  return EQ_PROFILES.find((p) => p.id === id);
}

const clampGain = (g: number): number =>
  Math.max(-EQ_GAIN_LIMIT, Math.min(EQ_GAIN_LIMIT, Number.isFinite(g) ? g : 0));

/** Force any stored band array to the right length and range. */
export function normalizeBands(bands: readonly number[] | undefined): number[] {
  return EQ_BANDS.map((_, i) => clampGain(bands?.[i] ?? 0));
}

/**
 * The gains the audio graph should apply for a given selection.
 * `custom` uses the user's own bands; every other id resolves to its preset (falling back to flat).
 */
export function gainsFor(profileId: string, customBands: readonly number[] | undefined): number[] {
  if (profileId === 'custom') return normalizeBands(customBands);
  return normalizeBands(profileById(profileId)?.gains);
}
