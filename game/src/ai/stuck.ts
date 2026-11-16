/**
 * Stuck monitor (LC-AI-32, BR-AI-74). Over each 2 s window the remaining path length must drop
 * by 0.5 m. Strike 1 side-steps for 0.5 s and asks for a re-plan; strike 2 fails the goal.
 */
import { vec3, type Vec3 } from '@sz/kernel';
import type { BotBrain } from './brain';
import { AI_RULES } from './rules';

/** Length still to walk: to the next point, then along the remaining points. */
export function remainingLength(pos: Vec3, points: ReadonlyArray<Vec3>, index: number): number {
  let total = 0;
  let prev = pos;
  for (let i = index; i < points.length; i++) {
    const p = points[i] as Vec3;
    total += Math.hypot(p.x - prev.x, p.z - prev.z);
    prev = p;
  }
  return total;
}

export function updateStuck(brain: BotBrain, remaining: number, travel: Vec3, now: number): void {
  const s = brain.stuck;
  if (!Number.isFinite(s.remainingAtStart)) {
    // First tick on a new path: the window starts here.
    s.windowStart = now;
    s.remainingAtStart = remaining;
    return;
  }
  if (now - s.windowStart < AI_RULES.stuckWindowSec) return;
  if (s.remainingAtStart - remaining < AI_RULES.stuckProgressM) {
    s.strikes++;
    if (s.strikes === 1) {
      const sign = brain.rng.next() < 0.5 ? 1 : -1;
      s.nudgeDir = vec3(-travel.z * sign, 0, travel.x * sign);
      s.nudgeUntil = now + AI_RULES.nudgeSec;
      brain.follower.pendingPlan = true;
    } else {
      brain.follower.failed = true;
      brain.avoid = { dir: travel, until: now + AI_RULES.stuckAvoidSec };
    }
  }
  s.windowStart = now;
  s.remainingAtStart = remaining;
}
