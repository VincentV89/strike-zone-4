// Seeded AI arena (LC-AI-C22, business-logic-model-bot-ai Q10). Runs the match-loop per-tick
// pipeline in Node: scripted player, perception, scheduled decide, tick, a kinematic mover over
// the box-world query, and real @sz/weapons + @sz/combat for bot fire. Test-only.
import {
  createBotWorldView,
  createBrain,
  createScheduler,
  createSquadBoard,
  decide,
  markDead,
  seedFor,
  tick as tickBrain,
  type BotBrain,
  type BotIntent,
  type BotSelfView,
  type BotWorldView,
} from '@sz/ai';
import {
  createPerceptionSystem,
  createTargetSample,
  type PerceptionSystem,
} from '@sz/ai/perception';
import {
  BOT_START_VITALS,
  PLAYER_START_VITALS,
  applyResolution,
  resolveShot,
  type CombatActor,
  type MutableActorLookup,
  type Vitals,
} from '@sz/combat';
import {
  Layer,
  MASK_WORLD,
  PLAYER_ID,
  STEP_SEC,
  createRng,
  includes,
  normalize,
  sub,
  vec3,
  type ActorId,
  type BotStateName,
  type Difficulty,
  type DomainEvent,
  type PhysicsQuery,
  type RayHit,
  type Rng,
  type Vec3,
} from '@sz/kernel';
import { desertCompound, type MapDefinition } from '@sz/maps';
import { buildNavGraph, createPathBudget, type NavGraph, type PathBudget } from '@sz/nav';
import {
  BOT_LOADOUT,
  createInventory,
  tickWeapon,
  weaponStats,
  weaponView,
  type WeaponInventory,
} from '@sz/weapons';
import { createBoxWorldQuery } from './box-world-query';
import { fnv1a } from './digest';
import { createFakePhysics, type Aabb, type FakeActor } from './fakes';
import {
  countingBudget,
  countingNav,
  countingQuery,
  zeroCounts,
  type PortCounts,
} from './counting-ports';

const STAND_EYE = 1.62;
const CROUCH_EYE = 1.05;
const STEP_UP = 0.6;
const PROBE_UP = 1.0;

const navCache = new Map<MapDefinition, { nav: NavGraph; query: PhysicsQuery }>();

/** Desert (or any map) nav graph over the pure box-world query, built once per test file. */
export function mapWorld(map: MapDefinition = desertCompound): {
  nav: NavGraph;
  query: PhysicsQuery;
} {
  const hit = navCache.get(map);
  if (hit) return hit;
  const query = createBoxWorldQuery(map);
  const built = buildNavGraph(map, query);
  if (!built.ok) throw new Error(`nav build failed for ${map.id}`);
  const entry = { nav: built.value, query };
  navCache.set(map, entry);
  return entry;
}

export interface ArenaBot {
  readonly id: ActorId;
  readonly index: number;
  readonly brain: BotBrain;
  readonly inv: WeaponInventory;
  readonly weaponRng: Rng;
  pos: Vec3;
  alive: boolean;
  crouch: boolean;
  intent: BotIntent | null;
}

export interface TransitionLog {
  readonly tick: number;
  readonly bot: ActorId;
  readonly from: BotStateName;
  readonly to: BotStateName;
  readonly guard: string;
}

export interface PlayerFrame {
  readonly feet?: Vec3;
  readonly yaw?: number;
  readonly crouch?: boolean;
}

export interface ArenaOptions {
  readonly map?: MapDefinition;
  readonly botCount: number;
  readonly difficulty?: Difficulty;
  readonly seed?: number;
  readonly botStarts?: ReadonlyArray<Vec3>;
  readonly botYaws?: ReadonlyArray<number>;
  readonly playerFeet?: Vec3;
  /** false: the player is dead from the start and never visible (quiet patrol scenarios). */
  readonly playerAlive?: boolean;
  /** The player is a target that never loses health (long scenarios). */
  readonly playerInvulnerable?: boolean;
  readonly botsShoot?: boolean;
  /** XZ areas the mover refuses to enter (stuck tests). */
  readonly blockers?: ReadonlyArray<Aabb>;
  /** Called before each tick; returns the player's pose for that tick. */
  readonly script?: (tick: number, arena: Arena) => PlayerFrame | undefined;
}

export interface TickStats {
  decides: number;
  sightCalls: number;
  pathQueries: number;
}

export interface Arena {
  readonly bots: ReadonlyArray<ArenaBot>;
  readonly perception: PerceptionSystem;
  readonly world: BotWorldView;
  readonly counts: PortCounts;
  readonly transitions: TransitionLog[];
  readonly events: DomainEvent[];
  readonly maxPerTick: TickStats;
  readonly nav: NavGraph;
  readonly player: { feet: Vec3; yaw: number; crouch: boolean; alive: boolean; vitals: Vitals };
  readonly tickIndex: number;
  readonly now: number;
  step(): void;
  run(ticks: number, each?: (a: Arena) => void): void;
  /** One player rifle shot at a bot's chest, no spread. Emits gunfire noise (40 m). */
  playerShoot(bot: ActorId): void;
  /** A player noise at the player's position. */
  playerNoise(radius: number, kind?: 'gunfire' | 'footstep'): void;
  vitalsOf(id: ActorId): Vitals | undefined;
  /** Sets a bot's vitals directly (e.g. low health scenarios). */
  setVitals(id: ActorId, v: Vitals): void;
  bot(id: ActorId): ArenaBot;
  digest(): string;
}

function boxesFor(id: ActorId, side: 'player' | 'bot', feet: Vec3, crouch: boolean): FakeActor {
  const top = crouch ? 1.2 : 1.8;
  const neck = top - 0.4;
  return {
    id,
    side,
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

const inside = (b: Aabb, p: Vec3) =>
  p.x >= b.min.x && p.x <= b.max.x && p.z >= b.min.z && p.z <= b.max.z;

export function createArena(opts: ArenaOptions): Arena {
  const map = opts.map ?? desertCompound;
  const { nav: rawNav, query } = mapWorld(map);
  rawNav.clearReservations();
  const counts = zeroCounts();
  const sight = countingQuery(query, counts);
  const rawBudget: PathBudget = createPathBudget(4);
  const board = createSquadBoard();
  const world = createBotWorldView({
    query: sight,
    nav: countingNav(rawNav, counts),
    budget: countingBudget(rawBudget, counts),
    map,
    board,
  });
  const perception = createPerceptionSystem();
  const scheduler = createScheduler();
  const seed = opts.seed ?? 1;
  const difficulty = opts.difficulty ?? 'normal';
  const bots: ArenaBot[] = [];
  for (let i = 0; i < opts.botCount; i++) {
    const id = `bot-${String(i + 1)}` as ActorId;
    const start =
      opts.botStarts?.[i] ?? map.botSpawns[i % map.botSpawns.length]?.pos ?? vec3(0, 0, 0);
    const yaw = opts.botYaws?.[i] ?? map.botSpawns[i % map.botSpawns.length]?.yaw ?? 0;
    bots.push({
      id,
      index: i,
      brain: createBrain(id, difficulty, createRng(seedFor(seed, i)), { yaw }),
      inv: createInventory(BOT_LOADOUT),
      weaponRng: createRng(seedFor(seed ^ 0x5bd1e995, i)),
      pos: start,
      alive: true,
      crouch: false,
      intent: null,
    });
  }
  const player = {
    feet: opts.playerFeet ?? map.playerSpawns[0]?.pos ?? vec3(0, 0, 40),
    yaw: 0,
    crouch: false,
    alive: opts.playerAlive !== false,
    vitals: PLAYER_START_VITALS,
  };
  const vitals = new Map<ActorId, Vitals>(bots.map((b) => [b.id, BOT_START_VITALS]));
  const transitions: TransitionLog[] = [];
  const events: DomainEvent[] = [];
  const maxPerTick: TickStats = { decides: 0, sightCalls: 0, pathQueries: 0 };
  let tickIndex = 0;
  const byId = new Map(bots.map((b) => [b.id, b]));

  const actors: MutableActorLookup = {
    get(id): CombatActor | undefined {
      if (id === PLAYER_ID) return { id, side: 'player', vitals: player.vitals };
      const v = vitals.get(id);
      return v && byId.has(id) ? { id, side: 'bot', vitals: v } : undefined;
    },
    setVitals(id, v) {
      if (id === PLAYER_ID) {
        if (opts.playerInvulnerable !== true) player.vitals = v;
      } else if (vitals.has(id)) vitals.set(id, v);
    },
  };

  /** World hits from the box query, actor hits from AABBs; nearest wins. */
  const shotQuery: PhysicsQuery = {
    raycast(origin, dir, maxDist, mask, exclude): RayHit | null {
      const w = includes(mask, Layer.WORLD)
        ? query.raycast(origin, dir, maxDist, MASK_WORLD)
        : null;
      const live: FakeActor[] = [];
      if (player.alive) live.push(boxesFor(PLAYER_ID, 'player', player.feet, player.crouch));
      for (const b of bots) if (b.alive) live.push(boxesFor(b.id, 'bot', b.pos, b.crouch));
      const a = createFakePhysics({ actors: live }).raycast(origin, dir, maxDist, mask, exclude);
      if (w === null) return a;
      if (a === null) return w;
      return a.distance < w.distance ? a : w;
    },
    lineOfSight: (a, b) => query.lineOfSight(a, b),
  };

  const eyeOf = (feet: Vec3, crouch: boolean) =>
    vec3(feet.x, feet.y + (crouch ? CROUCH_EYE : STAND_EYE), feet.z);

  function now(): number {
    return tickIndex * STEP_SEC;
  }

  function logTransition(bot: ActorId, t: { from: BotStateName; to: BotStateName; guard: string }) {
    transitions.push({ tick: tickIndex, bot, from: t.from, to: t.to, guard: t.guard });
    events.push({ type: 'BotStateChanged', bot, from: t.from, to: t.to });
  }

  function handle(e: DomainEvent): void {
    events.push(e);
    if (e.type === 'DamageTaken' && byId.has(e.victim)) {
      perception.recordDamage(e.victim, e.dir, now());
    } else if (e.type === 'ShotFired' && byId.has(e.shooter)) {
      perception.noteShot(e.shooter, now());
    } else if (e.type === 'ActorKilled') {
      const b = byId.get(e.victim);
      if (b) {
        b.alive = false;
        perception.markDead(b.id);
        const t = markDead(b.brain, world, now());
        if (t) logTransition(b.id, t);
      } else if (e.victim === PLAYER_ID) {
        player.alive = false;
      }
    }
  }
  const sink = { emit: handle };

  /** Kinematic mover: steps up at most 0.6 m, never enters a solid or a blocker. */
  function move(b: ArenaBot, v: Vec3): void {
    const next = vec3(b.pos.x + v.x * STEP_SEC, b.pos.y, b.pos.z + v.z * STEP_SEC);
    if (next.x === b.pos.x && next.z === b.pos.z) return;
    if ((opts.blockers ?? []).some((x) => inside(x, next))) return;
    const from = vec3(next.x, b.pos.y + PROBE_UP, next.z);
    const hit = query.raycast(from, vec3(0, -1, 0), 50, MASK_WORLD);
    if (hit === null || hit.distance < 1e-6) return; // inside a wall
    const y = hit.point.y;
    if (y - b.pos.y > STEP_UP) return;
    // Body clearance: the segment from knee to head must be free.
    if (!query.lineOfSight(vec3(next.x, y + 0.4, next.z), vec3(next.x, y + 1.7, next.z))) return;
    b.pos = vec3(next.x, y, next.z);
  }

  function selfOf(b: ArenaBot): BotSelfView {
    return {
      id: b.id,
      pos: b.pos,
      eye: eyeOf(b.pos, b.crouch),
      alive: b.alive,
      health: vitals.get(b.id)?.health ?? 0,
      weapon: weaponView(b.inv, now(), false),
    };
  }

  function step(): void {
    const frame = opts.script?.(tickIndex, arena);
    if (frame?.feet) player.feet = frame.feet;
    if (frame?.yaw !== undefined) player.yaw = frame.yaw;
    if (frame?.crouch !== undefined) player.crouch = frame.crouch;
    const t = now();
    const before = { sight: counts.lineOfSight, path: counts.tryConsume - counts.refused };
    rawBudget.resetTick();
    perception.updatePositions(bots.map((b) => ({ id: b.id, feet: b.pos, alive: b.alive })));
    perception.processNoises(t);
    const target = createTargetSample(
      PLAYER_ID,
      player.feet,
      player.crouch ? CROUCH_EYE : STAND_EYE,
      player.alive,
    );
    for (const b of bots) {
      if (!b.alive) continue;
      const vision = {
        rangeM: b.brain.params.visionRangeM,
        fovRad: (110 * Math.PI) / 180,
        vFovHalfRad: Math.PI / 3,
      };
      perception.sense(
        { id: b.id, eye: eyeOf(b.pos, b.crouch), yaw: b.brain.aim.yaw, alive: true },
        target,
        sight,
        vision,
        t,
      );
    }
    let decides = 0;
    for (const b of bots) {
      if (!scheduler.shouldDecide(b.index, tickIndex)) continue;
      decides++;
      const d = decide(b.brain, perception.perceptsFor(b.id, t), selfOf(b), world, t);
      if (d.transition) {
        logTransition(b.id, d.transition);
        if (d.transition.to === 'dead') b.alive = false;
      }
    }
    for (const b of bots) {
      const self = selfOf(b);
      const intent = tickBrain(b.brain, perception.perceptsFor(b.id, t), self, world, STEP_SEC, t);
      b.intent = intent;
      if (!b.alive) continue;
      move(b, intent.move.velocity);
      b.crouch = intent.move.stance === 'crouch';
    }
    for (const b of bots) {
      const intent = b.intent;
      if (intent === null) continue;
      const trigger =
        opts.botsShoot === false ? { fire: false, reload: false, scope: false } : intent.trigger;
      const res = tickWeapon(
        b.inv,
        trigger,
        {
          now: t,
          dt: STEP_SEC,
          moving: false,
          locked: !b.alive,
          shooter: b.id,
          origin: eyeOf(b.pos, b.crouch),
          aimDir: intent.aimDir,
        },
        b.weaponRng,
      );
      for (const shot of res.shots)
        applyResolution(resolveShot(shot, shotQuery, actors), actors, sink);
    }
    perception.updatePlayerView(
      {
        eye: eyeOf(player.feet, player.crouch),
        yaw: player.yaw,
        hFovRad: (100 * Math.PI) / 180,
        alive: player.alive,
      },
      bots.map((b) => ({ id: b.id, chest: vec3(b.pos.x, b.pos.y + 1.0, b.pos.z), alive: b.alive })),
      sight,
      tickIndex,
    );
    maxPerTick.decides = Math.max(maxPerTick.decides, decides);
    maxPerTick.sightCalls = Math.max(maxPerTick.sightCalls, counts.lineOfSight - before.sight);
    maxPerTick.pathQueries = Math.max(
      maxPerTick.pathQueries,
      counts.tryConsume - counts.refused - before.path,
    );
    tickIndex++;
  }

  const arena: Arena = {
    bots,
    perception,
    world,
    counts,
    transitions,
    events,
    maxPerTick,
    nav: rawNav,
    player,
    get tickIndex() {
      return tickIndex;
    },
    get now() {
      return now();
    },
    step,
    run(ticks, each) {
      for (let i = 0; i < ticks; i++) {
        step();
        each?.(arena);
      }
    },
    playerShoot(botId) {
      const b = byId.get(botId);
      if (!b || !player.alive) return;
      const origin = eyeOf(player.feet, player.crouch);
      const chest = vec3(b.pos.x, b.pos.y + 1.0, b.pos.z);
      const rangeM = weaponStats('rifle')?.rangeM ?? 100;
      const shot = {
        shooter: PLAYER_ID,
        weapon: 'rifle' as const,
        origin,
        dir: normalize(sub(chest, origin)),
        rangeM,
        spread: 0,
      };
      applyResolution(resolveShot(shot, shotQuery, actors), actors, sink);
      this.playerNoise(40, 'gunfire');
    },
    playerNoise(radius, kind = 'gunfire') {
      perception.emitNoise({ source: PLAYER_ID, pos: player.feet, radius, kind });
    },
    vitalsOf: (id) => (id === PLAYER_ID ? player.vitals : vitals.get(id)),
    setVitals(id, v) {
      actors.setVitals(id, v);
    },
    bot(id) {
      const b = byId.get(id);
      if (!b) throw new Error(`no bot ${id}`);
      return b;
    },
    digest() {
      const text = JSON.stringify({
        transitions,
        pos: bots.map((b) => [b.pos.x.toFixed(4), b.pos.z.toFixed(4)]),
      });
      return fnv1a(new TextEncoder().encode(text));
    },
  };
  return arena;
}
