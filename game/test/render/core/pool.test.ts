// BR-R-09, PD-R-5: fixed rings, oldest stolen at cap, nothing allocated.
import { acquire, advance, clearPool, createPool, setCap } from '@sz/render/core/pool';
import { describe, expect, it } from 'vitest';

describe('effect pool', () => {
  it('steals the oldest live slot at cap and never grows', () => {
    const pool = createPool(4);
    const ids = new Set(pool.slots);
    const first = acquire(pool, 0, 10);
    for (let i = 1; i < 4; i++) acquire(pool, i, 10);
    expect(pool.live).toBe(4);
    const fifth = acquire(pool, 5, 10);
    expect(fifth).toBe(first);
    expect(pool.live).toBe(4);
    expect(pool.slots).toHaveLength(4);
    for (const s of pool.slots) expect(ids.has(s)).toBe(true);
  });

  it('lowering the cap retires the oldest; raising it allocates nothing', () => {
    const pool = createPool(6);
    for (let i = 0; i < 6; i++) acquire(pool, i, 10);
    setCap(pool, 2);
    expect(pool.live).toBe(2);
    const live = pool.slots.filter((s) => s.live).map((s) => s.start);
    expect(live).toEqual([4, 5]);
    setCap(pool, 100);
    expect(pool.cap).toBe(6);
    setCap(pool, Number.NaN);
    expect(pool.cap).toBe(6);
    expect(pool.slots).toHaveLength(6);
  });

  it('expires finished effects; infinite ones stay until stolen', () => {
    const pool = createPool(3);
    acquire(pool, 0, 0.5);
    acquire(pool, 0, Number.POSITIVE_INFINITY);
    advance(pool, 1);
    expect(pool.live).toBe(1);
    clearPool(pool);
    expect(pool.live).toBe(0);
    expect(pool.slots.some((s) => s.live)).toBe(false);
  });

  it('a capacity below 1 still yields a usable pool', () => {
    const pool = createPool(0);
    expect(pool.capacity).toBe(1);
    expect(acquire(pool, 0, 1)).toBe(pool.first);
    expect(acquire(pool, 1, 1)).toBe(pool.first);
  });
});
