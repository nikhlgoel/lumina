// How a record deck speeds up and slows down.
//
// The vinyl theme used to flip a CSS `animation-play-state` between running and paused, which
// stops a spinning disc dead in one frame. A real platter has inertia: it takes about a second to
// reach speed and coasts for longer after the motor stops. The renderer feeds this a rate in
// 0..1 and multiplies the base rotation speed by it.

/**
 * Seconds-per-turn at full speed. A true 33⅓ rpm record is 1800 ms, which the previous version
 * used and which read as too fast on a large screen: a 500 px disc covers far more screen per
 * second than a real 30 cm record seen across a room. Tuned by eye, not by physics.
 */
export const PLATTER_PERIOD_MS = 2800;

/** Time constants (ms) of the exponential approach to the target speed. */
const SPIN_UP_MS = 800;
const COAST_MS = 1700;

/** Frames longer than this (a hidden tab, a stall) are treated as this long, so speed never jumps. */
const MAX_STEP_MS = 100;

/** Close enough to the target to land on it exactly, so the ramp loop can stop. */
const SETTLED = 0.004;

/**
 * The next speed (0 = stopped, 1 = full) after `dtMs`, heading for full speed when `playing` and
 * for a stop otherwise. Exponential, so it never overshoots and needs no start time.
 */
export function platterRate(current: number, playing: boolean, dtMs: number): number {
  const target = playing ? 1 : 0;
  const from = Number.isFinite(current) ? Math.min(1, Math.max(0, current)) : target;
  const dt = Math.min(MAX_STEP_MS, Math.max(0, Number.isFinite(dtMs) ? dtMs : 0));
  const next = target + (from - target) * Math.exp(-dt / (playing ? SPIN_UP_MS : COAST_MS));
  return Math.abs(next - target) < SETTLED ? target : next;
}
