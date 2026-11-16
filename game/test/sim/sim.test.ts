// Simulation behaviour over the box-world fake (business-logic-model-match-loop §3 to §5, §8).
import { describe, expect, it } from 'vitest';
import { BOT_COUNTS, PLAYER_ID, vec3, type ActorId, type DomainEvent } from '@sz/kernel';
import { desertCompound, industrialWarehouse, type MapDefinition } from '@sz/maps';
import { DEFAULT_CHARACTER } from '@sz/physics';
import { createSim } from '@sz/sim';
import { weaponStats } from '@sz/weapons';
import { mapWorld } from '../support/ai-arena';
import { fnv1aString } from '../support/nav-digest';
import {
  aimAt,
  botsInFront,
  config,
  createFakeSimPhysics,
  createTestRound,
  headOf,
  intentOf,
  type FakeSimPhysics,
  type TestRound,
} from '../support/round-driver';

const BOT1 = 'bot-1' as ActorId;
const BOT2 = 'bot-2' as ActorId;

const fakeOf = (t: TestRound) => t.physics() as FakeSimPhysics;

function liveRound(botCount: number, extra: Parameters<typeof createTestRound>[0] = {}) {
  const t = createTestRound({ botCount, ...extra });
  t.goLive();
  return t;
}

function deepFrozen(x: unknown): boolean {
  if (typeof x !== 'object' || x === null) return true;
  return Object.isFrozen(x) && Object.values(x).every(deepFrozen);
}

describe('tick order (BR-ML-31, LC-ML-02)', () => {
  it('moves, then hitbox syncs, then exactly one physics step, then every raycast', () => {
    const t = liveRound(3, { placeBots: botsInFront, seed: 4 });
    const fake = fakeOf(t);
    let raycastTicks = 0;
    for (let i = 0; i < 300; i++) {
      fake.calls.length = 0;
      const snap = t.round.snapshot();
      const target = snap?.bots.find((b) => b.alive);
      if (target) aimAt(t.round, headOf(target));
      t.round.tick(intentOf({ fire: i % 20 === 0, firePressed: i % 20 === 0 }));
      if (t.round.state().phase !== 'live') break;
      const c = fake.calls;
      const step = c.indexOf('step');
      expect(c.filter((x) => x === 'step')).toHaveLength(1);
      expect(c.lastIndexOf('move')).toBeLessThan(c.indexOf('sync'));
      expect(c.lastIndexOf('sync')).toBeLessThan(step);
      const firstRay = c.indexOf('raycast');
      if (firstRay >= 0) {
        raycastTicks++;
        expect(firstRay).toBeGreaterThan(step);
      }
    }
    expect(raycastTicks).toBeGreaterThan(0);
  });

  it('PERF-ML-3/4: at 20 bots, one step, ≤ 21 shot rays, ≤ 72 sight rays and ≤ 84 events per tick', () => {
    const t = liveRound(20, { seed: 11 });
    const fake = fakeOf(t);
    const max = { raycast: 0, lineOfSight: 0, events: 0 };
    for (let i = 0; i < 600; i++) {
      const before = { ...fake.counts };
      t.round.tick(intentOf({ fire: i % 30 < 3, move: { forward: 1, right: 0 } }));
      expect(fake.counts.step - before.step).toBe(1);
      max.raycast = Math.max(max.raycast, fake.counts.raycast - before.raycast);
      max.lineOfSight = Math.max(max.lineOfSight, fake.counts.lineOfSight - before.lineOfSight);
      max.events = Math.max(max.events, t.sim().tickLog().length);
      if (t.round.state().phase !== 'live') break;
    }
    expect(max.raycast).toBeLessThanOrEqual(21);
    expect(max.lineOfSight).toBeLessThanOrEqual(72);
    expect(max.events).toBeLessThanOrEqual(84);
  });
});

describe('exact bot count (story-exact-bot-count, BR-ML-42)', () => {
  const maps: ReadonlyArray<MapDefinition> = [desertCompound, industrialWarehouse];
  const cases = maps.flatMap((m) => BOT_COUNTS.map((n) => [m.id, n, m] as const));
  it.each(cases)('%s with %s bots spawns exactly N + 1 characters', (_id, n, map) => {
    const t = createTestRound({ map, botCount: n, seed: n });
    expect(t.round.start(config(t)).ok).toBe(true);
    expect(t.sim().aliveBotCount()).toBe(n);
    expect(t.physics().stats().characters).toBe(n + 1);
    const snap = t.round.snapshot();
    expect(snap?.bots.map((b) => b.id)).toEqual(
      Array.from({ length: n }, (_, i) => `bot-${String(i + 1)}`),
    );
    expect(snap?.bots.every((b) => b.alive && b.state === 'patrol')).toBe(true);
    expect(snap?.botCount).toBe(n);
    t.round.beginCountdown();
    t.run(180);
    expect(t.round.state().phase).toBe('live');
    expect(t.round.snapshot()?.aliveBots).toBe(n);
  });
});

describe('spawn is all-or-nothing (SEC-ML-34)', () => {
  it.each([1, 2, 3, 4])('a failing addCharacter call #%s leaves no characters', (k) => {
    let fake: FakeSimPhysics | undefined;
    const t = createTestRound({
      botCount: 3,
      physics: (m) => {
        fake = createFakeSimPhysics(m);
        fake.failAddAt = k;
        return fake;
      },
    });
    const r = t.round.start(config(t));
    expect(r).toEqual({ ok: false, error: 'spawn-failed' });
    expect(fake?.stats().characters).toBe(0);
    expect(t.round.state().phase).toBe('loading');
    expect(t.round.snapshot()).toBeUndefined();
    expect(t.sim().disposed).toBe(true);
    expect(t.round.start(config(t)).ok).toBe(true); // retry succeeds
    expect(fake?.stats().characters).toBe(4);
  });

  it('a plan with the wrong length adds nothing', () => {
    const t = createTestRound({
      botCount: 3,
      placeBots: (plan) => ({ player: plan.player, bots: plan.bots.slice(1) }),
    });
    expect(t.round.start(config(t))).toEqual({ ok: false, error: 'spawn-failed' });
    expect(fakeOf(t).counts.add).toBe(0);
  });

  it('a second spawn on the same simulation is refused', () => {
    const t = createTestRound({ botCount: 1 });
    expect(t.round.start(config(t)).ok).toBe(true);
    const sim = t.sim();
    const plan = {
      player: desertCompound.playerSpawns[0]!,
      bots: [desertCompound.botSpawns[0]!],
    };
    expect(sim.spawn(plan)).toEqual({ ok: false, error: 'spawn-failed' });
    expect(t.physics().stats().characters).toBe(2);
  });
});

describe('combat wiring', () => {
  it('req-bot-independence: a hit on bot-1 changes only bot-1', () => {
    const t = liveRound(3, { placeBots: botsInFront, seed: 2 });
    const bot1 = t.round.snapshot()!.bots[0]!;
    aimAt(t.round, vec3(bot1.pos.x, bot1.pos.y + 1.0, bot1.pos.z));
    const before = t.bus.emitted.length;
    t.round.tick(intentOf({ fire: true, firePressed: true }));
    const events = t.bus.emitted.slice(before);
    const damage = events.filter(
      (e): e is Extract<DomainEvent, { type: 'DamageTaken' }> => e.type === 'DamageTaken',
    );
    expect(damage.map((e) => e.victim)).toEqual([BOT1]);
    const snap = t.round.snapshot()!;
    expect(snap.bots.map((b) => b.hitFlash)).toEqual([true, false, false]);
    expect(snap.bots.every((b) => b.alive)).toBe(true);
    t.run(9);
    expect(t.round.snapshot()!.bots[0]!.hitFlash).toBe(false); // BR-ML-63: 9 ticks
  });

  it('BR-ML-37: a killed bot leaves physics, enters Dead and lowers aliveBots by one', () => {
    const t = liveRound(3, { placeBots: botsInFront, seed: 2 });
    const target = t.round.snapshot()!.bots[1]!;
    aimAt(t.round, headOf(target));
    const before = t.bus.emitted.length;
    t.round.tick(intentOf({ fire: true, firePressed: true }));
    const events = t.bus.emitted.slice(before);
    const killed = events.findIndex((e) => e.type === 'ActorKilled');
    const dead = events.findIndex(
      (e) => e.type === 'BotStateChanged' && e.bot === BOT2 && e.to === 'dead',
    );
    expect(killed).toBeGreaterThanOrEqual(0);
    expect(dead).toBeGreaterThan(killed);
    expect(fakeOf(t).positionOf(BOT2)).toBeUndefined();
    expect(t.physics().stats().characters).toBe(3);
    const snap = t.round.snapshot()!;
    expect(snap.aliveBots).toBe(2);
    expect(snap.bots[1]).toMatchObject({ id: BOT2, alive: false, state: 'dead' });
    // The dead bot keeps its last pose and never acts again.
    const pose = snap.bots[1]!.pos;
    t.run(120);
    const later = t.round.snapshot()!.bots[1]!;
    expect(later.pos).toEqual(pose);
    expect(later.state).toBe('dead');
    const after = t.bus.emitted.slice(before + killed + 1);
    expect(after.some((e) => e.type === 'ShotFired' && e.shooter === BOT2)).toBe(false);
  });

  it('BR-ML-26: when the player dies, hitboxes go off, the character stays and the round is lost', () => {
    const t = liveRound(2, { placeBots: botsInFront, seed: 5, difficulty: 'hard' });
    t.run(3000);
    const state = t.round.state();
    expect(state.phase).toBe('ended');
    expect(state.outcome).toBe('defeat');
    expect(state.summary?.deaths).toBe(1);
    expect(fakeOf(t).hitboxesEnabled(PLAYER_ID)).toBe(false);
    expect(fakeOf(t).positionOf(PLAYER_ID)).toBeDefined();
    expect(t.round.snapshot()?.player.alive).toBe(false);
    const kills = t.bus.emitted.filter((e) => e.type === 'ActorKilled' && e.victim === PLAYER_ID);
    expect(kills).toHaveLength(1);
  });

  it('a bot reloads when its magazine is empty before firing again', () => {
    const t = liveRound(1, { placeBots: botsInFront, seed: 9 });
    const fake = fakeOf(t);
    fake.untouchable.add(PLAYER_ID); // the duel lasts long enough to empty a magazine
    t.run(3600);
    const mag = weaponStats('rifle')!.magazineSize;
    let sinceReload = 0;
    let reloads = 0;
    for (const e of t.bus.emitted) {
      if (e.type === 'ShotFired' && e.shooter === BOT1) sinceReload++;
      if (e.type === 'ReloadDone' && e.actor === BOT1) {
        reloads++;
        sinceReload = 0;
      }
      expect(sinceReload).toBeLessThanOrEqual(mag);
    }
    expect(reloads).toBeGreaterThan(0);
  });
});

describe('noise and footsteps (BR-ML-39, Q3)', () => {
  it('only player gunfire is noise; footsteps go to audio only', () => {
    const t = liveRound(2, { placeBots: botsInFront, seed: 3 });
    fakeOf(t).untouchable.add(PLAYER_ID);
    t.run(900, (i) =>
      intentOf({ move: { forward: 0, right: i % 240 < 120 ? 1 : -1 }, fire: i % 90 < 2 }),
    );
    const ev = t.bus.emitted;
    const playerShots = ev.filter((e) => e.type === 'ShotFired' && e.shooter === PLAYER_ID);
    const noises = ev.filter((e) => e.type === 'NoiseEmitted');
    expect(playerShots.length).toBeGreaterThan(0);
    expect(noises).toHaveLength(playerShots.length);
    for (const n of noises) expect(n).toMatchObject({ source: PLAYER_ID, kind: 'gunfire' });
    expect(ev.some((e) => e.type === 'ShotFired' && e.shooter !== PLAYER_ID)).toBe(true);
    expect(ev.some((e) => e.type === 'Footstep' && e.actor === PLAYER_ID)).toBe(true);
  });
});

describe('kill-Y (BR-ML-36)', () => {
  it('a bot that falls out of the world returns to its own spawn', () => {
    const t = liveRound(1, { seed: 1 });
    const spawn = t.round.snapshot()!.bots[0]!.pos;
    fakeOf(t).teleport(BOT1, vec3(500, 0, 500));
    t.run(150);
    const pos = fakeOf(t).positionOf(BOT1)!;
    expect(pos.y).toBeGreaterThan(-10);
    expect(Math.hypot(pos.x - spawn.x, pos.z - spawn.z)).toBeLessThan(10);
  });

  it('the player who falls out is placed at the own spawn with vitals kept', () => {
    const t = liveRound(1, { seed: 1 });
    const spawn = t.round.snapshot()!.player.pos;
    fakeOf(t).teleport(PLAYER_ID, vec3(500, 0, 500));
    t.run(150);
    const p = t.round.snapshot()!.player;
    expect(Math.hypot(p.pos.x - spawn.x, p.pos.z - spawn.z)).toBeLessThan(1);
    expect(p.vitals).toEqual({ health: 100, armor: 100 });
  });
});

describe('copy and freeze (SD-ML-4, BR-ML-04, BR-ML-60)', () => {
  it('the bus receives the same frozen objects as the tick log, in the same order', () => {
    const t = liveRound(3, { placeBots: botsInFront, seed: 6 });
    fakeOf(t).untouchable.add(PLAYER_ID);
    let seen = 0;
    for (let i = 0; i < 600; i++) {
      const before = t.bus.emitted.length;
      t.round.tick(intentOf({ fire: i % 40 === 0, move: { forward: 0, right: 1 } }));
      const log = t.sim().tickLog();
      const bus = t.bus.emitted
        .slice(before)
        .filter((e) => e.type !== 'RoundPhaseChanged' && e.type !== 'RoundEnded');
      expect(bus).toHaveLength(log.length);
      bus.forEach((e, j) => {
        expect(e).toBe(log[j]);
      });
      expect(deepFrozen(log)).toBe(true);
      seen += log.length;
      if (t.round.state().phase !== 'live') break;
    }
    expect(seen).toBeGreaterThan(10);
  });

  it('a subscriber writing to a payload cannot move an actor', () => {
    const t = liveRound(1, { seed: 1 });
    t.run(30, () => intentOf({ move: { forward: 1, right: 0 } }));
    const ev = t.sim().tickLog();
    const step = ev.find(
      (e): e is Extract<DomainEvent, { type: 'Footstep' }> => e.type === 'Footstep',
    );
    if (step) {
      expect(() => {
        (step.pos as { x: number }).x = 999;
      }).toThrow();
    }
    expect(t.round.snapshot()!.player.pos.x).not.toBe(999);
  });

  it('the snapshot is deep-frozen, memoised per tick and rebuilt after a tick', () => {
    const t = liveRound(2, { seed: 1 });
    const a = t.round.snapshot();
    expect(t.round.snapshot()).toBe(a);
    expect(deepFrozen(a)).toBe(true);
    t.run(1);
    const b = t.round.snapshot();
    expect(b).not.toBe(a);
    expect(b?.tick).toBe((a?.tick ?? 0) + 1);
    expect(b?.events).toBe(t.sim().tickLog());
  });
});

describe('dispose (BR-ML-45)', () => {
  it('is idempotent; step after dispose is a no-op; the last snapshot stays', () => {
    const t = liveRound(2, { seed: 1 });
    const sim = t.sim();
    const last = sim.snapshot();
    sim.dispose();
    sim.dispose();
    expect(sim.disposed).toBe(true);
    expect(t.physics().stats().characters).toBe(0);
    sim.step(intentOf(), { move: true, fire: true, ai: true });
    sim.applyLook({ dx: 100, dy: 0 }, 1);
    expect(sim.snapshot()).toBe(last);
    expect(sim.stats().bots).toBe(0);
    expect(sim.aliveBotCount()).toBe(0);
    expect(sim.playerAlive()).toBe(false);
  });

  it('a simulation that never spawned ignores step and look and has no snapshot', () => {
    const physics = createFakeSimPhysics(desertCompound);
    const sim = createSim({
      map: desertCompound,
      physics,
      characterSpec: DEFAULT_CHARACTER,
      nav: mapWorld(desertCompound).nav,
      setup: { mapId: 'desert-compound', botCount: 1, difficulty: 'easy' },
      seed: 1,
      bus: { emit: () => undefined },
    });
    sim.step(intentOf(), { move: true, fire: true, ai: true });
    sim.applyLook({ dx: 10, dy: 0 }, 1);
    expect(sim.snapshot()).toBeUndefined();
    expect(sim.stats().tick).toBe(0);
    expect(physics.counts.step).toBe(0);
    sim.dispose();
    expect(sim.snapshot()).toBeUndefined();
    expect(sim.spawn({ player: desertCompound.playerSpawns[0]!, bots: [] }).ok).toBe(false);
  });
});

describe('determinism (BR-ML-70, REL-ML-4)', () => {
  function run(seed: number): { digest: string; events: number; types: Record<string, number> } {
    const t = createTestRound({ botCount: 5, seed });
    t.goLive();
    const all: DomainEvent[] = [];
    for (let i = 0; i < 1800; i++) {
      t.round.tick(
        intentOf({
          move: { forward: i % 400 < 200 ? 1 : 0, right: i % 300 < 150 ? 1 : 0 },
          fire: i % 100 < 5,
          sprint: i % 500 < 100,
        }),
      );
      all.push(...t.sim().tickLog());
      if (t.round.state().phase !== 'live') break;
    }
    const types: Record<string, number> = {};
    for (const e of all) types[e.type] = (types[e.type] ?? 0) + 1;
    return { digest: fnv1aString(JSON.stringify(all)), events: all.length, types };
  }

  it('the same seed and script give the same event stream; the digest is pinned', () => {
    const a = run(1234);
    const b = run(1234);
    expect(b).toEqual(a);
    expect(a.digest).toBe('c0925342');
    expect(a.types['ShotFired']).toBeGreaterThan(0);
    expect(run(1235).digest).not.toBe(a.digest);
  });
});
