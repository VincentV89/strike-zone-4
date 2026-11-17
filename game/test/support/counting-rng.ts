// Counting Rng wrapper (LC-WC-15). Proves the published draw contract: weapons draws exactly
// 3 values per shot and 0 otherwise (BR-W-83). Test-only.
import { createRng, type Rng } from '@sz/kernel';

export interface CountingRng extends Rng {
  /** Number of next(), range() and pick() calls so far; each consumes one draw. */
  readonly draws: number;
}

export function createCountingRng(seed: number): CountingRng {
  const inner = createRng(seed);
  let draws = 0;
  return {
    seed: inner.seed,
    next() {
      draws++;
      return inner.next();
    },
    range(a, b) {
      draws++;
      return inner.range(a, b);
    },
    pick(xs) {
      draws++;
      return inner.pick(xs);
    },
    get draws() {
      return draws;
    },
  };
}
