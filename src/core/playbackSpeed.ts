// Playback speed: the steps the player offers, and how keyboard stepping moves between them.
//
// Kept apart from the UI so the same rules can be tested, and so a TV build can offer the identical
// set without re-deciding it.

/** YouTube's ladder. Below 0.25 speech is unintelligible; above 2 the pitch correction audibly smears. */
export const PLAYBACK_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export const MIN_SPEED = PLAYBACK_SPEEDS[0];
export const MAX_SPEED = PLAYBACK_SPEEDS[PLAYBACK_SPEEDS.length - 1]!;

/** Anything that is not a usable number becomes normal speed; the rest is held inside the ladder. */
export function clampSpeed(rate: unknown): number {
  if (typeof rate !== 'number' || !Number.isFinite(rate)) return 1;
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, rate));
}

export function speedLabel(rate: number): string {
  return rate === 1 ? 'Normal' : `${rate}×`;
}

/**
 * The next step up (`1`) or down (`-1`). A rate that is not on the ladder (a saved value from an
 * older version, say) moves to the nearest step in the direction asked, never past the ends.
 */
export function stepSpeed(current: number, direction: 1 | -1): number {
  const now = clampSpeed(current);
  if (direction === 1) return PLAYBACK_SPEEDS.find((s) => s > now) ?? MAX_SPEED;
  return [...PLAYBACK_SPEEDS].reverse().find((s) => s < now) ?? MIN_SPEED;
}
