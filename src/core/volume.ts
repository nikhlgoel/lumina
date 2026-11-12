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
export function limiterSettings(boostGain: number, protect = false): LimiterSettings {
  // `protect`: something above has added gain (loudness matching, the clarity curve) even though the volume is not boosted: the same wall applies.
  if (boostGain <= 1 && !protect) return { threshold: 0, ratio: 1, knee: 0, attack: 0.003, release: 0.25 };
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

// The last stage of the signal path: a soft ceiling after the limiter.
//
// The limiter is a compressor with a hard ratio, not a true brick wall: measured on loud, bass-heavy music under a boost it let peaks through up to 1.02
// (+0.16 dB over full scale), which the output clips. Whatever it lets through lands on this curve: untouched up to 0.93, bent smoothly (the slope stays 1 at the knee) to 0.974 at full scale,
// and anything beyond held there, so nothing that leaves the player can be over. Below the knee it is the identity, so it changes nothing the limiter did not
// already have to catch.

export const CEILING_KNEE = 0.93;
export const CEILING = 0.979;

/** One point of the ceiling curve: the input in, the output out. Odd-symmetric, monotonic, and never beyond +/-CEILING (about 0.979). */
export function softCeiling(x: number): number {
  if (!Number.isFinite(x)) return 0;
  const a = Math.abs(x);
  if (a <= CEILING_KNEE) return x;
  const room = CEILING - CEILING_KNEE;
  return Math.sign(x) * (CEILING_KNEE + room * Math.tanh((a - CEILING_KNEE) / room));
}

/** The ceiling as a Web Audio WaveShaper curve: inputs from -1 to 1 across `points` samples (inputs beyond that take the end values). */
export function ceilingCurve(points = 2049): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(new ArrayBuffer(points * 4));
  for (let i = 0; i < points; i++) curve[i] = softCeiling((i / (points - 1)) * 2 - 1);
  return curve;
}
