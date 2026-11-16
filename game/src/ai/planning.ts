/**
 * Planner (LC-AI-12, LC-AI-23 to LC-AI-25). Every path query goes through budget.tryConsume()
 * first (BR-AI-71); every selection makes at most AI_RULES.maxSightChecks sight checks.
 */
import { add, distance, dot, horizontal, normalize, scale, sub, vec3, type Vec3 } from '@sz/kernel';
import type { CoverPoint } from '@sz/maps';
import type { FlankPath, Path, RouteId } from '@sz/nav';
import type { DecideContext } from './context';
import { AI_RULES } from './rules';
import type { BotSelfView, BotWorldView } from './types';

export type PathResult =
  | { readonly kind: 'ok'; readonly path: Path }
  | { readonly kind: 'budget' }
  | { readonly kind: 'none' };

export type FlankResult =
  | { readonly kind: 'ok'; readonly path: FlankPath }
  | { readonly kind: 'budget' }
  | { readonly kind: 'none' };

const BUDGET = Object.freeze({ kind: 'budget' } as const);
const NONE = Object.freeze({ kind: 'none' } as const);

/** One budgeted path query. Marks the context so later planning guards are skipped. */
export function planPath(world: BotWorldView, c: DecideContext, to: Vec3): PathResult {
  if (!world.budget.tryConsume()) {
    c.budgetRefused = true;
    return BUDGET;
  }
  const path = world.nav.findPath(c.self.pos, to);
  return path && path.points.length > 0 ? { kind: 'ok', path } : NONE;
}

/** Path query from an explicit position (tick re-plans). */
export function planPathFrom(world: BotWorldView, from: Vec3, to: Vec3): PathResult {
  if (!world.budget.tryConsume()) return BUDGET;
  const path = world.nav.findPath(from, to);
  return path && path.points.length > 0 ? { kind: 'ok', path } : NONE;
}

/** Flank query (LC-AI-24): release own route first, avoid the previous one. */
export function planFlank(
  world: BotWorldView,
  c: DecideContext,
  target: Vec3,
  avoid: RouteId | null,
): FlankResult {
  if (!world.budget.tryConsume()) {
    c.budgetRefused = true;
    return BUDGET;
  }
  world.nav.releaseRoute(c.self.id);
  const fp =
    avoid === null
      ? world.nav.findFlankPath(c.self.pos, target)
      : world.nav.findFlankPath(c.self.pos, target, avoid);
  return fp && fp.points.length > 0 ? { kind: 'ok', path: fp } : NONE;
}

/**
 * Nearest nav node by plain distance. Unlike nav.nearestNode it casts no sight rays, so the
 * decide ray bound (BR-AI-82) holds. O(nodeCount) arithmetic.
 */
export function nearestNodeId(world: BotWorldView, p: Vec3): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  for (let i = 0; i < world.nav.nodeCount; i++) {
    const q = world.nav.node(i).pos;
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2 + (q.z - p.z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export function nearestNodePos(world: BotWorldView, p: Vec3): Vec3 | null {
  const id = nearestNodeId(world, p);
  return id === null ? null : world.nav.node(id).pos;
}

/** Damage probe point (BR-AI-52): 15 m along the damage direction, snapped to a nav node. */
export function probePoint(self: BotSelfView, dir: Vec3, world: BotWorldView): Vec3 {
  const d = normalize(horizontal(dir));
  if (d.x === 0 && d.z === 0) return self.pos;
  const p = add(self.pos, scale(d, AI_RULES.probeDistanceM));
  return nearestNodePos(world, p) ?? p;
}

/** Best guess of where the threat is: sighting, last known feet, then damage probe. */
export function threatPos(c: DecideContext, world: BotWorldView): Vec3 | null {
  if (c.seen) return c.seen.feet;
  if (c.lastKnown) return c.lastKnown.pos;
  if (c.damage) return probePoint(c.self, c.damage.dir, world);
  return null;
}

const eyeOf = (p: Vec3, crouch = false) =>
  vec3(p.x, p.y + (crouch ? AI_RULES.crouchEyeM : AI_RULES.standEyeM), p.z);

function dirTo(from: Vec3, to: Vec3): Vec3 {
  return normalize(horizontal(sub(to, from)));
}

/**
 * chooseCover (LC-AI-23, BR-AI-57): nearest unclaimed points within maxRadius, scored, then the
 * first whose eye point is hidden from the threat eye. At most maxSightChecks checks.
 */
export function chooseCover(
  c: DecideContext,
  threat: Vec3,
  maxRadius: number,
  world: BotWorldView,
  exclude?: string,
): CoverPoint | null {
  const self = c.self;
  const threatEye = eyeOf(threat);
  const toThreat = dirTo(self.pos, threat);
  const cands = world.coverPoints
    .filter((p) => p.id !== exclude)
    .filter((p) => {
      const owner = world.board.coverClaimant(p.id);
      return owner === undefined || owner === self.id;
    })
    .map((p) => ({ p, d: distance(self.pos, p.pos) }))
    .filter((e) => e.d <= maxRadius)
    .sort((a, b) => a.d - b.d || (a.p.id < b.p.id ? -1 : 1))
    .slice(0, AI_RULES.coverCandidates)
    .map(({ p, d }) => {
      const faces = dot(p.facing, dirTo(p.pos, threat)) > 0.3 ? 1 : 0;
      const charges = dot(dirTo(self.pos, p.pos), toThreat) > 0.5 ? 1 : 0;
      return { p, score: -d / 10 + faces - charges };
    })
    .sort((a, b) => b.score - a.score);
  if (cands.length > 0) c.planUsed = true;
  for (const { p } of cands.slice(0, AI_RULES.maxSightChecks)) {
    if (!world.sight.lineOfSight(threatEye, eyeOf(p.pos, p.crouchOnly))) return p;
  }
  return null;
}

export interface RetreatSpot {
  readonly pos: Vec3;
  readonly coverId: string | null;
}

/**
 * chooseRetreat (LC-AI-25, BR-AI-60): cover points and nav nodes 12 to 40 m away on the far
 * side from the threat, preferring one hidden from the threat eye.
 */
export function chooseRetreat(
  c: DecideContext,
  threat: Vec3,
  world: BotWorldView,
): RetreatSpot | null {
  const self = c.self.pos;
  const away = dirTo(threat, self);
  const base = distance(self, threat);
  const spots: RetreatSpot[] = world.coverPoints
    .filter((p) => world.board.coverClaimant(p.id) === undefined)
    .map((p) => ({ pos: p.pos, coverId: p.id }));
  for (let i = 0; i < world.nav.nodeCount; i++)
    spots.push({ pos: world.nav.node(i).pos, coverId: null });
  const ranked = spots
    .map((s) => ({ s, d: distance(self, s.pos) }))
    .filter((e) => e.d >= AI_RULES.retreatMinM && e.d <= AI_RULES.retreatMaxM)
    .filter((e) =>
      away.x === 0 && away.z === 0
        ? true
        : dot(dirTo(self, e.s.pos), away) >= AI_RULES.retreatAwayDot,
    )
    .map((e) => ({ s: e.s, score: distance(e.s.pos, threat) - base }))
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (best === undefined) return null;
  c.planUsed = true;
  const threatEye = eyeOf(threat);
  for (const { s } of ranked.slice(0, AI_RULES.maxSightChecks)) {
    if (!world.sight.lineOfSight(threatEye, eyeOf(s.pos))) return s;
  }
  return best.s;
}
