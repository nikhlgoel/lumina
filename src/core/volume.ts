// Volume above 100%, without the distortion that usually comes with it.
//
// `HTMLMediaElement.volume` is defined as 0..1 and silently clamps anything above it, so a louder
// setting is impossible through the element alone. Past 100% the element is left at unity and the
// extra is applied as gain on the Web Audio graph, which has no such ceiling.
//
// Gain on its own is the naive version of this, and it is why "volume boost" has a bad name: a track
// already peaking near full scale simply clips, and clipping is heard as harsh rather than loud —
// the same fault D14 found in the library's own masters. So the boost is followed by a limiter, and
// the limiter is engaged *only* while boosting, so nothing is coloured at normal volumes.
//
// The loudness work makes the boost mostly free: normalised material sits around -14 LUFS with
// roughly 13 dB of headroom under full scale, so doubling it is comfortably inside what the limiter
// can hold. See D18.

/** The loudest the player will go: double, i.e. +6 dB. */
export const MAX_VOLUME = 2;

/** The volumes offered as one-click choices, loudest first. */
export const VOLUME_PRESETS = [MAX_VOLUME, 1.5, 1, 0.75, 0.5, 0.25, 0.1] as const;

export const clampVolume = (v: number): number =>
  (Number.isFinite(v) ? Math.max(0, Math.min(MAX_VOLUME, v)) : 1);

export interface VolumeSplit {
  /** What to put on the media element — never above 1, because the element refuses anything more. */
  elementVolume: number;
  /** What the boost gain node multiplies by. 1 means "not boosting", and the limiter stays out. */
  boostGain: number;
}

/**
 * Split a volume setting between the media element and the graph.
 *
 * Everything up to 100% stays on the element, so a listener who never goes above it is using the
 * plain audio path with nothing of ours in it at all.
 */
export function volumeSplit(volume: number): VolumeSplit {
  const v = clampVolume(volume);
  if (v <= 1) return { elementVolume: v, boostGain: 1 };
  return { elementVolume: 1, boostGain: v };
}

export interface LimiterSettings {
  /** dBFS at which the limiter starts holding the signal back. */
  threshold: number;
  ratio: number;
  knee: number;
  attack: number;
  release: number;
}

/**
 * How the limiter should be set for a given boost.
 *
 * At or below unity it is configured to do nothing at all — ratio 1 passes the signal through
 * untouched — rather than being disconnected, because rewiring a live graph clicks.
 *
 * While boosting it is a brick wall just under full scale: a hard ratio, no knee, and an attack
 * fast enough to catch a transient. The release is slow enough not to pump audibly on music.
 */
export function limiterSettings(boostGain: number): LimiterSettings {
  if (boostGain <= 1) return { threshold: 0, ratio: 1, knee: 0, attack: 0.003, release: 0.25 };
  return { threshold: -1.5, ratio: 20, knee: 0, attack: 0.003, release: 0.25 };
}

/** True when the signal is being pushed past unity, so the UI can say the boost is on. */
export const isBoosting = (volume: number): boolean => clampVolume(volume) > 1;

/** "100%", "170%" — whole percent, because that is the only precision a slider affords. */
export const volumePercent = (volume: number): number => Math.round(clampVolume(volume) * 100);

export const volumeLabel = (volume: number): string => `${volumePercent(volume)}%`;

/**
 * A relative change as a person expects it: from the volume they had (even when muted — the player
 * unmutes on any volume change), kept inside the range, and rounded to whole percent so repeated
 * steps land on round numbers instead of drifting.
 */
export const nextVolume = (current: number, delta: number): number =>
  Math.round(clampVolume(current + delta) * 100) / 100;
