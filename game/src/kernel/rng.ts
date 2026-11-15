import type { Rng } from './types';

const UINT32_RANGE = 4294967296;

/**
 * Seeded mulberry32 generator (BR-K-30 to BR-K-33). 32-bit integer arithmetic
 * through Math.imul only, so every JS engine yields the same sequence.
 *
 * Not a CSPRNG. Never use it for a security decision (residual risk R2).
 */
export function createRng(seed: number): Rng {
  const normalised = Number.isFinite(seed) ? seed >>> 0 : 0;
  let state = normalised;

  function next(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE;
  }

  function range(a: number, b: number): number {
    const aFinite = Number.isFinite(a);
    const bFinite = Number.isFinite(b);
    if (!aFinite && !bFinite) return 0;
    if (!aFinite) return b;
    if (!bFinite) return a;
    if (a === b) return a;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    return lo + next() * (hi - lo);
  }

  function pick<T>(xs: ReadonlyArray<T>): T | undefined {
    if (xs.length === 0) return undefined;
    return xs[Math.floor(next() * xs.length)];
  }

  return { seed: normalised, next, range, pick };
}
