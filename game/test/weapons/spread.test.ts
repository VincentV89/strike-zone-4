import { describe, expect, it } from 'vitest';
import { angleBetween, createRng, degToRad, length, normalize, vec3, type Vec3 } from '@sz/kernel';
import { WEAPON_TABLE, createInventory, currentSpread, sampleCone } from '@sz/weapons';
import { createCountingRng } from '../support/counting-rng';

const DIRS: Vec3[] = [
  vec3(0, 0, -1),
  vec3(1, 0, 0),
  normalize(vec3(0.3, -0.4, 0.8)),
  vec3(0, 1, 0), // straight up uses the X helper axis
  vec3(0, -1, 0),
];

describe('sampleCone (business-logic-model spread cone sampling)', () => {
  it.each(DIRS)('stays inside the cone and returns unit vectors around %j', (d) => {
    const rng = createRng(11);
    const s = degToRad(3);
    for (let i = 0; i < 10_000; i++) {
      const out = sampleCone(d, s, rng);
      expect(angleBetween(d, out)).toBeLessThanOrEqual(s + 1e-9);
      expect(length(out)).toBeCloseTo(1, 12);
    }
  });

  it('s = 0 returns d exactly, still drawing two values (BR-W-83)', () => {
    const rng = createCountingRng(5);
    const d = DIRS[2]!;
    expect(sampleCone(d, 0, rng)).toBe(d);
    expect(rng.draws).toBe(2);
    expect(sampleCone(d, NaN, rng)).toBe(d);
    expect(rng.draws).toBe(4);
  });

  it('draws exactly two values for a non-zero spread', () => {
    const rng = createCountingRng(5);
    sampleCone(DIRS[0]!, 0.05, rng);
    expect(rng.draws).toBe(2);
  });

  it('the same seed gives the same directions (req-recoil-spread determinism)', () => {
    const run = (seed: number) => {
      const rng = createRng(seed);
      return Array.from({ length: 50 }, () => sampleCone(DIRS[0]!, 0.05, rng));
    };
    expect(run(99)).toEqual(run(99));
    expect(run(99)).not.toEqual(run(100));
  });

  it('a wider cone gives a larger mean deviation over 10 000 samples', () => {
    const mean = (s: number) => {
      const rng = createRng(3);
      let sum = 0;
      for (let i = 0; i < 10_000; i++) sum += angleBetween(DIRS[0]!, sampleCone(DIRS[0]!, s, rng));
      return sum / 10_000;
    };
    const still = mean(WEAPON_TABLE.rifle.spreadBase);
    const moving = mean(WEAPON_TABLE.rifle.spreadBase + WEAPON_TABLE.rifle.spreadMovePenalty);
    expect(moving).toBeGreaterThan(still);
  });
});

describe('currentSpread (BR-W-61, BR-W-82)', () => {
  const { rifle, sniper } = WEAPON_TABLE;

  it('base spread from rest', () => {
    expect(currentSpread(createInventory(), rifle, false)).toBe(rifle.spreadBase);
  });

  it('moving is wider than still at every bloom level', () => {
    const inv = createInventory();
    for (let b = 0; b <= rifle.bloomMax + 1e-12; b += rifle.bloomPerShot) {
      inv.bloom = b;
      expect(currentSpread(inv, rifle, true)).toBeGreaterThan(currentSpread(inv, rifle, false));
    }
  });

  it('is capped at spreadMax', () => {
    const inv = createInventory();
    inv.bloom = 1;
    expect(currentSpread(inv, rifle, true)).toBe(rifle.spreadMax);
  });

  it('scoped spread replaces the base only for a weapon with a scope', () => {
    const inv = createInventory();
    inv.scoped = true;
    expect(currentSpread(inv, sniper, false)).toBe(sniper.spreadScoped);
    expect(currentSpread(inv, rifle, false)).toBe(rifle.spreadBase);
    inv.scoped = false;
    expect(currentSpread(inv, sniper, false)).toBe(sniper.spreadBase);
  });
});
