/**
 * Test-only helpers. Not exported from the package's public index.
 */

import type { RNG } from '@cardadda/engine';

/**
 * mulberry32 — a tiny, fast, deterministic PRNG. Seeded so every test run deals
 * identical cards. Same generator used by the Callbreak engine's tests, so
 * results are reproducible the same way across both games.
 */
export function mulberry32(seed: number): RNG {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
