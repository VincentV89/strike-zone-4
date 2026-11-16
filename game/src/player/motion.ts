import {
  PLAYER_ID,
  ZERO,
  isFiniteVec,
  wrapAngle,
  type ActorId,
  type CharacterMover,
  type Stance,
  type Vec3,
} from '@sz/kernel';
import { finiteOr } from './guards';
import { MOVEMENT_TUNING } from './tuning';
import type { PlayerMotionView, PlayerPose } from './types';

/**
 * The player's movement state (FD-P-1): no health, armor or weapons.
 * One instance per Simulation, reset in place by placePlayer. Only the player
 * functions mutate it; everything else reads it through motionView().
 */
export interface PlayerMotion {
  readonly id: ActorId;
  position: Vec3;
  prevPosition: Vec3;
  velocity: Vec3;
  yaw: number;
  pitch: number;
  stance: Stance;
  wantsCrouch: boolean;
  grounded: boolean;
  eyeHeight: number;
  strideAccum: number;
  airTimeSec: number;
  /** False until placePlayer succeeds; stepMovement no-ops before that (BR-P-44). */
  placed: boolean;
}

function resetMotion(motion: PlayerMotion, position: Vec3, yaw: number): void {
  motion.position = position;
  motion.prevPosition = position;
  motion.velocity = ZERO;
  motion.yaw = wrapAngle(yaw);
  motion.pitch = 0;
  motion.stance = 'stand';
  motion.wantsCrouch = false;
  motion.grounded = false;
  motion.eyeHeight = MOVEMENT_TUNING.standEyeHeight;
  motion.strideAccum = 0;
  motion.airTimeSec = 0;
}

/**
 * Creates an unplaced motion record at the pose. A non-finite pose becomes the origin
 * with yaw 0; the record still needs placePlayer before it moves.
 */
export function createPlayerMotion(pose: PlayerPose): PlayerMotion {
  const motion: PlayerMotion = {
    id: PLAYER_ID,
    position: ZERO,
    prevPosition: ZERO,
    velocity: ZERO,
    yaw: 0,
    pitch: 0,
    stance: 'stand',
    wantsCrouch: false,
    grounded: false,
    eyeHeight: MOVEMENT_TUNING.standEyeHeight,
    strideAccum: 0,
    airTimeSec: 0,
    placed: false,
  };
  resetMotion(motion, isFiniteVec(pose.position) ? pose.position : ZERO, finiteOr(pose.yaw, 0));
  return motion;
}

/**
 * Puts the player at a spawn pose and fully resets motion state (spawn, restart and
 * out-of-world respawn). Returns false and leaves the record untouched when the pose
 * position is not finite; `placed` then keeps its previous value.
 */
export function placePlayer(
  motion: PlayerMotion,
  mover: CharacterMover,
  pose: PlayerPose,
): boolean {
  if (!isFiniteVec(pose.position)) return false;
  mover.teleport(motion.id, pose.position);
  mover.setStance(motion.id, 'stand');
  resetMotion(motion, pose.position, finiteOr(pose.yaw, 0));
  motion.placed = true;
  return true;
}

/** Read-only copy for SimSnapshot.player. */
export function motionView(motion: PlayerMotion): PlayerMotionView {
  return {
    id: motion.id,
    position: motion.position,
    prevPosition: motion.prevPosition,
    velocity: motion.velocity,
    yaw: motion.yaw,
    pitch: motion.pitch,
    stance: motion.stance,
    eyeHeight: motion.eyeHeight,
    grounded: motion.grounded,
  };
}

/** Camera eye point: on the capsule axis, never offset toward a wall (BR-P-43). */
export function eyePosition(motion: PlayerMotion): Vec3 {
  const p = motion.position;
  return { x: p.x, y: p.y + motion.eyeHeight, z: p.z };
}
