/**
 * Path steering (LC-AI-31, BR-AI-70, BR-AI-71). Returns horizontal velocity only; match-loop
 * adds gravity. A path query happens here only for a pending re-plan.
 */
import { vec3, type Stance, type Vec3 } from '@sz/kernel';
import type { BotBrain } from './brain';
import { AI_RULES } from './rules';
import { replan } from './states';
import { remainingLength, updateStuck } from './stuck';
import type { BotMoveIntent, BotWorldView } from './types';

const STILL: Vec3 = Object.freeze(vec3(0, 0, 0));

function arriveRadius(points: ReadonlyArray<Vec3>, index: number): number {
  if (index >= points.length - 1) return AI_RULES.arriveFinalM;
  const p = points[index] as Vec3;
  const q = points[index + 1] as Vec3;
  return Math.hypot(q.x - p.x, q.z - p.z) <= AI_RULES.cornerClusterM
    ? AI_RULES.arriveCornerM
    : AI_RULES.arriveM;
}

const flatDist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);

export function steer(brain: BotBrain, pos: Vec3, world: BotWorldView, now: number): BotMoveIntent {
  const stance: Stance = brain.stance;
  const f = brain.follower;
  if (f.pendingPlan && now >= brain.stuck.nudgeUntil) replan(brain, world, pos, now);
  if (now < brain.stuck.nudgeUntil) {
    const n = brain.stuck.nudgeDir;
    return { velocity: vec3(n.x * AI_RULES.nudgeSpeed, 0, n.z * AI_RULES.nudgeSpeed), stance };
  }
  const fl = brain.follower;
  if (fl.failed || fl.done || fl.points.length === 0) return { velocity: STILL, stance };
  while (fl.index < fl.points.length) {
    const p = fl.points[fl.index] as Vec3;
    if (flatDist(pos, p) > arriveRadius(fl.points, fl.index)) break;
    fl.index++;
  }
  if (fl.index >= fl.points.length) {
    fl.done = true;
    return { velocity: STILL, stance };
  }
  const target = fl.points[fl.index] as Vec3;
  const dx = target.x - pos.x;
  const dz = target.z - pos.z;
  const len = Math.hypot(dx, dz);
  const travel = vec3(dx / len, 0, dz / len);
  updateStuck(brain, remainingLength(pos, fl.points, fl.index), travel, now);
  const speed = Math.min(fl.speed, AI_RULES.maxSpeed);
  return { velocity: vec3(travel.x * speed, 0, travel.z * speed), stance };
}
