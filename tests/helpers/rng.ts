// Seeded randomness for property tests. Every property test uses a fixed seed, so a failure is
// reproducible exactly — rerun it and you get the same input that broke.

/** mulberry32: tiny, fast, good enough for test inputs. Returns floats in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

export const pick = <T>(r: () => number, items: readonly T[]): T => items[Math.floor(r() * items.length)]!;

/** A random string drawn from `alphabet`, length in [0, max]. */
export function str(r: () => number, alphabet: string, max: number): string {
  const chars = [...alphabet];
  let out = '';
  const len = int(r, 0, max);
  for (let i = 0; i < len; i++) out += pick(r, chars);
  return out;
}
