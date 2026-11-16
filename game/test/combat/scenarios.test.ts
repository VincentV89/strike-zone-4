// Multi-holder scenarios: S11 (21 holders in one tick) and the 600-tick determinism duel
// (REL-WC-05). The duel is pinned twice: a committed Vitest snapshot for readable diffs and an
// FNV-1a digest literal, because `vitest run` without CI silently writes a missing snapshot.
import { describe, expect, it } from 'vitest';
import {
  PLAYER_ID,
  STEP_SEC,
  botIds,
  createRng,
  normalize,
  sub,
  vec3,
  type ActorId,
  type DomainEvent,
  type Rng,
  type Vec3,
} from '@sz/kernel';
import {
  BOT_START_VITALS,
  PLAYER_START_VITALS,
  applyResolution,
  resolveShot,
  type CombatActor,
} from '@sz/combat';
import {
  BOT_LOADOUT,
  PLAYER_LOADOUT,
  createInventory,
  tickWeapon,
  type TriggerIntent,
  type WeaponInventory,
} from '@sz/weapons';
import { createFakePhysics, type FakeActor } from '../support/fakes';
import {
  box,
  createActorTable,
  fakeActorAt,
  spyQuery,
  type ActorTable,
} from '../support/combat-scene';
import { createRecordingBus } from '../support/recording-bus';

interface Holder {
  readonly id: ActorId;
  readonly inv: WeaponInventory;
  readonly eye: Vec3;
}

const eyeOf = (a: FakeActor): Vec3 =>
  vec3((a.head.min.x + a.head.max.x) / 2, 1.6, (a.head.min.z + a.head.max.z) / 2);

/** One simulation tick in match-loop order: player first, then ascending bot id (BR-C-09). */
function stepHolders(
  holders: ReadonlyArray<Holder>,
  tick: number,
  intentOf: (h: Holder) => TriggerIntent,
  aimOf: (h: Holder) => Vec3,
  env: {
    physics: ReturnType<typeof spyQuery>;
    table: ActorTable;
    bus: ReturnType<typeof createRecordingBus<DomainEvent>>;
    rng: Rng;
  },
): number {
  let shots = 0;
  for (const h of holders) {
    const alive = (env.table.vitalsOf(h.id)?.health ?? 0) > 0;
    const r = tickWeapon(
      h.inv,
      intentOf(h),
      {
        now: tick * STEP_SEC,
        dt: STEP_SEC,
        moving: false,
        locked: !alive,
        shooter: h.id,
        origin: h.eye,
        aimDir: aimOf(h),
      },
      env.rng,
    );
    for (const e of r.events) env.bus.emit(e);
    for (const s of r.shots) {
      shots++;
      applyResolution(resolveShot(s, env.physics, env.table), env.table, env.bus);
    }
  }
  return shots;
}

describe('S11: the player and 20 bots fire in the same tick (PERF-WC-01, PERF-WC-02)', () => {
  it('makes exactly one raycast per shot, at most 21 per tick', () => {
    const fakes = [
      fakeActorAt(PLAYER_ID, 'player', 0, 0),
      ...botIds(20).map((id, i) => fakeActorAt(id, 'bot', (i - 10) * 2, -20)),
    ];
    const physics = spyQuery(createFakePhysics({ actors: fakes }));
    const actors: CombatActor[] = fakes.map((f) => ({
      id: f.id,
      side: f.side,
      vitals: f.side === 'player' ? PLAYER_START_VITALS : BOT_START_VITALS,
    }));
    const table = createActorTable(actors);
    const bus = createRecordingBus();
    const holders: Holder[] = fakes.map((f) => ({
      id: f.id,
      inv: createInventory(f.side === 'player' ? PLAYER_LOADOUT : BOT_LOADOUT),
      eye: eyeOf(f),
    }));
    const player = eyeOf(fakes[0]!);
    const fire: TriggerIntent = { fire: true, reload: false, scope: false };
    const shots = stepHolders(
      holders,
      0,
      () => fire,
      (h) => (h.id === PLAYER_ID ? vec3(0, 1, -1) : normalize(sub(player, h.eye))),
      {
        physics,
        table,
        bus,
        rng: createRng(5),
      },
    );
    expect(shots).toBe(21);
    expect(physics.calls).toHaveLength(21);
    expect(bus.emitted.filter((e) => e.type === 'ShotFired')).toHaveLength(21);
    // PERF-WC-03: at most 5 combat events per shot.
    expect(bus.emitted.length).toBeLessThanOrEqual(21 * 5);
  });
});

/** FNV-1a, 32-bit, over UTF-16 code units. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const num = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(6));
const v3 = (v: Vec3) => `${num(v.x)},${num(v.y)},${num(v.z)}`;

function line(e: DomainEvent): string {
  switch (e.type) {
    case 'ShotFired':
      return `ShotFired ${e.shooter} ${e.weapon} dir=${v3(e.dir)}`;
    case 'ShotImpact':
      return `ShotImpact ${e.shooter} ${e.surface} ${e.target ?? '-'} at=${v3(e.point)}`;
    case 'HitConfirmed':
      return `HitConfirmed ${e.shooter}>${e.target} ${e.zone} ${e.damage} killed=${String(e.killed)}`;
    case 'DamageTaken':
      return `DamageTaken ${e.victim}<${e.from} ${e.amount} -> ${e.healthAfter}/${e.armorAfter} dir=${v3(e.dir)}`;
    case 'ActorKilled':
      return `ActorKilled ${e.killer}>${e.victim} ${e.weapon} head=${String(e.headshot)}`;
    case 'ReloadDone':
      return `ReloadDone ${e.actor} ${e.weapon} ${e.magazine}/${e.reserve}`;
    default:
      return `${e.type} ${JSON.stringify(e)}`;
  }
}

/**
 * Player (100/100, rifle then sniper) against bot-1 in the open and bot-2 behind a wall.
 * Intents and aim error come from a script Rng; weapon spread uses one shared Rng stream.
 */
function runDuel(): { lines: string[]; vitals: Record<string, unknown> } {
  const fakes = [
    fakeActorAt(PLAYER_ID, 'player', 0, 0),
    fakeActorAt('bot-1' as ActorId, 'bot', -1, -18),
    fakeActorAt('bot-2' as ActorId, 'bot', 4, -15),
  ];
  const wall = box(vec3(2.5, 0, -11), vec3(6, 3, -10));
  const physics = spyQuery(createFakePhysics({ boxes: [wall], actors: fakes }));
  const table = createActorTable(
    fakes.map((f) => ({
      id: f.id,
      side: f.side,
      vitals: f.side === 'player' ? PLAYER_START_VITALS : BOT_START_VITALS,
    })),
  );
  const bus = createRecordingBus();
  const holders: Holder[] = fakes.map((f) => ({
    id: f.id,
    inv: createInventory(f.side === 'player' ? PLAYER_LOADOUT : BOT_LOADOUT),
    eye: eyeOf(f),
  }));
  const script = createRng(600);
  const env = { physics, table, bus, rng: createRng(42) };
  const targetOf = (tick: number) => (tick < 300 ? holders[1]! : holders[2]!);
  for (let tick = 0; tick < 600; tick++) {
    const wobble = vec3(script.range(-0.03, 0.03), script.range(-0.03, 0.03), 0);
    const pFire = script.next() < 0.7;
    const bFire = script.next() < 0.5;
    stepHolders(
      holders,
      tick,
      (h) => {
        if (h.id !== PLAYER_ID) return { fire: bFire, reload: false, scope: false };
        const switchTo = tick === 300 ? 'sniper' : undefined;
        return {
          fire: tick >= 300 ? tick % 20 === 0 : pFire,
          reload: false,
          scope: tick >= 300,
          ...(switchTo ? { switchTo } : {}),
        };
      },
      (h) => {
        const to = h.id === PLAYER_ID ? targetOf(tick).eye : holders[0]!.eye;
        const k = h.id === PLAYER_ID ? 10 : 60; // bots aim worse than the player
        return normalize(sub(vec3(to.x + wobble.x * k, to.y + wobble.y * k, to.z), h.eye));
      },
      env,
    );
  }
  return {
    lines: bus.emitted.map(line),
    vitals: Object.fromEntries(fakes.map((f) => [f.id, table.vitalsOf(f.id)])),
  };
}

// Recorded under Node 24 V8 at code generation. Determinism holds per engine only (R-2).
// Change only on purpose, together with the snapshot.
const DUEL_DIGEST = 'e155ac72';

describe('600-tick determinism duel (REL-WC-05)', () => {
  it('the same seeds give the same event stream, pinned by digest and snapshot', () => {
    const a = runDuel();
    const b = runDuel();
    expect(a).toEqual(b);
    const counts: Record<string, number> = {};
    for (const l of a.lines) {
      const t = l.split(' ')[0]!;
      counts[t] = (counts[t] ?? 0) + 1;
    }
    expect(counts['ShotFired']).toBeGreaterThan(20);
    expect(counts['HitConfirmed']).toBeGreaterThan(0);
    expect(counts['ShotImpact']).toBeGreaterThan(counts['HitConfirmed']!);
    expect(fnv1a(JSON.stringify(a))).toBe(DUEL_DIGEST);
    expect({ counts, vitals: a.vitals, head: a.lines.slice(0, 40) }).toMatchSnapshot();
  });
});
