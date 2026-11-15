import { describe, expect, it } from 'vitest';
import { createRng } from '@sz/kernel';

// Golden values: first five outputs of the canonical mulberry32, computed independently of
// src/kernel/rng.ts at code generation (BR-K-31, REL-K-02). A change here breaks the
// reproducibility of AI and difficulty tests in other units.
const GOLDEN: Record<number, number[]> = {
  0: [
    0.26642920868471265, 0.0003297457005828619, 0.2232720274478197, 0.1462021479383111,
    0.46732782293111086,
  ],
  1: [
    0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741,
    0.9683778982143849,
  ],
  42: [
    0.6011037519201636, 0.44829055899754167, 0.8524657934904099, 0.6697340414393693,
    0.17481389874592423,
  ],
};

function take(seed: number, n: number): number[] {
  const rng = createRng(seed);
  return Array.from({ length: n }, () => rng.next());
}

describe('Rng (mulberry32, BR-K-30 to BR-K-33)', () => {
  it.each([0, 1, 42])('BR-K-31: seed %i matches the pinned golden values', (seed) => {
    expect(take(seed, 5)).toEqual(GOLDEN[seed]);
  });

  it('S8: the same seed gives the same sequence', () => {
    expect(take(1234, 100)).toEqual(take(1234, 100));
    expect(take(1234, 10)).not.toEqual(take(1235, 10));
  });

  it('BR-K-31: next() is always in [0, 1)', () => {
    const xs = take(7, 10_000);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it('BR-K-30: normalises the seed with >>> 0; non-finite seeds become 0', () => {
    expect(createRng(-1).seed).toBe(4294967295);
    expect(createRng(2 ** 32 + 5).seed).toBe(5);
    expect(createRng(3.9).seed).toBe(3);
    expect(createRng(Number.NaN).seed).toBe(0);
    expect(createRng(Infinity).seed).toBe(0);
    expect(take(Number.NaN, 5)).toEqual(GOLDEN[0]);
  });

  it('BR-K-32: range(a, b) is in [min, max), swaps bounds, and returns a when a === b', () => {
    const rng = createRng(9);
    for (let i = 0; i < 1000; i++) {
      const v = rng.range(5, -5);
      expect(v).toBeGreaterThanOrEqual(-5);
      expect(v).toBeLessThan(5);
    }
    expect(rng.range(3, 3)).toBe(3);
  });

  it('BR-K-32: a non-finite bound returns the finite one and consumes no draw', () => {
    const a = createRng(42);
    expect(a.range(Number.NaN, 2)).toBe(2);
    expect(a.range(1, Infinity)).toBe(1);
    expect(a.range(Number.NaN, -Infinity)).toBe(0);
    expect(a.range(4, 4)).toBe(4);
    expect(a.next()).toBe(GOLDEN[42]?.[0]);
  });

  it('BR-K-33: pick([]) returns undefined with no draw; a non-empty pick draws exactly once', () => {
    const rng = createRng(42);
    expect(rng.pick<string>([])).toBeUndefined();
    const xs = ['a', 'b', 'c', 'd'];
    // First draw for seed 42 is 0.601… → index 2.
    expect(rng.pick(xs)).toBe('c');
    expect(rng.next()).toBe(GOLDEN[42]?.[1]);
  });

  it('pick covers every element over many draws', () => {
    const rng = createRng(5);
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) seen.add(rng.pick([0, 1, 2, 3, 4]) ?? -1);
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4]);
  });
});
