/** Seeded PRNG (mulberry32). The fuzzer's only source of randomness. */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [0, bound). */
  int(bound: number): number;
  pick<T>(items: ReadonlyArray<T>): T | undefined;
  chance(probability: number): boolean;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  }
  function int(bound: number): number {
    return Math.floor(next() * bound);
  }
  return {
    next,
    int,
    pick: (items) => items[int(items.length)],
    chance: (probability) => next() < probability,
  };
}
