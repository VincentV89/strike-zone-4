/**
 * Per-state upkeep run at every decide after the transition rows (LC-AI-20 to LC-AI-25).
 * Returns the fire and reload wishes; tick() applies facing, same-tick sight and burst timing.
 */
import { add, distance, dot, horizontal, normalize, scale, sub, vec3, type Vec3 } from '@sz/kernel';
import { weaponStats } from '@sz/weapons';
import { aimWithError, errorOffset } from './aim';
import { failPath, followPath, type BotBrain } from './brain';
import type { DecideContext } from './context';
import {
  chooseCover,
  nearestNodeId,
  nearestNodePos,
  planPath,
  planPathFrom,
  threatPos,
} from './planning';
import { AI_RULES } from './rules';
import type { BotWorldView } from './types';

export interface Wishes {
  readonly wantFire: boolean;
  readonly wantReload: boolean;
}

const IDLE: Wishes = Object.freeze({ wantFire: false, wantReload: false });

// ---- patrol (LC-AI-20, BR-AI-50) ----

function choosePatrol(b: BotBrain, c: DecideContext, w: BotWorldView): void {
  const current = b.goal?.kind === 'patrol' ? b.goal.pointId : b.recentPatrol.at(-1);
  const avoiding = c.now < b.avoid.until;
  const scored = w.patrolPoints
    .filter((p) => p.id !== current)
    .map((p) => {
      const d = distance(c.self.pos, p.pos);
      const toward = normalize(horizontal(sub(p.pos, c.self.pos)));
      const blocked = avoiding && dot(toward, b.avoid.dir) > AI_RULES.stuckAvoidDot;
      const score =
        (blocked ? -3 : 0) +
        -Math.abs(d - AI_RULES.patrolIdealM) / AI_RULES.patrolIdealM -
        (d > AI_RULES.patrolFarM ? 2 : 0) -
        (b.recentPatrol.includes(p.id) ? 1.5 : 0) -
        (w.board.patrolClaims(p.id, b.id) > 0 ? 1 : 0) +
        0.5 * b.rng.next();
      return { p, score };
    })
    .sort((x, y) => y.score - x.score)
    .slice(0, AI_RULES.patrolAttempts);
  for (const { p } of scored) {
    const res = planPath(w, c, p.pos);
    if (res.kind === 'budget') return; // retried at the next decide (BR-AI-71)
    if (res.kind === 'ok') {
      b.goal = { kind: 'patrol', pointId: p.id, pos: p.pos };
      followPath(b, res.path.points, AI_RULES.walkSpeed, c.now);
      w.board.claimPatrol(b.id, p.id);
      b.ctx.phase = 'moving';
      return;
    }
  }
}

function patrol(b: BotBrain, c: DecideContext, w: BotWorldView): Wishes {
  const ctx = b.ctx;
  if (ctx.phase === 'moving' && b.follower.done && b.goal?.kind === 'patrol') {
    b.recentPatrol = [...b.recentPatrol, b.goal.pointId].slice(-AI_RULES.patrolRecent);
    ctx.phase = 'waiting';
    ctx.waitUntil = c.now + b.rng.range(AI_RULES.patrolWaitMinSec, AI_RULES.patrolWaitMaxSec);
  } else if (ctx.phase === 'moving' && (b.follower.failed || b.follower.points.length === 0)) {
    ctx.phase = 'choose';
  } else if (ctx.phase === 'waiting' && c.now >= ctx.waitUntil) {
    ctx.phase = 'choose';
  }
  if (ctx.phase === 'choose') choosePatrol(b, c, w);
  return IDLE;
}

// ---- investigate (LC-AI-21, BR-AI-51) ----

function startSearch(b: BotBrain, c: DecideContext, w: BotWorldView): void {
  const id = nearestNodeId(w, c.self.pos);
  const centre = id === null ? c.self.pos : w.nav.node(id).pos;
  const near = (id === null ? [] : w.nav.edges(id))
    .map((e) => w.nav.node(e.to).pos)
    .filter((p) => distance(p, centre) <= AI_RULES.searchRadiusM);
  const picks: Vec3[] = [];
  for (let i = 0; i < AI_RULES.searchPoints && near.length > 0; i++) {
    const p = b.rng.pick(near);
    if (p === undefined) break;
    picks.push(p);
    near.splice(near.indexOf(p), 1);
  }
  const points = picks.flatMap((p, i) => (i === 0 ? [p] : [centre, p]));
  followPath(b, points, AI_RULES.searchSpeed, c.now);
  b.ctx.phase = 'search';
  b.ctx.searchEndsAt = c.now + AI_RULES.searchSec;
  b.ctx.sweepYaw = b.aim.yaw;
}

function investigate(b: BotBrain, c: DecideContext, w: BotWorldView): Wishes {
  const ctx = b.ctx;
  const newer =
    c.heard && c.heard.at > ctx.targetAt
      ? { pos: c.heard.pos, at: c.heard.at }
      : c.lastKnown && c.lastKnown.at > ctx.targetAt
        ? { pos: c.lastKnown.pos, at: c.lastKnown.at }
        : null;
  if (newer) {
    const res = planPath(w, c, newer.pos);
    if (res.kind !== 'budget') {
      ctx.targetAt = newer.at;
      b.goal = { kind: 'point', pos: newer.pos };
      ctx.phase = 'travel';
      ctx.searchEndsAt = Infinity;
      if (res.kind === 'ok') followPath(b, res.path.points, AI_RULES.runSpeed, c.now);
      else failPath(b);
    }
  }
  if (ctx.phase === 'travel' && b.follower.done) startSearch(b, c, w);
  return IDLE;
}

// ---- engage (LC-AI-22, BR-AI-53 to BR-AI-56) ----

/** BR-AI-56: a move point is used only near a same-level nav node and with knee-height sight. */
function validMovePoint(c: DecideContext, w: BotWorldView, p: Vec3): boolean {
  const n = nearestNodePos(w, p);
  if (n === null) return false;
  if (Math.hypot(n.x - p.x, n.z - p.z) > AI_RULES.strafeNodeM) return false;
  if (Math.abs(n.y - c.self.pos.y) > AI_RULES.strafeLevelM) return false;
  const knee = AI_RULES.kneeHeightM;
  const a = vec3(c.self.pos.x, c.self.pos.y + knee, c.self.pos.z);
  return w.sight.lineOfSight(a, vec3(p.x, c.self.pos.y + knee, p.z));
}

function reposition(b: BotBrain, c: DecideContext, w: BotWorldView, targetFeet: Vec3): void {
  const toTarget = normalize(horizontal(sub(targetFeet, c.self.pos)));
  const d = distance(horizontal(c.self.pos), horizontal(targetFeet));
  const ctx = b.ctx;
  if (d > AI_RULES.engageApproachM) {
    const far = b.goal === undefined || distance(b.goal.pos, targetFeet) > 5;
    if (far || b.follower.done || b.follower.failed) {
      const res = planPath(w, c, targetFeet);
      if (res.kind === 'ok') {
        b.goal = { kind: 'point', pos: targetFeet };
        followPath(b, res.path.points, AI_RULES.runSpeed, c.now);
      }
    }
    return;
  }
  let p: Vec3 | null = null;
  if (d < AI_RULES.engageBackOffM) {
    p = add(c.self.pos, scale(toTarget, -AI_RULES.strafeM));
  } else if (c.now >= ctx.strafeSwitchAt) {
    ctx.strafeSign = ctx.strafeSign === 1 ? -1 : 1;
    ctx.strafeSwitchAt =
      c.now + b.rng.range(AI_RULES.strafeSwitchMinSec, AI_RULES.strafeSwitchMaxSec);
    const side = vec3(-toTarget.z * ctx.strafeSign, 0, toTarget.x * ctx.strafeSign);
    p = add(c.self.pos, scale(side, AI_RULES.strafeM));
  }
  if (p === null) return;
  if (validMovePoint(c, w, p)) {
    b.goal = { kind: 'point', pos: p };
    followPath(b, [p], AI_RULES.strafeSpeed, c.now);
  } else {
    ctx.strafeSwitchAt = c.now; // try the other side at the next decide
    b.follower = { ...b.follower, points: [], done: true };
  }
}

function engage(b: BotBrain, c: DecideContext, w: BotWorldView): Wishes {
  const seen = c.seen;
  const stats = weaponStats(c.self.weapon.equipped);
  const wantReload = c.magazine === 0 && c.reserve > 0;
  if (seen) {
    b.aim.aimAt = seen.pos;
    const base = sub(seen.pos, c.self.eye);
    const err = errorOffset(base, aimWithError(base, b.params.aimErrorRad, b.rng));
    b.aim.errYaw = err.errYaw;
    b.aim.errPitch = err.errPitch;
    reposition(b, c, w, seen.feet);
    const d = distance(c.self.eye, seen.pos);
    const inRange = stats !== undefined && d <= stats.rangeM;
    return { wantFire: c.magazine > 0 && c.hasAmmo && inRange, wantReload };
  }
  b.aim.errYaw = 0;
  b.aim.errPitch = 0;
  b.aim.aimAt = c.lastKnown
    ? vec3(c.lastKnown.pos.x, c.lastKnown.pos.y + AI_RULES.aimHeightM, c.lastKnown.pos.z)
    : undefined;
  b.follower = { ...b.follower, points: [], done: true };
  return { wantFire: false, wantReload };
}

// ---- take cover (LC-AI-23, BR-AI-58) ----

function relocate(b: BotBrain, c: DecideContext, w: BotWorldView): void {
  const ctx = b.ctx;
  const current = b.goal?.kind === 'cover' ? b.goal.coverId : undefined;
  const threat = threatPos(c, w);
  if (ctx.relocations >= AI_RULES.maxRelocations || threat === null || c.planUsed) {
    ctx.compromised = true;
    return;
  }
  const next = chooseCover(c, threat, AI_RULES.coverRadiusM, w, current);
  const res = next ? planPath(w, c, next.pos) : null;
  if (next === null || res === null || res.kind !== 'ok' || !w.board.claimCover(b.id, next.id)) {
    ctx.compromised = true;
    return;
  }
  ctx.relocations++;
  ctx.phase = 'moving';
  b.goal = { kind: 'cover', coverId: next.id, pos: next.pos, crouch: next.crouchOnly };
  followPath(b, res.path.points, AI_RULES.runSpeed, c.now);
}

function takeCover(b: BotBrain, c: DecideContext, w: BotWorldView): Wishes {
  const ctx = b.ctx;
  if (ctx.phase === 'moving' && b.follower.done) {
    ctx.phase = 'holding';
    ctx.holdEndsAt = c.now + b.rng.range(AI_RULES.coverHoldMinSec, AI_RULES.coverHoldMaxSec);
  } else if (ctx.phase === 'holding' && !ctx.compromised && (c.seen || c.freshDamage)) {
    relocate(b, c, w);
  }
  const lk = c.seen?.feet ?? c.lastKnown?.pos;
  b.aim.aimAt = lk ? vec3(lk.x, lk.y + AI_RULES.aimHeightM, lk.z) : undefined;
  b.aim.errYaw = 0;
  b.aim.errPitch = 0;
  const mag = weaponStats(c.self.weapon.equipped)?.magazineSize ?? 0;
  const wantReload = ctx.phase === 'holding' && c.reserve > 0 && c.magazine < mag / 2;
  const crouchGoal = b.goal?.kind === 'cover' && b.goal.crouch;
  b.stance =
    ctx.phase === 'holding' && (crouchGoal || wantReload || c.self.weapon.status === 'reloading')
      ? 'crouch'
      : 'stand';
  return { wantFire: false, wantReload };
}

// ---- retreat (LC-AI-25, BR-AI-60) ----

function retreat(b: BotBrain, c: DecideContext): Wishes {
  const ctx = b.ctx;
  if (ctx.phase === 'moving' && b.follower.done) {
    ctx.phase = 'holding';
    ctx.holdEndsAt = c.now + AI_RULES.retreatHoldSec;
  }
  b.aim.aimAt = undefined;
  const mag = weaponStats(c.self.weapon.equipped)?.magazineSize ?? 0;
  return { wantFire: false, wantReload: c.reserve > 0 && c.magazine < mag };
}

/** Runs the upkeep of the brain's current state. Dead does nothing. */
export function upkeep(b: BotBrain, c: DecideContext, w: BotWorldView): Wishes {
  if (b.state !== 'take-cover') b.stance = 'stand';
  switch (b.state) {
    case 'patrol':
      return patrol(b, c, w);
    case 'investigate':
      return investigate(b, c, w);
    case 'engage':
      return engage(b, c, w);
    case 'take-cover':
      return takeCover(b, c, w);
    case 'flank':
      b.aim.aimAt = undefined;
      return IDLE;
    case 'retreat':
      return retreat(b, c);
    case 'dead':
      return IDLE;
  }
}

/** Re-plan to the current goal, used by steer when a stuck strike or refused budget asks. */
export function replan(b: BotBrain, w: BotWorldView, from: Vec3, now: number): void {
  if (b.goal === undefined) {
    b.follower.pendingPlan = false;
    return;
  }
  const res = planPathFrom(w, from, b.goal.pos);
  if (res.kind === 'budget') return;
  const speed = b.follower.speed;
  if (res.kind === 'ok') {
    const strikes = b.stuck.strikes;
    followPath(b, res.path.points, speed, now);
    b.stuck.strikes = strikes; // same goal: strikes carry over (BR-AI-74)
  } else {
    failPath(b);
  }
}
