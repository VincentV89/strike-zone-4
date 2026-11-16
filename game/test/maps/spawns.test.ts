// Spawn selection (story-valid-spawns, BR-WM-27 to BR-WM-30, SD-WM-2, SD-WM-12).
import { describe, expect, it } from 'vitest';
import { createRng, type BotCount, type Rng, type Vec3 } from '@sz/kernel';
import { SPAWN_RULES, desertCompound, selectSpawns } from '@sz/maps';
import { createBoxWorldQuery } from '../support/box-world-query';
import { fixtureMap } from './fixture-map';

function countingRng(seed: number): Rng & { draws: number } {
  const inner = createRng(seed);
  const r = {
    seed: inner.seed,
    draws: 0,
    next: () => {
      r.draws++;
      return inner.next();
    },
    range: (a: number, b: number) => {
      r.draws++;
      return inner.range(a, b);
    },
    pick: <T>(xs: ReadonlyArray<T>) => {
      r.draws++;
      return inner.pick(xs);
    },
  };
  return r;
}

const neverSees = () => false;
const desertLos = createBoxWorldQuery(desertCompound);
const los = (a: Vec3, b: Vec3) => desertLos.lineOfSight(a, b);

describe('selectSpawns', () => {
  it('BR-WM-27: returns exactly botCount bots for every allowed count', () => {
    for (const n of [1, 2, 3, 5, 8, 10, 15, 20] as const) {
      const plan = selectSpawns(desertCompound, n, createRng(n), los);
      expect(plan.ok && plan.value.bots.length).toBe(n);
    }
  });

  it('BR-WM-28/29: spacing ≥ 1.5 m, ≥ 20 m from the player, no line of sight (seeds 1..50)', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const plan = selectSpawns(desertCompound, 20, createRng(seed), los);
      if (!plan.ok) throw new Error(`seed ${String(seed)}: ${plan.error}`);
      const { player, bots } = plan.value;
      for (const [i, b] of bots.entries()) {
        expect(Math.hypot(b.pos.x - player.pos.x, b.pos.z - player.pos.z)).toBeGreaterThanOrEqual(
          20,
        );
        for (const c of bots.slice(i + 1)) {
          expect(Math.hypot(b.pos.x - c.pos.x, b.pos.z - c.pos.z)).toBeGreaterThanOrEqual(
            SPAWN_RULES.minBotSpacing,
          );
        }
      }
      expect(new Set(bots.map((b) => b.id)).size).toBe(20);
    }
  });

  it('spreads bots round-robin across areas', () => {
    const plan = selectSpawns(desertCompound, 3, createRng(5), neverSees);
    expect(plan.ok && new Set(plan.value.bots.map((b) => b.area)).size).toBe(3);
  });

  it('BR-WM-29: drops bot spawns the player can see, at eye or chest height', () => {
    const map = fixtureMap();
    const seenX = new Set(map.botSpawns.slice(0, 6).map((s) => s.pos.x));
    const seesSome = (_a: Vec3, b: Vec3) =>
      b.z === -40 && seenX.has(b.x) && Math.abs(b.y - 1.2) < 1e-9;
    const plan = selectSpawns(map, 15, createRng(1), seesSome);
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.value.bots.some((b) => seenX.has(b.pos.x))).toBe(false);
    expect(selectSpawns(map, 20, createRng(1), seesSome)).toEqual({
      ok: false,
      error: 'insufficient-spawns',
    });
  });

  it('BR-WM-27: never a partial plan; insufficient-spawns when everything is visible', () => {
    expect(selectSpawns(desertCompound, 1, createRng(1), () => true)).toEqual({
      ok: false,
      error: 'insufficient-spawns',
    });
    expect(selectSpawns(fixtureMap({ playerSpawns: [] }), 1, createRng(1), neverSees)).toEqual({
      ok: false,
      error: 'insufficient-spawns',
    });
  });

  it('SD-WM-2: an invalid bot count is rejected before any rng draw or LOS call', () => {
    for (const n of [0, 21, 2.5, Number.NaN, -1, Number.MAX_SAFE_INTEGER + 2]) {
      const rng = countingRng(1);
      let calls = 0;
      const plan = selectSpawns(desertCompound, n as BotCount, rng, () => {
        calls++;
        return false;
      });
      expect(plan).toEqual({ ok: false, error: 'invalid-bot-count' });
      expect(rng.draws).toBe(0);
      expect(calls).toBe(0);
    }
  });

  it('LC-WM-05: at most 288 LOS queries for 20 bots on Desert', () => {
    let calls = 0;
    const counted = (a: Vec3, b: Vec3) => {
      calls++;
      return los(a, b);
    };
    for (let seed = 1; seed <= 20; seed++) {
      calls = 0;
      selectSpawns(desertCompound, 20, createRng(seed), counted);
      expect(calls).toBeLessThanOrEqual(288);
    }
  });

  it('BR-WM-30 / SD-WM-12: deterministic per seed, pinned as literals', () => {
    const ids = (seed: number) => {
      const p = selectSpawns(desertCompound, 5, createRng(seed), los);
      return p.ok ? [p.value.player.id, ...p.value.bots.map((b) => b.id)] : [];
    };
    expect(ids(1)).toEqual(ids(1));
    expect(ids(1)).toEqual(SEED_1);
    expect(ids(42)).toEqual(SEED_42);
    expect(ids(1337)).toEqual(SEED_1337);
  });
});

// Literal expectations (SD-WM-12): Vitest would silently write a missing snapshot.
const SEED_1 = [
  'player-4',
  'nw-ruins-8',
  'north-yard-5',
  'ne-depot-5',
  'nw-ruins-3',
  'north-yard-8',
];
const SEED_42 = [
  'player-4',
  'north-yard-6',
  'ne-depot-6',
  'nw-ruins-8',
  'north-yard-8',
  'ne-depot-7',
];
const SEED_1337 = [
  'player-2',
  'north-yard-3',
  'ne-depot-2',
  'nw-ruins-1',
  'north-yard-8',
  'ne-depot-3',
];
