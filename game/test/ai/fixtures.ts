// Fake world and brain fixtures for bot-ai unit tests. Pure TypeScript, no map, no Rapier.
import {
  createBotWorldView,
  createBrain,
  createSquadBoard,
  type BotBrain,
  type BotSelfView,
  type BotWorldView,
  type SquadBoard,
} from '@sz/ai';
import type { BotPercepts } from '@sz/ai/perception';
import {
  vec3,
  type ActorId,
  type BotStateName,
  type Difficulty,
  type Rng,
  type Vec3,
} from '@sz/kernel';
import type { CoverPoint, PatrolPoint } from '@sz/maps';
import type { FlankPath, NavGraph, NavNode, Path, PathBudget, RouteId } from '@sz/nav';
import {
  countingBudget,
  countingNav,
  countingQuery,
  zeroCounts,
  type PortCounts,
} from '../support/counting-ports';

export const BOT = 'bot-1' as ActorId;
export const NOW = 10;

/** An Rng whose next() always returns v; range returns the low end; pick the first item. */
export function fixedRng(v: number): Rng {
  return {
    seed: 0,
    next: () => v,
    range: (a, b) => Math.min(a, b),
    pick: (xs) => xs[0],
  };
}

export interface FakeNavOptions {
  readonly pathNone?: boolean;
  readonly flankNone?: boolean;
  readonly routeId?: RouteId | null;
}

/** Grid nav from -40 to 40 m every 4 m at y = 0. Paths are straight lines. */
export function fakeNav(opts: FakeNavOptions = {}): NavGraph & { reserved: Map<ActorId, RouteId> } {
  const nodes: NavNode[] = [];
  for (let x = -40; x <= 40; x += 4)
    for (let z = -40; z <= 40; z += 4)
      nodes.push({
        index: nodes.length,
        id: `n${String(nodes.length)}`,
        pos: vec3(x, 0, z),
        tags: [],
      });
  const reserved = new Map<ActorId, RouteId>();
  const line = (from: Vec3, to: Vec3): Path => ({
    nodes: [],
    points: [from, to],
    length: Math.hypot(to.x - from.x, to.z - from.z),
  });
  const edgesOf = (id: number) =>
    nodes
      .filter(
        (n) =>
          n.index !== id &&
          Math.hypot(n.pos.x - (nodes[id]?.pos.x ?? 0), n.pos.z - (nodes[id]?.pos.z ?? 0)) <= 4.01,
      )
      .map((n) => ({ to: n.index, cost: 4, kind: 'walk' as const }));
  return {
    reserved,
    nodeCount: nodes.length,
    node: (id) => nodes[id] ?? (nodes[0] as NavNode),
    nodeByName: () => undefined,
    edges: edgesOf,
    nearestNode: () => 0,
    findPath: (from, to) => (opts.pathNone === true ? null : line(from, to)),
    findFlankPath(from, to): FlankPath | null {
      if (opts.flankNone === true) return null;
      const mid = vec3((from.x + to.x) / 2 + 10, 0, (from.z + to.z) / 2);
      return {
        nodes: [],
        points: [from, mid, to],
        length: 40,
        routeId: opts.routeId === undefined ? 'east' : opts.routeId,
        sharedFraction: 0.2,
      };
    },
    reserveRoute: (bot, route) => {
      reserved.set(bot, route);
    },
    releaseRoute: (bot) => {
      reserved.delete(bot);
    },
    clearReservations: () => {
      reserved.clear();
    },
    reservations: () => new Map(reserved),
    isReachable: () => true,
    routes: () => [],
  };
}

export function budgetOf(max = 4): PathBudget & { used: () => number } {
  let used = 0;
  return {
    maxQueriesPerTick: max,
    tryConsume() {
      if (used >= max) return false;
      used++;
      return true;
    },
    resetTick() {
      used = 0;
    },
    used: () => used,
  };
}

export const COVER: ReadonlyArray<CoverPoint> = [
  { id: 'cover-a', pos: vec3(5, 0, 5), facing: vec3(0, 0, -1), crouchOnly: false },
  { id: 'cover-b', pos: vec3(-5, 0, 6), facing: vec3(0, 0, -1), crouchOnly: true },
  { id: 'cover-c', pos: vec3(0, 0, 9), facing: vec3(0, 0, -1), crouchOnly: false },
];

export const PATROL: ReadonlyArray<PatrolPoint> = [
  { id: 'patrol-a', pos: vec3(20, 0, 0) },
  { id: 'patrol-b', pos: vec3(-20, 0, 0) },
  { id: 'patrol-c', pos: vec3(0, 0, 20) },
  { id: 'patrol-d', pos: vec3(0, 0, -36) },
];

export interface FakeWorldOptions extends FakeNavOptions {
  /** lineOfSight result; default false (everything is hidden, so cover always qualifies). */
  readonly sight?: boolean | ((a: Vec3, b: Vec3) => boolean);
  readonly cover?: ReadonlyArray<CoverPoint>;
  readonly patrol?: ReadonlyArray<PatrolPoint>;
  readonly budget?: number;
}

export interface FakeWorld {
  readonly world: BotWorldView;
  readonly nav: ReturnType<typeof fakeNav>;
  readonly budget: ReturnType<typeof budgetOf>;
  readonly board: SquadBoard;
  readonly counts: PortCounts;
}

export function fakeWorld(opts: FakeWorldOptions = {}): FakeWorld {
  const counts = zeroCounts();
  const s = opts.sight ?? false;
  const sightFn = typeof s === 'function' ? s : () => s;
  const nav = fakeNav(opts);
  const budget = budgetOf(opts.budget ?? 4);
  const board = createSquadBoard();
  const world = createBotWorldView({
    query: countingQuery({ raycast: () => null, lineOfSight: sightFn }, counts),
    nav: countingNav(nav, counts),
    budget: countingBudget(budget, counts),
    map: { coverPoints: opts.cover ?? COVER, patrolPoints: opts.patrol ?? PATROL },
    board,
  });
  return { world, nav, budget, board, counts };
}

export function selfView(over: Partial<BotSelfView> = {}): BotSelfView {
  return {
    id: BOT,
    pos: vec3(0, 0, 0),
    eye: vec3(0, 1.62, 0),
    alive: true,
    health: 100,
    weapon: { equipped: 'rifle', magazine: 30, reserve: 90, status: 'ready' },
    ...over,
  };
}

export interface BrainSetup {
  readonly state?: BotStateName;
  readonly since?: number;
  readonly rng?: Rng;
  readonly difficulty?: Difficulty;
}

export function brainIn(setup: BrainSetup = {}): BotBrain {
  const b = createBrain(BOT, setup.difficulty ?? 'normal', setup.rng ?? fixedRng(0.5));
  b.state = setup.state ?? 'patrol';
  b.stateSince = setup.since ?? 0;
  if (b.state === 'investigate') b.ctx.phase = 'travel';
  if (b.state === 'take-cover' || b.state === 'flank' || b.state === 'retreat')
    b.ctx.phase = 'moving';
  if (b.state === 'engage') b.ctx.phase = 'fighting';
  return b;
}

// ---- percept builders (frozen like the real ones) ----

const TARGET_FEET = vec3(0, 0, -10);

export const P = {
  none: Object.freeze({}) as BotPercepts,
  seen: (since = NOW - 1): BotPercepts =>
    Object.freeze({
      visibleTarget: { pos: vec3(0, 1.0, -10), feet: TARGET_FEET, since },
      lastKnown: { pos: TARGET_FEET, at: NOW },
    }),
  lost: (at = NOW - 2): BotPercepts => Object.freeze({ lastKnown: { pos: TARGET_FEET, at } }),
  damaged: (at = NOW - 0.2): BotPercepts =>
    Object.freeze({ recentDamageFrom: { dir: vec3(0, 0, -1), at } }),
  heard: (at = NOW - 0.1): BotPercepts =>
    Object.freeze({ heardNoise: { pos: vec3(8, 0, 8), at, kind: 'gunfire' as const } }),
  merge: (...ps: BotPercepts[]): BotPercepts =>
    Object.freeze(Object.assign({}, ...ps) as BotPercepts),
};
