import { describe, it, expect } from 'vitest';
import { createShuffle, shuffleMatches, stepShuffle, syncShuffle, type ShuffleState } from '@core/shuffle';

/** A deterministic stand-in for Math.random, so a failing test means a bug and not bad luck. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Walk forward `n` times, collecting the tracks that play. */
function playForward(start: ShuffleState, n: number, allowWrap = true, random = seeded(7)): number[] {
  let state = start;
  const played: number[] = [];
  for (let i = 0; i < n; i++) {
    const step = stepShuffle(state, 1, { allowWrap, random });
    if (!step) break;
    state = step.state;
    played.push(step.index);
  }
  return played;
}

describe('a shuffle is a permutation, not a dice roll', () => {
  it('plays every track once before it plays any track twice', () => {
    const s = createShuffle(50, 0, seeded(1));
    const played = [0, ...playForward(s, 49)];
    expect(played).toHaveLength(50);
    expect(new Set(played).size).toBe(50);
  });

  it('leaves the track already playing where it is', () => {
    // Turning shuffle on mid-song must change what comes next, not interrupt what is on.
    for (const start of [0, 7, 49]) {
      expect(createShuffle(50, start, seeded(start + 1)).order[0]).toBe(start);
    }
  });

  it('really does reorder — it is not the queue back in its own order', () => {
    const { order } = createShuffle(50, 0, seeded(3));
    expect(order).not.toEqual(Array.from({ length: 50 }, (_, i) => i));
  });

  it('copes with a queue of one, and with no queue at all', () => {
    expect(createShuffle(1, 0, seeded(1))).toEqual({ order: [0], cursor: 0 });
    expect(createShuffle(0, 0, seeded(1))).toEqual({ order: [], cursor: 0 });
    expect(stepShuffle({ order: [], cursor: 0 }, 1)).toBeNull();
  });
});

describe('Previous means the track that actually just played', () => {
  it('goes back to what was heard, not forward to something random', () => {
    // The old behaviour ignored the direction entirely and moved forward on Previous.
    const s = createShuffle(20, 0, seeded(11));
    const first = stepShuffle(s, 1, { allowWrap: true, random: seeded(2) })!;
    const second = stepShuffle(first.state, 1, { allowWrap: true, random: seeded(2) })!;
    const back = stepShuffle(second.state, -1)!;
    expect(back.index).toBe(first.index);
    expect(stepShuffle(back.state, -1)!.index).toBe(s.order[0]);
  });

  it('refuses to go back before the first track played', () => {
    expect(stepShuffle(createShuffle(20, 0, seeded(5)), -1)).toBeNull();
  });

  it('retraces the whole way back', () => {
    const s = createShuffle(10, 0, seeded(9));
    let state = s;
    const forward: number[] = [];
    for (let i = 0; i < 9; i++) {
      const step = stepShuffle(state, 1, { allowWrap: false })!;
      state = step.state;
      forward.push(step.index);
    }
    const backward: number[] = [];
    for (let i = 0; i < 9; i++) {
      const step = stepShuffle(state, -1);
      if (!step) break;
      state = step.state;
      backward.push(step.index);
    }
    expect(backward).toEqual([...forward].reverse().slice(1).concat(s.order[0]!));
  });
});

describe('reaching the end', () => {
  it('stops when a queue runs out on its own and repeat is off', () => {
    const s = createShuffle(3, 0, seeded(4));
    let state = s;
    for (let i = 0; i < 2; i++) state = stepShuffle(state, 1, { allowWrap: false })!.state;
    expect(stepShuffle(state, 1, { allowWrap: false })).toBeNull();
  });

  it('deals a fresh order when it wraps, rather than repeating the same one', () => {
    const s = createShuffle(8, 0, seeded(13));
    let state = s;
    for (let i = 0; i < 7; i++) state = stepShuffle(state, 1, { allowWrap: false })!.state;
    const wrapped = stepShuffle(state, 1, { allowWrap: true, random: seeded(21) })!;
    expect(wrapped.state.cursor).toBe(0);
    expect(wrapped.state.order).toHaveLength(8);
    expect(new Set(wrapped.state.order).size).toBe(8);
    expect(wrapped.state.order).not.toEqual(s.order);
  });

  it('never opens a new round with the song that just finished', () => {
    // The one repeat a listener notices immediately: the same track twice across the seam.
    for (let seed = 1; seed <= 40; seed++) {
      const s = createShuffle(6, 0, seeded(seed));
      let state = s;
      for (let i = 0; i < 5; i++) state = stepShuffle(state, 1, { allowWrap: false })!.state;
      const lastPlayed = state.order[state.order.length - 1];
      const wrapped = stepShuffle(state, 1, { allowWrap: true, random: seeded(seed * 31) })!;
      expect(wrapped.index, `seed ${seed}`).not.toBe(lastPlayed);
    }
  });
});

describe('picking a track by hand', () => {
  it('carries on from what was chosen', () => {
    const s = createShuffle(12, 0, seeded(6));
    const chosen = s.order[9]!;
    const synced = syncShuffle(s, chosen);
    expect(synced.cursor).toBe(9);
    expect(stepShuffle(synced, 1, { allowWrap: false })!.index).toBe(s.order[10]);
    expect(stepShuffle(synced, -1)!.index).toBe(s.order[8]);
  });

  it('leaves the cursor alone for a track that is not in this queue', () => {
    const s = createShuffle(5, 0, seeded(8));
    expect(syncShuffle(s, 99)).toEqual(s);
  });
});

describe('knowing when to start over', () => {
  it('spots a queue that changed length', () => {
    const s = createShuffle(5, 0, seeded(2));
    expect(shuffleMatches(s, 5)).toBe(true);
    expect(shuffleMatches(s, 6)).toBe(false);
  });
});
