/**
 * Single seeded PRNG source for the whole sim. Every random decision anywhere
 * in the sim core must draw from an Rng instance threaded through World —
 * never Math.random() — so a given seed + inputs always replays identically.
 */
export interface Rng {
  /** Next float in [0, 1). */
  next(): number;
  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  /** Uniformly pick one element of a non-empty array. */
  pick<T>(arr: readonly T[]): T;
  /** Fisher-Yates shuffle, returns a new array, does not mutate input. */
  shuffle<T>(arr: readonly T[]): T[];
  /** Sample up to n distinct elements without replacement. */
  sample<T>(arr: readonly T[], n: number): T[];
}

/** mulberry32: small, fast, deterministic 32-bit PRNG. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  function nextUint32(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  }

  const next = () => nextUint32() / 4294967296;

  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));

  const chance = (p: number) => next() < p;

  const pick = <T,>(arr: readonly T[]): T => {
    if (arr.length === 0) throw new Error("pick: empty array");
    return arr[int(0, arr.length - 1)] as T;
  };

  const shuffle = <T,>(arr: readonly T[]): T[] => {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(0, i);
      const tmp = out[i]!;
      out[i] = out[j]!;
      out[j] = tmp;
    }
    return out;
  };

  const sample = <T,>(arr: readonly T[], n: number): T[] => shuffle(arr).slice(0, Math.max(0, n));

  return { next, int, chance, pick, shuffle, sample };
}
