/**
 * tick (LC-AI-30): runs at 60 Hz for every bot. Steering, facing, aim and the trigger. Fire
 * needs the decide's wantFire AND a visible target from this tick's sense (BR-AI-07), a finished
 * reaction time (BR-AI-53), facing within 4 degrees (BR-AI-54) and an open burst window.
 */
import type { BotPercepts } from '@sz/ai/perception';
import { angleBetween, dirFromYawPitch, wrapAngle, yawOf, type Vec3 } from '@sz/kernel';
import { TIME_EPS, weaponStats } from '@sz/weapons';
import { pitchOf, stepToward, turnAngle } from './aim';
import type { BotBrain } from './brain';
import { finiteNum, usableSelf } from './input-guards';
import { boundIntent, zeroIntent } from './intent-bounds';
import { AI_RULES } from './rules';
import { steer } from './steer';
import type { BotIntent, BotSelfView, BotWorldView } from './types';

const MAX_DT = 0.1;
const SWEEP_RATE = 1.2;

interface Facing {
  readonly yaw: number;
  readonly pitch: number;
}

function desiredFacing(
  brain: BotBrain,
  percepts: BotPercepts,
  self: BotSelfView,
  velocity: Vec3,
  now: number,
): Facing {
  const seen = percepts.visibleTarget;
  const engaging = brain.state === 'engage';
  const target = engaging && seen ? seen.pos : brain.aim.aimAt;
  if (target !== undefined) {
    const d = { x: target.x - self.eye.x, y: target.y - self.eye.y, z: target.z - self.eye.z };
    const withError = engaging && seen !== undefined;
    return {
      yaw: wrapAngle(yawOf(d) + (withError ? brain.aim.errYaw : 0)),
      pitch: pitchOf(d) + (withError ? brain.aim.errPitch : 0),
    };
  }
  if (brain.state === 'investigate' && brain.ctx.phase === 'search' && brain.follower.done) {
    return {
      yaw: wrapAngle(brain.ctx.sweepYaw + AI_RULES.searchSweepRad * Math.sin(now * SWEEP_RATE)),
      pitch: 0,
    };
  }
  if (velocity.x !== 0 || velocity.z !== 0) return { yaw: yawOf(velocity), pitch: 0 };
  return { yaw: brain.aim.yaw, pitch: 0 };
}

/** Burst rhythm (LC-AI-30 burstGate). Weapons still enforces the real fire interval. */
function burstGate(brain: BotBrain, fire: boolean, intervalSec: number, now: number): boolean {
  if (!fire) return false;
  const b = brain.burst;
  if (now < b.firingUntil) return true;
  if (now < b.pauseUntil) return false;
  const [lo, hi] = brain.params.burstShots;
  const shots = Math.min(hi, lo + Math.floor(brain.rng.next() * (hi - lo + 1)));
  b.firingUntil = now + shots * intervalSec - TIME_EPS;
  b.pauseUntil = b.firingUntil + brain.params.burstPauseSec;
  return true;
}

function reacted(brain: BotBrain, percepts: BotPercepts, now: number): boolean {
  const seen = percepts.visibleTarget;
  return (
    seen !== undefined &&
    brain.reaction.forSince === seen.since &&
    now - seen.since >= brain.reaction.sec
  );
}

export function tick(
  brain: BotBrain,
  percepts: BotPercepts,
  self: BotSelfView,
  world: BotWorldView,
  dt: number,
  now: number,
): BotIntent {
  const prevYaw = brain.aim.yaw;
  if (brain.state === 'dead' || !self.alive) return zeroIntent(prevYaw, brain.aim.pitch);
  if (!usableSelf(self) || !finiteNum(dt) || !(dt > 0 && dt <= MAX_DT) || !finiteNum(now)) {
    return zeroIntent(prevYaw, brain.aim.pitch, brain.stance);
  }
  const move = steer(brain, self.pos, world, now);
  const want = desiredFacing(brain, percepts, self, move.velocity, now);
  const step = brain.params.turnRateRad * dt;
  const yaw = turnAngle(prevYaw, want.yaw, step);
  const pitch = stepToward(brain.aim.pitch, want.pitch, step);
  const aimDir = dirFromYawPitch(yaw, pitch);
  const aligned =
    angleBetween(aimDir, dirFromYawPitch(want.yaw, want.pitch)) <= AI_RULES.fireConeRad;
  const wantsFire =
    brain.state === 'engage' && brain.decision.wantFire && reacted(brain, percepts, now) && aligned;
  const interval = weaponStats(self.weapon.equipped)?.fireIntervalSec ?? 0.1;
  const fire = burstGate(brain, wantsFire, interval, now);
  const bounded = boundIntent(
    {
      move,
      yaw,
      pitch,
      aimDir,
      trigger: { fire, reload: brain.decision.wantReload, scope: false },
    },
    { prevYaw, dt, turnRateRad: brain.params.turnRateRad },
  );
  brain.aim.yaw = bounded.yaw;
  brain.aim.pitch = bounded.pitch;
  return bounded;
}
