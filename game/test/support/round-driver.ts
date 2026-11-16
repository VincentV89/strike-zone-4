// match-loop test driver (LC-ML-40). A SimPhysicsPort fake over the pure box-world query with
// a kinematic mover and AABB hitboxes that apply at step(), like the Rapier adapter. Wiring of
// the round mirrors app-shell: createRound + a buildSimulation factory over a cached nav graph.
// Test-only.
import {
  Layer,
  MASK_WORLD,
  PLAYER_ID,
  ZERO,
  dirFromYawPitch,
  includes,
  sub,
  vec3,
  wrapAngle,
  yawOf,
  type ActorId,
  type DomainEvent,
  type MoveResult,
  type RayHit,
  type Stance,
  type Vec3,
} from '@sz/kernel';
import { desertCompound, type MapDefinition, type SpawnPlan } from '@sz/maps';
import type { NavGraph } from '@sz/nav';
import { DEFAULT_CHARACTER, type CharacterSpec, type PhysicsStats } from '@sz/physics';
import { NEUTRAL_INTENT, type PlayerInputIntent } from '@sz/player';
import { createRound, type RoundController, type RoundDeps } from '@sz/round';
import { createSim, type BotErrorReporter, type SimPhysicsPort, type Simulation } from '@sz/sim';
import type { SessionTotals } from '@sz/stats';
import { mapWorld } from './ai-arena';
import { createFakePhysics, type FakeActor } from './fakes';
import { createRecordingBus, type RecordingBus } from './recording-bus';

const STEP_UP = 0.6;
const PROBE_UP = 1.0;

export type PhysicsCall =
  | 'move'
  | 'setStance'
  | 'teleport'
  | 'sync'
  | 'step'
  | 'raycast'
  | 'lineOfSight'
  | 'add'
  | 'remove';

interface FakeCharacter {
  pos: Vec3;
  stance: Stance;
  hitboxes: boolean;
  /** Pose synced since the last step; applied at step() (world-maps rule BR-WM-63). */
  pending: { pos: Vec3; stance: Stance } | null;
  /** The hitbox pose raycasts see. */
  applied: { pos: Vec3; stance: Stance } | null;
}

export interface FakeSimPhysics extends SimPhysicsPort {
  readonly calls: PhysicsCall[];
  readonly counts: Record<PhysicsCall, number>;
  /** Characters whose hitboxes are never hit (time-expired scenarios). */
  readonly untouchable: Set<ActorId>;
  /** Fail the n-th addCharacter call (1-based) for spawn failure tests; 0 = never. */
  failAddAt: number;
  /** Optional hooks that throw to prove propagation (SEC-ML-31). */
  throwOn: Partial<Record<'step' | 'move' | 'raycast', boolean>>;
  positionOf(id: ActorId): Vec3 | undefined;
  stanceOf(id: ActorId): Stance | undefined;
  hitboxesEnabled(id: ActorId): boolean | undefined;
}

function boxesFor(id: ActorId, feet: Vec3, stance: Stance): FakeActor {
  const top = stance === 'crouch' ? 1.2 : 1.8;
  const neck = top - 0.4;
  return {
    id,
    side: id === PLAYER_ID ? 'player' : 'bot',
    body: {
      min: vec3(feet.x - 0.3, feet.y, feet.z - 0.3),
      max: vec3(feet.x + 0.3, feet.y + neck, feet.z + 0.3),
    },
    head: {
      min: vec3(feet.x - 0.2, feet.y + neck, feet.z - 0.2),
      max: vec3(feet.x + 0.2, feet.y + top, feet.z + 0.2),
    },
  };
}

/** SimPhysicsPort fake. Box-world geometry, kinematic stepping mover, AABB hitboxes. */
export function createFakeSimPhysics(map: MapDefinition): FakeSimPhysics {
  const { query } = mapWorld(map);
  const chars = new Map<ActorId, FakeCharacter>();
  const calls: PhysicsCall[] = [];
  const counts = {
    move: 0,
    setStance: 0,
    teleport: 0,
    sync: 0,
    step: 0,
    raycast: 0,
    lineOfSight: 0,
    add: 0,
    remove: 0,
  } satisfies Record<PhysicsCall, number>;
  const untouchable = new Set<ActorId>();
  let addCalls = 0;
  const record = (c: PhysicsCall): void => {
    calls.push(c);
    counts[c]++;
  };

  type Probe = { kind: 'ground'; y: number } | { kind: 'inside' } | { kind: 'void' };
  const probe = (x: number, y: number, z: number): Probe => {
    const hit = query.raycast(vec3(x, y + PROBE_UP, z), vec3(0, -1, 0), 200, MASK_WORLD);
    if (hit === null) return { kind: 'void' };
    if (hit.distance < 1e-6) return { kind: 'inside' };
    return { kind: 'ground', y: hit.point.y };
  };

  const fake: FakeSimPhysics = {
    calls,
    counts,
    untouchable,
    failAddAt: 0,
    throwOn: {},
    disposed: false,
    raycast(origin, dir, maxDist, mask, exclude): RayHit | null {
      record('raycast');
      if (fake.throwOn.raycast === true) throw new Error('fake raycast failure');
      const w = includes(mask, Layer.WORLD)
        ? query.raycast(origin, dir, maxDist, MASK_WORLD)
        : null;
      const live: FakeActor[] = [];
      for (const [id, c] of chars) {
        if (c.hitboxes && c.applied && !untouchable.has(id)) {
          live.push(boxesFor(id, c.applied.pos, c.applied.stance));
        }
      }
      const a = createFakePhysics({ actors: live }).raycast(origin, dir, maxDist, mask, exclude);
      if (w === null) return a;
      if (a === null) return w;
      return a.distance < w.distance ? a : w;
    },
    lineOfSight(a, b) {
      record('lineOfSight');
      return query.lineOfSight(a, b);
    },
    move(id, v, dt): MoveResult {
      record('move');
      if (fake.throwOn.move === true) throw new Error('fake move failure');
      const c = chars.get(id);
      if (!c) return { position: ZERO, grounded: false, hitCeiling: false, collided: false };
      let x = c.pos.x + v.x * dt;
      let z = c.pos.z + v.z * dt;
      let p = probe(x, c.pos.y, z);
      const blocked =
        p.kind === 'inside' ||
        (p.kind === 'ground' &&
          (p.y - c.pos.y > STEP_UP ||
            !query.lineOfSight(vec3(x, p.y + 0.4, z), vec3(x, p.y + 1.7, z))));
      if (blocked) {
        x = c.pos.x;
        z = c.pos.z;
        p = probe(x, c.pos.y, z);
      }
      const ny = c.pos.y + v.y * dt;
      const g = p.kind === 'ground' ? p.y : null;
      const grounded = g !== null && ny <= g + 1e-6;
      c.pos = vec3(x, grounded ? g : ny, z);
      return { position: c.pos, grounded, hitCeiling: false, collided: blocked };
    },
    setStance(id, stance) {
      record('setStance');
      const c = chars.get(id);
      if (!c) return false;
      c.stance = stance;
      return true;
    },
    teleport(id, pos) {
      record('teleport');
      const c = chars.get(id);
      if (c) c.pos = pos;
    },
    addCharacter(id, _spec: CharacterSpec, pos) {
      record('add');
      addCalls++;
      if (fake.failAddAt > 0 && addCalls === fake.failAddAt) return false;
      if (chars.has(id) || chars.size >= 21) return false;
      chars.set(id, { pos, stance: 'stand', hitboxes: true, pending: null, applied: null });
      return true;
    },
    removeCharacter(id) {
      record('remove');
      chars.delete(id);
    },
    removeAllCharacters() {
      chars.clear();
    },
    setHitboxesEnabled(id, enabled) {
      const c = chars.get(id);
      if (c) c.hitboxes = enabled;
    },
    syncHitboxes(id, pos, _yaw, stance) {
      record('sync');
      const c = chars.get(id);
      if (c) c.pending = { pos, stance };
    },
    step() {
      record('step');
      if (fake.throwOn.step === true) throw new Error('fake step failure');
      for (const c of chars.values()) {
        if (c.pending) c.applied = c.pending;
        c.pending = null;
      }
    },
    stats(): PhysicsStats {
      return { bodies: chars.size, colliders: chars.size * 5, characters: chars.size };
    },
    positionOf: (id) => chars.get(id)?.pos,
    stanceOf: (id) => chars.get(id)?.stance,
    hitboxesEnabled: (id) => chars.get(id)?.hitboxes,
  };
  return fake;
}

export interface TestRoundOptions {
  readonly map?: MapDefinition;
  readonly botCount?: number;
  readonly difficulty?: 'easy' | 'normal' | 'hard';
  readonly durationSec?: number;
  readonly seed?: number;
  readonly totals?: SessionTotals;
  readonly report?: BotErrorReporter;
  /** Rewrites the spawn plan before sim.spawn (places bots for scripted fights). */
  readonly placeBots?: (plan: SpawnPlan, map: MapDefinition) => SpawnPlan;
  /** Supplies the physics port (default: the box-world fake). */
  readonly physics?: (map: MapDefinition) => SimPhysicsPort;
  /** Supplies the nav graph (default: mapWorld(map).nav). */
  readonly nav?: (map: MapDefinition) => NavGraph;
  readonly characterSpec?: CharacterSpec;
}

export interface TestRound {
  readonly round: RoundController;
  readonly bus: RecordingBus<DomainEvent>;
  /** The most recently built simulation. */
  sim(): Simulation;
  physics(): SimPhysicsPort;
  readonly builds: number;
  /** Every reporter call. */
  readonly reports: { bot: ActorId; err: unknown }[];
  nextSeedCalls: number;
  /** start(), then beginCountdown() and 180 countdown ticks so the round is live. */
  goLive(): void;
  run(ticks: number, intent?: (tick: number) => PlayerInputIntent): void;
  setup: { mapId: MapDefinition['id']; botCount: number; difficulty: string };
}

/** Builds a round like app-shell does; physics and nav are cached per map and reused. */
export function createTestRound(opts: TestRoundOptions = {}): TestRound {
  const map = opts.map ?? desertCompound;
  const physicsCache = new Map<MapDefinition, SimPhysicsPort>();
  const bus = createRecordingBus();
  const reports: { bot: ActorId; err: unknown }[] = [];
  let last: Simulation | undefined;
  let lastPhysics: SimPhysicsPort | undefined;
  let builds = 0;
  let seedCounter = (opts.seed ?? 1) + 1000;
  const report: BotErrorReporter =
    opts.report ??
    ((bot, err) => {
      reports.push({ bot, err });
    });

  const buildSimulation: RoundDeps['buildSimulation'] = (config) => {
    builds++;
    const m = config.setup.mapId === map.id ? map : desertCompound;
    let physics = physicsCache.get(m);
    if (!physics) {
      physics = opts.physics ? opts.physics(m) : createFakeSimPhysics(m);
      physicsCache.set(m, physics);
    }
    lastPhysics = physics;
    const inner = createSim({
      map: m,
      physics,
      characterSpec: opts.characterSpec ?? DEFAULT_CHARACTER,
      nav: opts.nav ? opts.nav(m) : mapWorld(m).nav,
      setup: config.setup,
      seed: config.seed,
      bus,
      report,
    });
    const place = opts.placeBots;
    const sim: Simulation = place
      ? {
          map: inner.map,
          setup: inner.setup,
          spawnSight: inner.spawnSight,
          spawn: (plan) => inner.spawn(place(plan, m)),
          step: (i, g) => {
            inner.step(i, g);
          },
          applyLook: (d, s) => {
            inner.applyLook(d, s);
          },
          tickLog: () => inner.tickLog(),
          snapshot: () => inner.snapshot(),
          aliveBotCount: () => inner.aliveBotCount(),
          playerAlive: () => inner.playerAlive(),
          stats: () => inner.stats(),
          dispose: () => {
            inner.dispose();
          },
          get disposed() {
            return inner.disposed;
          },
        }
      : inner;
    last = sim;
    return sim;
  };

  const t: TestRound = {
    round: createRound({
      bus,
      buildSimulation,
      nextSeed: () => {
        t.nextSeedCalls++;
        return seedCounter++;
      },
      ...(opts.totals ? { totals: opts.totals } : {}),
    }),
    bus,
    sim() {
      if (!last) throw new Error('no simulation built yet');
      return last;
    },
    physics() {
      if (!lastPhysics) throw new Error('no physics yet');
      return lastPhysics;
    },
    get builds() {
      return builds;
    },
    reports,
    nextSeedCalls: 0,
    setup: { mapId: map.id, botCount: opts.botCount ?? 1, difficulty: opts.difficulty ?? 'normal' },
    goLive() {
      const r = t.round.start(config(t, opts));
      if (!r.ok) throw new Error(`start failed: ${r.error}`);
      t.round.beginCountdown();
      t.run(180);
    },
    run(ticks, intent) {
      for (let i = 0; i < ticks; i++) t.round.tick(intent ? intent(i) : NEUTRAL_INTENT);
    },
  };
  return t;
}

export function config(t: Pick<TestRound, 'setup'>, opts: TestRoundOptions = {}): unknown {
  return {
    setup: t.setup,
    durationSec: opts.durationSec ?? 120,
    seed: opts.seed ?? 1,
  };
}

/** Intent with some fields set. */
export function intentOf(p: Partial<PlayerInputIntent> = {}): PlayerInputIntent {
  return { ...NEUTRAL_INTENT, ...p };
}

const RAD_PER_PX = 0.0022;

/** Turns the player's camera toward a world point through round.look (sensitivity 1). */
export function aimAt(round: RoundController, target: Vec3): void {
  const snap = round.snapshot();
  if (!snap) return;
  const p = snap.player;
  const eye = vec3(p.pos.x, p.pos.y + p.eyeHeight, p.pos.z);
  const d = sub(target, eye);
  const yaw = yawOf(d);
  const pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  round.look({ dx: -wrapAngle(yaw - p.yaw) / RAD_PER_PX, dy: -(pitch - p.pitch) / RAD_PER_PX }, 1);
}

/** A spawn plan rewrite that puts every bot in a row 6 m in front of the player, in the open. */
export function botsInFront(plan: SpawnPlan): SpawnPlan {
  const f = dirFromYawPitch(plan.player.yaw, 0);
  const right = vec3(-f.z, 0, f.x);
  const bots = plan.bots.map((b, i) => {
    const lateral = (i - (plan.bots.length - 1) / 2) * 1.6;
    const pos = vec3(
      plan.player.pos.x + f.x * 6 + right.x * lateral,
      plan.player.pos.y,
      plan.player.pos.z + f.z * 6 + right.z * lateral,
    );
    return { ...b, pos, yaw: wrapAngle(plan.player.yaw + Math.PI) };
  });
  return { player: plan.player, bots };
}

/** Head point of a snapshot bot. */
export function headOf(b: { readonly pos: Vec3; readonly stance: Stance }): Vec3 {
  return vec3(b.pos.x, b.pos.y + (b.stance === 'crouch' ? 1.1 : 1.65), b.pos.z);
}

/** Aims at the first live bot's head and holds fire until every bot is dead or `max` ticks. */
export function fightToVictory(t: TestRound, max = 1200): number {
  for (let i = 0; i < max; i++) {
    const snap = t.round.snapshot();
    const target = snap?.bots.find((b) => b.alive);
    if (!target || t.round.state().phase !== 'live') return i;
    aimAt(t.round, headOf(target));
    t.round.tick(intentOf({ fire: true, firePressed: i % 2 === 0 }));
  }
  return max;
}
