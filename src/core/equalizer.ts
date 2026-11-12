/**
 * The equalizer: ten bands, the presets, the person's own saved presets, and the maths of the curve they make.
 *
 * Shared by the player's Web Audio graph, the panel that draws the curve, the tray menu, and the tests that hold the graph to the maths.
 *
 * Why ten bands with shelves: the lowest and highest bands are shelves (they lift or cut everything below or above them), as in every
 * graphic equalizer worth the name. With five peaking bands "treble +6" was a narrow bump around 12 kHz and "bass boost" a bump around 60 Hz;
 * a shelf is what people mean by either. The ten are an octave apart (the last two a little closer: a shelf whose corner sat at 16 kHz could not lift
 * the 8 to 14 kHz range that "treble" means, and left a dip at 12 kHz), so neighbours overlap into one smooth curve.
 */
export const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 12000] as const;
export const EQ_BAND_LABELS = ['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '12k'] as const;
export const EQ_BAND_TYPES = ['lowshelf', 'peaking', 'peaking', 'peaking', 'peaking', 'peaking', 'peaking', 'peaking', 'peaking', 'highshelf'] as const;
export type EqBandType = (typeof EQ_BAND_TYPES)[number];
/** Peaking bands one octave apart: a Q of about 1.41 makes each band's skirt meet the next one's at half height. Shelves have no Q in Web Audio. */
export const EQ_Q = 1.41;
export const EQ_GAIN_LIMIT = 12;
export const EQ_GAIN_STEP = 0.5;

/** The five centre frequencies earlier versions stored their curves at: a saved curve is re-fitted to the ten bands. */
const OLD_BANDS = [60, 250, 1000, 4000, 12000] as const;

export type EqGroup = 'everyday' | 'genres' | 'situations';

export interface EqProfile {
  id: string;
  name: string;
  description: string;
  group: EqGroup;
  /** Gain in dB for each of EQ_BANDS. */
  gains: number[];
}

/** Built-in presets. `custom` is not here: it is the person's own band values from settings. */
export const EQ_PROFILES: readonly EqProfile[] = [
  { id: 'flat', name: 'Flat', description: 'Exactly as recorded.', group: 'everyday', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: 'clarity', name: 'Clarity', description: 'Clear and a little brighter: warm lows, less mud, more presence and air.', group: 'everyday', gains: [1.5, 2, 0.5, -1.5, -1, 0.5, 1.5, 2.5, 2.5, 2] },
  { id: 'bass', name: 'Bass boost', description: 'Deeper, punchier low end.', group: 'everyday', gains: [6, 6, 4, 2, 0, 0, 0, 0, 0, 0] },
  { id: 'bass-reducer', name: 'Bass reducer', description: 'Less rumble and boom.', group: 'everyday', gains: [-6, -5, -3, -1.5, 0, 0, 0, 0, 0, 0] },
  { id: 'vocal', name: 'Vocal', description: 'Brings voices and dialogue forward.', group: 'everyday', gains: [-2, -2, -1, 0, 1.5, 2.5, 3, 2.5, 1, 0] },
  { id: 'treble', name: 'Treble boost', description: 'Crisper highs and more detail.', group: 'everyday', gains: [0, 0, 0, 0, 0, 0, 1, 2.5, 3.5, 5] },
  { id: 'warm', name: 'Warm', description: 'Smooth and mellow, easy on the ears.', group: 'everyday', gains: [3, 3, 2, 1, 0.5, 0, -1, -2, -3, -3.5] },
  { id: 'loudness', name: 'Loudness', description: 'A fuller sound at low volume: more bass and treble.', group: 'everyday', gains: [6, 5, 2.5, 0, -1, -1, 0, 2, 4.5, 5] },
  { id: 'acoustic', name: 'Acoustic', description: 'Natural and airy: guitars, strings and voices.', group: 'genres', gains: [3, 3, 2, 1, 1, 1.5, 2, 2, 2.5, 2] },
  { id: 'electronic', name: 'Electronic', description: 'Deep bass and a sparkling top.', group: 'genres', gains: [5, 4.5, 2, 0, -2, -1.5, 1, 3, 4, 4.5] },
  { id: 'hiphop', name: 'Hip-hop', description: 'Heavy low end with clear vocals.', group: 'genres', gains: [5, 5, 3, 1.5, -0.5, -0.5, 1, 1, 2, 2.5] },
  { id: 'jazz', name: 'Jazz', description: 'Warm body and a soft, open top.', group: 'genres', gains: [2, 2, 1, 1.5, -1.5, -1.5, 0, 1, 2, 3] },
  { id: 'rock', name: 'Rock', description: 'Punch in the lows and bite in the highs.', group: 'genres', gains: [4, 3, 2, -1, -2, -1, 1, 3, 4, 4] },
  { id: 'speech', name: 'Podcast and speech', description: 'Clear voices, no rumble.', group: 'situations', gains: [-7, -5, -2, 0, 1, 2.5, 3.5, 3, 1, -1] },
  { id: 'night', name: 'Late night', description: 'A fuller sound for quiet listening.', group: 'situations', gains: [4, 3.5, 2, 0, -1, -1, 0, 1.5, 3, 3] },
  { id: 'small-speakers', name: 'Small speakers', description: 'Drops the deep bass laptop speakers cannot play, and adds body above it.', group: 'situations', gains: [-6, -4, 1, 3, 2, 1, 0.5, 1, 1, 0.5] },
] as const;

/** The five shown as chips; the rest are in the "More" list. */
export const QUICK_PROFILE_IDS = ['flat', 'clarity', 'bass', 'vocal', 'treble'] as const;

export const EQ_GROUP_LABELS: Record<EqGroup, string> = { everyday: 'Everyday', genres: 'Genres', situations: 'Situations' };

export const DEFAULT_EQ_BANDS: number[] = EQ_BANDS.map(() => 0);

/** A preset the person saved, with a name of their own. */
export interface UserPreset { id: string; name: string; bands: number[] }

export const MAX_USER_PRESETS = 24;
export const MAX_PRESET_NAME = 30;
export const USER_PRESET_PREFIX = 'u-';

export function profileById(id: string): EqProfile | undefined {
  return EQ_PROFILES.find((p) => p.id === id);
}

const clampGain = (g: number): number => Math.max(-EQ_GAIN_LIMIT, Math.min(EQ_GAIN_LIMIT, Number.isFinite(g) ? g : 0));

/** Round to the half-decibel the controls move in. */
export const snapGain = (g: number): number => Math.round(clampGain(g) / EQ_GAIN_STEP) * EQ_GAIN_STEP;

/**
 * A curve stored at the old five centre frequencies, re-fitted to the ten: each new band takes the value the old curve had at its frequency
 * (straight lines between the old points on a log-frequency axis; beyond the first and last, the end value is held).
 */
export function fromFiveBands(old: readonly number[]): number[] {
  const xs = OLD_BANDS.map((f) => Math.log2(f));
  const ys = OLD_BANDS.map((_, i) => clampGain(old[i] ?? 0));
  return EQ_BANDS.map((f) => {
    const x = Math.log2(f);
    if (x <= xs[0]!) return ys[0]!;
    if (x >= xs[xs.length - 1]!) return ys[ys.length - 1]!;
    let i = 0;
    while (x > xs[i + 1]!) i++;
    const t = (x - xs[i]!) / (xs[i + 1]! - xs[i]!);
    return Math.round((ys[i]! + (ys[i + 1]! - ys[i]!) * t) * 2) / 2;
  });
}

/** Force any stored band array to the right length and range. A five-band curve from an earlier version is re-fitted to ten. */
export function normalizeBands(bands: readonly number[] | undefined): number[] {
  if (bands?.length === OLD_BANDS.length) return fromFiveBands(bands);
  return EQ_BANDS.map((_, i) => clampGain(bands?.[i] ?? 0));
}

/** The presets the person saved, cleaned: at most 24, each with a usable id and a distinct, trimmed name, and ten clamped gains. */
export function sanitizeUserPresets(raw: unknown): UserPreset[] {
  if (!Array.isArray(raw)) return [];
  const out: UserPreset[] = [];
  const names = new Set<string>();
  const ids = new Set<string>();
  for (const item of raw) {
    if (out.length >= MAX_USER_PRESETS) break;
    if (!item || typeof item !== 'object') continue;
    const { id, name, bands } = item as Record<string, unknown>;
    if (typeof id !== 'string' || !/^u-[a-z0-9-]{1,36}$/.test(id) || ids.has(id)) continue;
    const clean = cleanPresetName(name);
    if (!clean || names.has(clean.toLowerCase())) continue;
    if (!Array.isArray(bands)) continue;
    ids.add(id);
    names.add(clean.toLowerCase());
    out.push({ id, name: clean, bands: normalizeBands(bands.map((b) => Number(b))) });
  }
  return out;
}

/** A name for a saved preset: single line, trimmed, at most 30 characters; '' when nothing usable is left. */
export function cleanPresetName(name: unknown): string {
  return typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_PRESET_NAME).trim() : '';
}

/** A name that is not taken yet: "Mine", then "Mine 2", "Mine 3". Built-in names count as taken. */
export function freshPresetName(wanted: string, taken: readonly string[]): string {
  const base = cleanPresetName(wanted) || 'My preset';
  const used = new Set([...taken, ...EQ_PROFILES.map((p) => p.name)].map((n) => n.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; n < 1000; n++) {
    const suffix = ` ${n}`;
    const name = `${base.slice(0, MAX_PRESET_NAME - suffix.length).trim()}${suffix}`;
    if (!used.has(name.toLowerCase())) return name;
  }
  return base;
}

/** A new id for a saved preset, not among the existing ones. */
export function newPresetId(existing: readonly string[], random: () => number = Math.random): string {
  for (;;) {
    const id = `${USER_PRESET_PREFIX}${Math.floor(random() * 36 ** 6).toString(36).padStart(6, '0')}`;
    if (!existing.includes(id)) return id;
  }
}

/**
 * The gains the audio graph should apply for a given selection.
 * `custom` uses the person's own bands; a saved preset its own; every other id resolves to its built-in (falling back to flat).
 */
export function gainsFor(profileId: string, customBands: readonly number[] | undefined, userPresets: readonly UserPreset[] = []): number[] {
  if (profileId === 'custom') return normalizeBands(customBands);
  if (profileId.startsWith(USER_PRESET_PREFIX)) return normalizeBands(userPresets.find((p) => p.id === profileId)?.bands);
  return normalizeBands(profileById(profileId)?.gains);
}

/** The name to show for a selection ("Flat", a saved name, "Edited"). */
export function profileName(profileId: string, userPresets: readonly UserPreset[] = []): string {
  if (profileId === 'custom') return 'Edited';
  return profileId.startsWith(USER_PRESET_PREFIX) ? userPresets.find((p) => p.id === profileId)?.name ?? 'Saved preset' : profileById(profileId)?.name ?? 'Flat';
}

// ---- the curve ----

type Coefficients = { b0: number; b1: number; b2: number; a0: number; a1: number; a2: number };

/** The filter coefficients Web Audio uses for one band (the audio EQ cookbook the Web Audio specification is written from; shelf slope 1). */
function coefficients(type: EqBandType, f0: number, gainDb: number, sampleRate: number): Coefficients {
  const A = 10 ** (gainDb / 40);
  const w0 = (2 * Math.PI * f0) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  if (type === 'peaking') {
    const alpha = sin / (2 * EQ_Q);
    return { b0: 1 + alpha * A, b1: -2 * cos, b2: 1 - alpha * A, a0: 1 + alpha / A, a1: -2 * cos, a2: 1 - alpha / A };
  }
  const alpha = (sin / 2) * Math.SQRT2; // shelf slope S = 1
  const k = 2 * Math.sqrt(A) * alpha;
  if (type === 'lowshelf') {
    return {
      b0: A * (A + 1 - (A - 1) * cos + k), b1: 2 * A * (A - 1 - (A + 1) * cos), b2: A * (A + 1 - (A - 1) * cos - k),
      a0: A + 1 + (A - 1) * cos + k, a1: -2 * (A - 1 + (A + 1) * cos), a2: A + 1 + (A - 1) * cos - k,
    };
  }
  return {
    b0: A * (A + 1 + (A - 1) * cos + k), b1: -2 * A * (A - 1 + (A + 1) * cos), b2: A * (A + 1 + (A - 1) * cos - k),
    a0: A + 1 - (A - 1) * cos + k, a1: 2 * (A - 1 - (A + 1) * cos), a2: A + 1 - (A - 1) * cos - k,
  };
}

/** One band's response in dB at a frequency. */
export function bandResponseDb(band: number, gainDb: number, hz: number, sampleRate = 48000): number {
  const c = coefficients(EQ_BAND_TYPES[band]!, EQ_BANDS[band]!, clampGain(gainDb), sampleRate);
  const w = (2 * Math.PI * hz) / sampleRate;
  const [c1, s1, c2, s2] = [Math.cos(w), Math.sin(w), Math.cos(2 * w), Math.sin(2 * w)];
  const nr = c.b0 + c.b1 * c1 + c.b2 * c2;
  const ni = -(c.b1 * s1 + c.b2 * s2);
  const dr = c.a0 + c.a1 * c1 + c.a2 * c2;
  const di = -(c.a1 * s1 + c.a2 * s2);
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}

/** The whole equalizer's response in dB at a frequency: the bands in series, so their decibels add. */
export function responseDb(gains: readonly number[], hz: number, sampleRate = 48000): number {
  let total = 0;
  for (let i = 0; i < EQ_BANDS.length; i++) {
    const g = gains[i] ?? 0;
    if (g !== 0) total += bandResponseDb(i, g, hz, sampleRate);
  }
  return total;
}

/** Frequencies on a log axis from 20 Hz to 20 kHz, for drawing and for finding the loudest point of a curve. */
export const curveFrequencies = (points = 96): number[] => Array.from({ length: points }, (_, i) => 20 * 1000 ** (i / (points - 1)));

/** The curve as dB values at the given frequencies (default: 96 across the audible range). */
export const curveDb = (gains: readonly number[], freqs: readonly number[] = curveFrequencies()): number[] => freqs.map((f) => responseDb(gains, f));

/** The highest point of the curve in dB (0 for a curve that only cuts or is flat). */
export const peakBoostDb = (gains: readonly number[]): number => Math.max(0, ...curveDb(gains, curveFrequencies(192)));

/**
 * The level to take off before the equalizer so its boosts have room.
 *
 * Every boost adds to the level of the music at those frequencies, and music is mastered close to full scale: a +6 dB bass boost on a loud track
 * would be clipped. A boost of up to 2 dB is left to the limiter (it is inaudible there, and best sound's own curve stays at the loudness it was
 * measured at); above that, 60% of the extra is taken off. Never positive, in steps of 0.1 dB.
 */
export function headroomDb(gains: readonly number[]): number {
  const over = Math.max(0, peakBoostDb(gains) - 2);
  return over === 0 ? 0 : -Math.round(over * 0.6 * 10) / 10;
}

/** The linear gain for a headroom in dB. */
export const dbToGain = (db: number): number => 10 ** (db / 20);

/**
 * Where to put band `band` so the curve passes through `targetDb` at that band's own frequency, given the other bands as they are. This is what
 * dragging a dot does: the dot sits on the curve, and the band moves by whatever it takes to bring the curve to the pointer.
 *
 * A peaking band gives its whole gain at its centre, but a shelf gives about half of it at its corner, so this is solved rather than assumed: the
 * band's response grows steadily with its gain, so a search between the limits finds the gain that puts the curve at the pointer. When the pointer is
 * further than the band can reach, the band stops at its limit.
 */
export function gainForTarget(gains: readonly number[], band: number, targetDb: number): number {
  const hz = EQ_BANDS[band]!;
  const others = responseDb(gains.map((g, i) => (i === band ? 0 : g)), hz);
  const wanted = Number.isFinite(targetDb) ? targetDb - others : 0;
  let lo = -EQ_GAIN_LIMIT;
  let hi = EQ_GAIN_LIMIT;
  if (bandResponseDb(band, hi, hz) <= wanted) return hi;
  if (bandResponseDb(band, lo, hz) >= wanted) return lo;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (bandResponseDb(band, mid, hz) < wanted) lo = mid;
    else hi = mid;
  }
  return snapGain((lo + hi) / 2);
}
