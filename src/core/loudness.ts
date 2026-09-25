// Playing every track at the same loudness, without clipping it.
//
// This exists because of a measurement, not a hunch. Asked why Lumina sounded weaker and duller
// than Spotify and YouTube Music at the same volume, six tracks from a real library measured
// between **-8.7 and -14.0 LUFS**, and the loudest of them peaked at **+1.9 dBFS** — above full
// scale.
//
// Two things fall out of that. The tracks are *louder* than Spotify's -14 LUFS target, so quietness
// was never the problem; and a track peaking above full scale clips on playback, which is heard as
// harsh and flat rather than loud. Meanwhile a 5.3 LU spread between tracks means reaching for the
// volume knob between songs.
//
// Streaming services solve both at once: pull everything to a common target, which also pulls the
// peaks back under full scale. That is all this file computes — the gain to apply, and the promise
// that applying it will not clip.

/** What the streaming services settled on, and what people's ears are now used to. */
export const DEFAULT_TARGET_LUFS = -14;

/**
 * Leave the top of the scale alone. Inter-sample peaks can exceed what the samples themselves say,
 * and a decoder's own filtering can add a little more, so stopping a decibel short avoids clipping
 * something that measured as though it just fit.
 */
export const DEFAULT_PEAK_CEILING_DB = -1;

/** Never boost a quiet recording so far that its noise floor comes up with it. */
export const MAX_BOOST_DB = 12;
/** Nor cut so far that a bad measurement leaves something inaudible. */
export const MAX_CUT_DB = -24;

export interface LoudnessMeasurement {
  /** Integrated loudness over the whole track, in LUFS. Negative. */
  integratedLufs: number;
  /** Loudness range, in LU. Null when ffmpeg did not report it. */
  lra: number | null;
  /** Highest true peak, in dBFS. Positive means it already clips. */
  truePeakDbfs: number | null;
}

/**
 * Read ffmpeg's `ebur128` summary.
 *
 * Returns null rather than guessing when the summary is absent — a track that failed to decode must
 * not silently become "0 LUFS", which would turn into a 14 dB cut.
 */
export function parseEbur128(text: string): LoudnessMeasurement | null {
  // Read the LAST occurrence: a file with several audio streams prints one summary per stream, and
  // the final one belongs to the stream that was actually measured.
  const integrated = [...text.matchAll(/^\s*I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/gm)].pop();
  if (!integrated) return null;
  const integratedLufs = Number(integrated[1]);
  if (!Number.isFinite(integratedLufs)) return null;

  const lraMatch = [...text.matchAll(/^\s*LRA:\s*(-?\d+(?:\.\d+)?)\s*LU/gm)].pop();
  const peakMatch = [...text.matchAll(/^\s*Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/gm)].pop();

  const lra = lraMatch ? Number(lraMatch[1]) : null;
  const truePeakDbfs = peakMatch ? Number(peakMatch[1]) : null;

  return {
    integratedLufs,
    lra: lra !== null && Number.isFinite(lra) ? lra : null,
    truePeakDbfs: truePeakDbfs !== null && Number.isFinite(truePeakDbfs) ? truePeakDbfs : null,
  };
}

/** A measurement that says nothing useful — digital silence, or a decode that produced nothing. */
export const isSilent = (m: LoudnessMeasurement): boolean =>
  !Number.isFinite(m.integratedLufs) || m.integratedLufs <= -70;

export interface GainDecision {
  /** Decibels to apply at playback. Positive boosts, negative cuts, 0 leaves it alone. */
  gainDb: number;
  /** Multiplier for a gain node — `10 ** (gainDb / 20)`. */
  gainLinear: number;
  /** True when the peak ceiling, not the loudness target, decided the gain. */
  peakLimited: boolean;
}

/**
 * How much to turn this track up or down.
 *
 * The loudness target sets the wish; the peak ceiling sets the limit. A track already peaking at
 * +1.9 dBFS is asking to be cut anyway, but a *quiet* track with tall peaks must not be boosted all
 * the way to the target, because the boost would push it into clipping — the exact fault this is
 * meant to remove. Where the two disagree, the peak wins.
 */
export function normalizationGain(
  m: LoudnessMeasurement,
  targetLufs: number = DEFAULT_TARGET_LUFS,
  peakCeilingDb: number = DEFAULT_PEAK_CEILING_DB,
): GainDecision {
  if (isSilent(m)) return { gainDb: 0, gainLinear: 1, peakLimited: false };

  const wanted = targetLufs - m.integratedLufs;
  const headroom = m.truePeakDbfs === null ? Infinity : peakCeilingDb - m.truePeakDbfs;

  const peakLimited = headroom < wanted;
  let gainDb = Math.min(wanted, headroom);
  gainDb = Math.max(MAX_CUT_DB, Math.min(MAX_BOOST_DB, gainDb));
  // Below a quarter of a decibel nobody hears the difference; keep the gain node at unity.
  if (Math.abs(gainDb) < 0.25) gainDb = 0;

  return { gainDb, gainLinear: 10 ** (gainDb / 20), peakLimited };
}

/** ffmpeg arguments that measure a file without producing one. */
export function measureArgs(input: string): string[] {
  return ['-hide_banner', '-nostats', '-i', input, '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-'];
}

/** A short phrase for the UI: what normalisation is doing to this track, in plain words. */
export function describeGain(d: GainDecision): string {
  if (d.gainDb === 0) return 'Playing at its own level';
  const amount = `${Math.abs(d.gainDb).toFixed(1)} dB`;
  if (d.gainDb < 0) {
    return d.peakLimited ? `Turned down ${amount} to stop it clipping` : `Turned down ${amount} to match everything else`;
  }
  return `Turned up ${amount} to match everything else`;
}
