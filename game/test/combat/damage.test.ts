import { describe, expect, it } from 'vitest';
import { createRng } from '@sz/kernel';
import {
  ARMOR_ABSORB_RATIO,
  BOT_START_VITALS,
  PLAYER_START_VITALS,
  applyDamage,
  createVitals,
  type Vitals,
} from '@sz/combat';

describe('applyDamage reference cases (BR-C-14, req-damage-model)', () => {
  it.each([
    [100, 100, 40, 80, 80, 20, 20, false],
    [100, 10, 40, 70, 0, 30, 10, false],
    [100, 0, 40, 60, 0, 40, 0, false],
    [30, 0, 112, 0, 0, 30, 0, true],
    [0, 0, 28, 0, 0, 0, 0, false],
  ])(
    '(%i hp, %i armor, %i raw) → (%i, %i), lost %i / %i, killed %s',
    (health, armor, raw, h, a, healthLost, armorLost, killed) => {
      expect(applyDamage({ health, armor }, raw)).toEqual({
        vitals: { health: h, armor: a },
        healthLost,
        armorLost,
        killed,
      });
    },
  );

  it('ARMOR_ABSORB_RATIO is one half', () => {
    expect(ARMOR_ABSORB_RATIO).toBe(0.5);
  });

  it('a rifle body hit on the player costs 14 health and 14 armor; the 8th kills', () => {
    let v: Vitals = PLAYER_START_VITALS;
    const kills: boolean[] = [];
    for (let i = 0; i < 8; i++) {
      const out = applyDamage(v, 28);
      kills.push(out.killed);
      v = out.vitals;
      if (i === 0) expect(out).toMatchObject({ healthLost: 14, armorLost: 14 });
      if (i === 5) expect(v).toEqual({ health: 16, armor: 16 });
      if (i === 6) expect(v).toEqual({ health: 2, armor: 2 });
    }
    expect(kills).toEqual([false, false, false, false, false, false, false, true]);
  });

  it('BR-C-13: death fires exactly once; later hits change nothing', () => {
    let v: Vitals = BOT_START_VITALS;
    let kills = 0;
    for (let i = 0; i < 10; i++) {
      const out = applyDamage(v, 28);
      if (out.killed) kills++;
      v = out.vitals;
    }
    expect(kills).toBe(1);
    expect(v).toEqual({ health: 0, armor: 0 });
  });

  it('BR-C-11: non-integer raw rounds; negative, NaN and ±Infinity count as 0', () => {
    expect(applyDamage({ health: 100, armor: 0 }, 27.6).vitals.health).toBe(72);
    for (const raw of [-5, NaN, Infinity, -Infinity, 0, 0.4]) {
      expect(applyDamage({ health: 100, armor: 50 }, raw)).toEqual({
        vitals: { health: 100, armor: 50 },
        healthLost: 0,
        armorLost: 0,
        killed: false,
      });
    }
  });

  it('hostile vitals are normalised before use', () => {
    expect(applyDamage({ health: NaN, armor: 5 }, 10).vitals).toEqual({ health: 0, armor: 5 });
    expect(applyDamage({ health: 50.4, armor: -3 }, 10).vitals).toEqual({ health: 40, armor: 0 });
  });

  it('SEC-WC-05: 10 000 seeded hostile cases keep every field a non-negative safe integer', () => {
    const rng = createRng(77);
    const pool = [NaN, Infinity, -Infinity, -1, 0, 1e308, Number.MAX_SAFE_INTEGER * 4, 0.5];
    const pick = () => (rng.next() < 0.2 ? rng.pick(pool)! : rng.range(-50, 400));
    for (let i = 0; i < 10_000; i++) {
      const out = applyDamage({ health: pick(), armor: pick() }, pick());
      const fields = [out.vitals.health, out.vitals.armor, out.healthLost, out.armorLost];
      for (const f of fields) {
        expect(Number.isSafeInteger(f)).toBe(true);
        expect(f).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('createVitals (BR-C-15)', () => {
  it('defaults to 100 health and 0 armor', () => {
    expect(createVitals()).toEqual({ health: 100, armor: 0 });
  });

  it('player starts at 100 / 100 and every bot at 100 / 0', () => {
    expect(PLAYER_START_VITALS).toEqual(createVitals(100, 100));
    expect(BOT_START_VITALS).toEqual(createVitals(100, 0));
  });

  it.each([
    [99.6, 10.2, 100, 10],
    [-1, NaN, 0, 0],
    [Infinity, -Infinity, 0, 0],
  ])('createVitals(%s, %s) → (%i, %i)', (h, a, health, armor) => {
    expect(createVitals(h, a)).toEqual({ health, armor });
  });
});
