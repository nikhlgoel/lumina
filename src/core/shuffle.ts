// Shuffle that behaves the way people expect shuffle to behave.
//
// What was here before picked a random *other* track on every advance. Two things follow from that,
// and both were wrong:
//
//  * The same song can come round again after two tracks while others never play at all. That is a
//    dice roll, not a shuffle — a shuffle is a permutation, and it plays everything once before it
//    plays anything twice.
//  * Pressing Previous moved *forward*, because the random branch ignored the direction entirely.
//    Nothing recorded what had played, so there was nothing to go back to.
//
// So the order is decided up front and kept: `order` is the sequence of queue indices, `cursor` is
// where in it we are. Going back is simply a smaller cursor, which is what makes Previous mean
// "the track I actually just heard" rather than "some other track". See D16.

export interface ShuffleState {
  /** Queue indices in the order they will play. Every index appears exactly once. */
  order: number[];
  /** Position within `order` of the track playing now. */
  cursor: number;
}

/** Fisher–Yates. `random` is injectable so the tests are not at the mercy of chance. */
function permute(length: number, random: () => number): number[] {
  const a = Array.from({ length }, (_, i) => i);
  for (let i = length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * Shuffle a queue of `length` tracks, with `startAt` first.
 *
 * The track already playing stays where it is: turning shuffle on should change what comes next,
 * not interrupt what is on.
 */
export function createShuffle(length: number, startAt: number, random: () => number = Math.random): ShuffleState {
  if (length <= 0) return { order: [], cursor: 0 };
  const order = permute(length, random);
  const at = order.indexOf(startAt);
  if (at > 0) [order[0], order[at]] = [order[at]!, order[0]!];
  return { order, cursor: 0 };
}

/**
 * Re-point the cursor after the listener picked a track by hand.
 *
 * Without this, choosing a track from the queue would leave the cursor where it was, and the next
 * advance would jump somewhere with no relation to what is playing.
 */
export function syncShuffle(s: ShuffleState, index: number): ShuffleState {
  const at = s.order.indexOf(index);
  return at < 0 ? s : { ...s, cursor: at };
}

/** True when the shuffle still describes this queue; a changed length has to be rebuilt. */
export const shuffleMatches = (s: ShuffleState, length: number): boolean => s.order.length === length;

export interface ShuffleStep {
  state: ShuffleState;
  index: number;
}

/**
 * Move one track forward or back.
 *
 * Returns null when there is nowhere to go: the end of the order with wrapping not allowed (repeat
 * is off and the track ran out on its own), or the start of what has been played. Going back before
 * the first track of a shuffle is not a thing that can be done — there is no earlier track to
 * return to, and inventing a random one is the bug this replaces.
 */
export function stepShuffle(
  s: ShuffleState,
  step: 1 | -1,
  opts: { allowWrap: boolean; random?: () => number } = { allowWrap: true },
): ShuffleStep | null {
  if (!s.order.length) return null;
  const next = s.cursor + step;

  if (next < 0) return null;

  if (next >= s.order.length) {
    if (!opts.allowWrap) return null;
    // A fresh pass. Reshuffling rather than replaying the same order is the point of shuffle, but
    // the track that just played must not open the next round — that is the one repeat a listener
    // notices immediately.
    const last = s.order[s.order.length - 1]!;
    const random = opts.random ?? Math.random;
    const order = permute(s.order.length, random);
    if (order.length > 1 && order[0] === last) [order[0], order[1]] = [order[1]!, order[0]!];
    return { state: { order, cursor: 0 }, index: order[0]! };
  }

  return { state: { ...s, cursor: next }, index: s.order[next]! };
}
