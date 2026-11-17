/**
 * Sight sensing (LC-AI-01, BR-AI-10 to BR-AI-15). Cheap range and FOV checks run before any
 * ray, and at most two rays are cast per call: chest first, then head.
 */
import { angleBetween, dirFromYawPitch, vec3, type Vec3 } from '@sz/kernel';
import { finiteNum, finiteVec } from './guards';
import { copyInto, type Memory } from './memory';
import { PERCEPTION_RULES } from './rules';
import type { BotSenseInput, SightPort, TargetSample, VisionParams } from './types';

const MAX_EYE_HEIGHT = 3;

function samplePoints(target: TargetSample): readonly [Vec3, Vec3] | null {
  if (!finiteVec(target.feet) || !finiteNum(target.eyeHeight)) return null;
  const h = target.eyeHeight;
  if (!(h > 0 && h <= MAX_EYE_HEIGHT)) return null;
  const { x, y, z } = target.feet;
  return [vec3(x, y + h * PERCEPTION_RULES.chestFraction, z), vec3(x, y + h, z)];
}

/** True when p passes range, horizontal FOV and vertical FOV from the bot's eye. */
function inView(eye: Vec3, yaw: number, p: Vec3, vision: VisionParams): boolean {
  const dx = p.x - eye.x;
  const dy = p.y - eye.y;
  const dz = p.z - eye.z;
  const flat = Math.hypot(dx, dz);
  if (Math.hypot(flat, dy) > vision.rangeM) return false;
  if (angleBetween(vec3(dx, 0, dz), dirFromYawPitch(yaw, 0)) > vision.fovRad / 2) return false;
  return Math.abs(Math.atan2(dy, flat)) <= vision.vFovHalfRad;
}

function validVision(v: VisionParams): boolean {
  return finiteNum(v.rangeM) && finiteNum(v.fovRad) && finiteNum(v.vFovHalfRad);
}

/**
 * Updates one bot's memory from one sense call and returns the rays cast. A dead bot, a bad
 * input or a dead target casts nothing; a bad input leaves the memory untouched.
 */
export function senseInto(
  m: Memory,
  bot: BotSenseInput,
  target: TargetSample,
  sight: SightPort,
  vision: VisionParams,
  now: number,
): number {
  if (m.dead || !bot.alive || !finiteVec(bot.eye) || !finiteNum(bot.yaw)) return 0;
  if (!finiteNum(now) || !validVision(vision)) return 0;
  let rays = 0;
  let seen: Vec3 | null = null;
  const points = target.alive ? samplePoints(target) : null;
  for (const p of points ?? []) {
    if (!inView(bot.eye, bot.yaw, p, vision)) continue;
    rays++;
    if (sight.lineOfSight(bot.eye, p)) {
      seen = p;
      break;
    }
  }
  const wasVisible = m.visibleNow;
  m.visibleNow = seen !== null;
  if (seen !== null) {
    if (now - m.lastSeenAt > PERCEPTION_RULES.sightGraceSec) m.visibleSince = now;
    m.lastSeenAt = now;
    copyInto(m.lastSeenPoint, seen);
    copyInto(m.lastSeenFeet, target.feet);
    m.version++;
  } else if (wasVisible) {
    m.version++;
  }
  return rays;
}
