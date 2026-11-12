// "Best sound": what Lumina does by default so music and video sound clear and a little louder than usual, without distorting.
//
// Three things work together, and each is there for a measured reason (see core/loudness.ts, core/volume.ts):
//   1. Loudness matching to a target a little above the streaming services' -14 LUFS (-12), so Lumina is not the quiet one, but not the -8 of an over-compressed
//      master either. A quiet recording is lifted only as far as its own peaks allow, so lifting it cannot clip it.
//   2. A gentle clarity curve: a touch of warmth underneath, a small cut where recordings get muddy, and a little presence and air above. Small on purpose: it
//      makes dull sources clearer without making good ones sound processed. The equalizer still wins: choosing a profile of your own replaces it.
//   3. A limiter just under full scale that is on whenever anything above has added gain (matching, the curve or the volume boost), so extra loudness can
//      never become the harsh sound of clipping.
// All of it is switched off by one setting, and a person's own equalizer choice is never layered under it.

import { EQ_BANDS, headroomDb, peakBoostDb, profileById } from './equalizer';

/** The quietest target "best sound" will use: -12 LUFS. A person's own louder target (say -9) is left alone. */
export const BEST_SOUND_TARGET_LUFS = -12;

/** The clarity curve: warmth underneath, less mud, a little body, presence and air. It is also the "Clarity" preset, so there is one set of numbers. */
export const CLARITY_GAINS: readonly number[] = profileById('clarity')?.gains ?? EQ_BANDS.map(() => 0);

const FLAT: readonly number[] = EQ_BANDS.map(() => 0);

/** The loudness target to match: raised to -12 LUFS when best sound is on, never lowered. */
export function effectiveLoudnessTarget(bestSound: boolean, target: number): number {
  const t = Number.isFinite(target) ? target : BEST_SOUND_TARGET_LUFS;
  return bestSound ? Math.max(t, BEST_SOUND_TARGET_LUFS) : t;
}

/**
 * The equalizer curve to apply. The person's own equalizer, when they switched it on, is used as it is; otherwise best sound's clarity curve; otherwise flat.
 * `userGains` are the gains of whichever profile or custom curve they chose.
 */
export function effectiveEq(bestSound: boolean, eqEnabled: boolean, userGains: readonly number[]): number[] {
  if (eqEnabled) return EQ_BANDS.map((_, i) => userGains[i] ?? 0);
  return [...(bestSound ? CLARITY_GAINS : FLAT)];
}

/**
 * Whether the limiter should be on: whenever best sound is on, or anything has added gain (matching above unity, the volume boost, or an equalizer
 * curve that lifts anything). The last one used to be missing: a bass boost on a loud track clipped with best sound off.
 */
export function needsLimiter(state: { bestSound: boolean; trackGain: number; boostGain: number; eqPeakDb?: number }): boolean {
  return state.bestSound || state.trackGain > 1 || state.boostGain > 1 || (state.eqPeakDb ?? 0) > 0.05;
}

/** What the equalizer stage needs: the curve, the level to take off before it, and how high it lifts. */
export function eqPlan(bestSound: boolean, eqEnabled: boolean, userGains: readonly number[]): { gains: number[]; headroomDb: number; peakDb: number } {
  const gains = effectiveEq(bestSound, eqEnabled, userGains);
  return { gains, headroomDb: headroomDb(gains), peakDb: peakBoostDb(gains) };
}

/** True when a curve changes nothing, so the audio graph need not be built for it. */
export const isFlat = (gains: readonly number[]): boolean => gains.every((g) => g === 0);
