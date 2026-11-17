/**
 * FSM guards (LC-AI-12, TRANSITIONS guard column). A guard returns a Plan when it passes and
 * null when it does not. Planning guards pass only when their plan succeeds (BR-AI-45).
 */
import type { Vec3 } from '@sz/kernel';
import type { RouteId } from '@sz/nav';
import type { BotBrain } from './brain';
import type { DecideContext } from './context';
import { chooseCover, chooseRetreat, planFlank, planPath, probePoint, threatPos } from './planning';
import { AI_RULES } from './rules';
import type { BotGoal, BotWorldView, GuardId } from './types';

export interface Plan {
  readonly goal?: BotGoal;
  readonly points?: ReadonlyArray<Vec3>;
  /** The goal is unreachable; the new state leaves through its path-failed guard. */
  readonly failed?: boolean;
  readonly route?: RouteId | null;
  readonly coverId?: string;
  readonly lowHealthRetreat?: boolean;
  /** Stimulus time for Investigate re-targeting. */
  readonly targetAt?: number;
}

export type Guard = (brain: BotBrain, c: DecideContext, world: BotWorldView) => Plan | null;

const PASS: Plan = Object.freeze({});

/** One draw per stimulus key (BR-AI-46). */
function rollCover(brain: BotBrain, key: number): boolean {
  if (brain.rolls.coverKey !== key) {
    brain.rolls.coverKey = key;
    brain.rolls.cover = brain.rng.next() < brain.params.coverChance;
  }
  return brain.rolls.cover;
}

function rollFlank(brain: BotBrain, key: number): boolean {
  if (brain.rolls.flankKey !== key) {
    brain.rolls.flankKey = key;
    brain.rolls.flank = brain.rng.next() < brain.params.flankChance;
  }
  return brain.rolls.flank;
}

function coverPlan(c: DecideContext, world: BotWorldView, radius: number): Plan | null {
  if (c.planUsed) return null;
  const threat = threatPos(c, world);
  if (threat === null) return null;
  const cover = chooseCover(c, threat, radius, world);
  if (cover === null) return null;
  const res = planPath(world, c, cover.pos);
  if (res.kind !== 'ok') return null;
  return {
    goal: { kind: 'cover', coverId: cover.id, pos: cover.pos, crouch: cover.crouchOnly },
    points: res.path.points,
    coverId: cover.id,
  };
}

/** Where Investigate goes: last known, else heard, else the damage probe, else here. */
function investigateTarget(c: DecideContext, world: BotWorldView): { pos: Vec3; at: number } {
  if (c.lastKnown) return { pos: c.lastKnown.pos, at: c.lastKnown.at };
  if (c.heard) return { pos: c.heard.pos, at: c.heard.at };
  if (c.damage) return { pos: probePoint(c.self, c.damage.dir, world), at: c.damage.at };
  return { pos: c.self.pos, at: c.now };
}

/** Investigate plan; a null path still enters Investigate with a failed goal. */
function investigatePlan(
  target: { pos: Vec3; at: number },
  c: DecideContext,
  world: BotWorldView,
): Plan | null {
  const res = planPath(world, c, target.pos);
  if (res.kind === 'budget') return null;
  const goal: BotGoal = { kind: 'point', pos: target.pos };
  if (res.kind === 'none') return { goal, failed: true, targetAt: target.at };
  return { goal, points: res.path.points, targetAt: target.at };
}

function flankPlan(brain: BotBrain, c: DecideContext, world: BotWorldView): Plan | null {
  if (c.seen || !c.lastKnown || !rollFlank(brain, c.lastKnown.at)) return null;
  const res = planFlank(world, c, c.lastKnown.pos, brain.lastFlankRoute);
  if (res.kind === 'budget') return null;
  if (res.kind === 'none') {
    brain.rolls.flank = false; // no flank exists for this loss of sight; do not retry it
    return null;
  }
  const route = res.path.routeId;
  return {
    goal: { kind: 'route', routeId: route, pos: c.lastKnown.pos },
    points: res.path.points,
    route,
  };
}

const lostLongEnough = (c: DecideContext) => !c.seen && c.lostFor >= AI_RULES.lostSightSec;
const underFire = (c: DecideContext) => c.seen !== undefined || c.freshDamage;
const holdEnded = (b: BotBrain, now: number) =>
  b.ctx.phase === 'holding' && now >= b.ctx.holdEndsAt;

function retreatDone(b: BotBrain, c: DecideContext): boolean {
  return holdEnded(b, c.now) || b.follower.failed || c.now - b.stateSince >= AI_RULES.retreatMaxSec;
}

const guards: Record<GuardId, Guard> = {
  died: (_b, c) => (c.self.alive ? null : PASS),
  'target-seen': (_b, c) => (c.seen ? PASS : null),
  'damaged-seek-cover': (b, c, w) => {
    const d = c.damage;
    if (!c.freshDamage || d === undefined || !rollCover(b, d.at)) return null;
    return coverPlan(c, w, AI_RULES.coverRadiusM);
  },
  stimulus: (_b, c, w) => {
    if (!c.newNoise && !c.freshDamage) return null;
    const noise = c.newNoise && c.heard ? c.heard : undefined;
    const dmg = c.freshDamage && c.damage ? c.damage : undefined;
    const useNoise = noise !== undefined && (dmg === undefined || noise.at >= dmg.at);
    const target = useNoise
      ? { pos: noise.pos, at: noise.at }
      : dmg
        ? { pos: probePoint(c.self, dmg.dir, w), at: dmg.at }
        : null;
    if (target === null) return null;
    const res = planPath(w, c, target.pos);
    if (res.kind !== 'ok') return null;
    return {
      goal: { kind: 'point', pos: target.pos },
      points: res.path.points,
      targetAt: target.at,
    };
  },
  'search-timeout': (b, c) =>
    (b.ctx.phase === 'search' && c.now >= b.ctx.searchEndsAt) ||
    b.follower.failed ||
    c.now - b.stateSince >= AI_RULES.investigateMaxSec
      ? PASS
      : null,
  disadvantaged: (b, c, w) => {
    const low = c.lowHealth && !b.retreatedLowHealth;
    if ((!low && c.hasAmmo) || !underFire(c) || c.planUsed) return null;
    const threat = threatPos(c, w);
    if (threat === null) return null;
    const spot = chooseRetreat(c, threat, w);
    if (spot === null) return null;
    const res = planPath(w, c, spot.pos);
    if (res.kind !== 'ok') return null;
    return {
      goal: { kind: 'retreat', pos: spot.pos, coverId: spot.coverId },
      points: res.path.points,
      ...(spot.coverId === null ? {} : { coverId: spot.coverId }),
      lowHealthRetreat: low,
    };
  },
  'reload-under-fire': (_b, c, w) =>
    c.magazine === 0 && c.reserve > 0 && underFire(c)
      ? coverPlan(c, w, AI_RULES.coverReloadRadiusM)
      : null,
  'target-lost-flank': (b, c, w) => (lostLongEnough(c) ? flankPlan(b, c, w) : null),
  'target-lost': (_b, c, w) =>
    lostLongEnough(c) ? investigatePlan(investigateTarget(c, w), c, w) : null,
  'cover-exit-engage': (b, c) => {
    if (!c.seen) return null;
    if (b.follower.failed && b.ctx.phase === 'moving') return PASS;
    if (b.ctx.phase !== 'holding') return null;
    return (c.now >= b.ctx.holdEndsAt && c.magazine > 0) || b.ctx.compromised ? PASS : null;
  },
  'cover-exit-flank': (b, c, w) =>
    holdEnded(b, c.now) && c.magazine > 0 ? flankPlan(b, c, w) : null,
  'cover-exit-investigate': (b, c, w) => {
    if (c.seen) return null;
    const leave =
      holdEnded(b, c.now) ||
      (b.follower.failed && b.ctx.phase === 'moving') ||
      (b.ctx.phase === 'holding' && b.ctx.compromised);
    return leave ? investigatePlan(investigateTarget(c, w), c, w) : null;
  },
  'flank-ended': (b, c, w) =>
    b.follower.done || b.follower.failed || c.now - b.stateSince >= AI_RULES.flankMaxSec
      ? investigatePlan(investigateTarget(c, w), c, w)
      : null,
  'retreat-done-seen': (b, c) => (retreatDone(b, c) && c.seen && c.hasAmmo ? PASS : null),
  'retreat-done-known': (b, c, w) =>
    retreatDone(b, c) && !c.seen && c.lastKnown && c.hasAmmo
      ? investigatePlan({ pos: c.lastKnown.pos, at: c.lastKnown.at }, c, w)
      : null,
  'retreat-done-idle': (b, c) =>
    retreatDone(b, c) && (!c.hasAmmo || (!c.seen && !c.lastKnown)) ? PASS : null,
};

/** Frozen guard map (ADR-AI-2), keyed by GuardId through a Map (SEC-AI-22). */
export const GUARDS: ReadonlyMap<GuardId, Guard> = new Map(
  (Object.keys(guards) as GuardId[]).map((k) => [k, guards[k]] as const),
);

export const GUARD_IDS: ReadonlyArray<GuardId> = Object.freeze(Object.keys(guards) as GuardId[]);
