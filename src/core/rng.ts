// Deterministic pseudo-random numbers for the pure core.
//
// The tutor state carries a numeric `seed`; every transition that needs
// randomness derives an Rng from it and stores a fresh seed back into the
// state, so the whole session is reproducible and serialisable.

/** A pseudo-random number generator: each call returns a float in [0, 1). */
export type Rng = () => number;

/** mulberry32 — small, fast, good-enough PRNG over a 32-bit seed. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draw a fresh 32-bit seed from an Rng (to store back into state). */
export function drawSeed(rng: Rng): number {
  return Math.floor(rng() * 4294967296) >>> 0;
}

/** Uniform random pick. Returns undefined only for an empty list. */
export function choice<T>(items: readonly T[], rng: Rng): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(rng() * items.length)];
}
