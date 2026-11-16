/**
 * Bot forward kinematics (FD-R-6, LC-R-5, BR-R-04). One unit box per part, posed by matrices:
 * world = T(feet) · R_death · R_flinch · Ry(yaw) · local. Parts of one type across all bots share
 * one instance buffer, so 20 bots cost 8 draw calls per near/far set. Allocation-free.
 */
import { RIG, RIG_PARTS, type RigPart } from '@sz/assets/core/rig-parts';
import type { BotSlot } from './actors';
import type { InstanceBuffer } from './buffers';
import { writeColor } from './buffers';
import {
  fromAxisAngle,
  fromTranslation,
  mat4,
  multiply,
  rotateX,
  rotateY,
  scaleBy,
  translate,
  writeMat,
  type Mat4,
} from './pack';
import { FLINCH_RAD, deathProgress, flinchAmount } from './reactions';

export const PART_INDEX: ReadonlyMap<RigPart, number> = new Map(
  RIG_PARTS.map((p, i) => [p.part, i]),
);

export const HIT_TINT = Object.freeze({ r: 1, g: 0.25, b: 0.25, mix: 0.6 });
const GAIT_SWING_RAD = 0.45;
const ARM_PITCH_RAD = 0.9;
const ELBOW_RAD = 0.7;
const CROUCH_THIGH_RAD = 1.3;
const CROUCH_KNEE_RAD = 2.5;
const THIGH_LEN = 0.43;
const UPPER_ARM_LEN = 0.3;

const root = mat4();
const rootTmp = mat4();
const upper = mat4();
const joint = mat4();
const part = mat4();
const rot = mat4();
const SIDES = [-1, 1] as const;

function emit(
  buffers: ReadonlyArray<InstanceBuffer>,
  partIdx: number,
  m: Mat4,
  slot: BotSlot,
): void {
  const b = buffers[partIdx];
  const spec = RIG_PARTS[partIdx];
  if (b === undefined || spec === undefined || b.count >= b.capacity) return;
  const s = spec.size;
  scaleBy(part, m, s.x, s.y, s.z);
  writeMat(b.matrices, b.count, part);
  const [r, g, bl] = spec.color;
  if (slot.hitFlash) {
    const k = HIT_TINT.mix;
    writeColor(
      b,
      b.count,
      r + (HIT_TINT.r - r) * k,
      g + (HIT_TINT.g - g) * k,
      bl + (HIT_TINT.b - bl) * k,
    );
  } else {
    writeColor(b, b.count, r, g, bl);
  }
  b.count += 1;
}

const indexOf = (part: RigPart): number => RIG_PARTS.findIndex((p) => p.part === part);
const TORSO = indexOf('torso');
const HEAD = indexOf('head');
const HELMET = indexOf('helmet');
const UPPER_ARM = indexOf('upperArm');
const FOREARM = indexOf('forearm');
const THIGH = indexOf('thigh');
const SHIN = indexOf('shin');
const RIFLE = indexOf('rifle');
const FOREARM_LEN = RIG_PARTS[FOREARM]?.size.y ?? 0.28;
const SHIN_LEN = RIG_PARTS[SHIN]?.size.y ?? 0.42;

/** Writes all 12 part instances of one bot into `buffers` (indexed like RIG_PARTS). */
export function poseBot(slot: BotSlot, t: number, buffers: ReadonlyArray<InstanceBuffer>): void {
  const death = deathProgress(slot, t);
  const flinch = flinchAmount(slot, t);
  fromTranslation(root, slot.x, slot.y, slot.z);
  if (death > 0) {
    // Tip +Y toward the fall direction: axis = up × fall.
    fromAxisAngle(rot, slot.deathDz, 0, -slot.deathDx, death * (Math.PI / 2));
    multiply(root, root, rot);
  } else if (flinch > 0) {
    fromAxisAngle(rot, slot.flinchDz, 0, -slot.flinchDx, flinch * FLINCH_RAD);
    multiply(root, root, rot);
  }
  rotateY(root, root, slot.yaw);
  const c = Math.min(1, Math.max(0, slot.crouch));
  const hipY = RIG.hipStand + (RIG.hipCrouch - RIG.hipStand) * c;

  translate(upper, root, 0, hipY, 0);
  translate(joint, upper, 0, RIG.torsoHeight / 2, 0);
  emit(buffers, TORSO, joint, slot);
  translate(joint, upper, 0, RIG.headAboveHip, 0);
  emit(buffers, HEAD, joint, slot);
  translate(joint, upper, 0, RIG.helmetAboveHip, 0);
  emit(buffers, HELMET, joint, slot);

  const elbow = ELBOW_RAD * (1 - death);
  for (const side of SIDES) {
    translate(joint, upper, side * RIG.shoulderX, RIG.shoulderAboveHip, 0);
    rotateX(joint, joint, ARM_PITCH_RAD * (1 - death * 0.7));
    translate(rootTmp, joint, 0, -UPPER_ARM_LEN / 2, 0);
    emit(buffers, UPPER_ARM, rootTmp, slot);
    translate(joint, joint, 0, -UPPER_ARM_LEN, 0);
    rotateX(joint, joint, elbow);
    translate(joint, joint, 0, -FOREARM_LEN / 2, 0);
    emit(buffers, FOREARM, joint, slot);
  }
  translate(joint, upper, 0.08, RIG.shoulderAboveHip - 0.2, -0.45);
  emit(buffers, RIFLE, joint, slot);

  const walking = slot.alive && slot.animate && death === 0;
  for (const side of SIDES) {
    const swing = walking ? Math.sin(slot.gait + (side > 0 ? 0 : Math.PI)) * GAIT_SWING_RAD : 0;
    const thighA = swing + CROUCH_THIGH_RAD * c;
    const kneeA = -(walking ? 0.5 * Math.max(0, -swing) : 0) - CROUCH_KNEE_RAD * c - 0.6 * death;
    translate(joint, root, side * RIG.hipX, hipY, 0);
    rotateX(joint, joint, thighA);
    translate(rootTmp, joint, 0, -THIGH_LEN / 2, 0);
    emit(buffers, THIGH, rootTmp, slot);
    translate(joint, joint, 0, -THIGH_LEN, 0);
    rotateX(joint, joint, kneeA);
    translate(joint, joint, 0, -SHIN_LEN / 2, 0);
    emit(buffers, SHIN, joint, slot);
  }
}
