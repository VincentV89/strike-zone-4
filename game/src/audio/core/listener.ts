/**
 * Listener geometry (business-logic-model-game-audio W9, BR-A-14, BR-A-16, BR-A-17).
 *
 * Kernel convention: right-handed, +Y up, yaw 0 faces -Z, positive yaw turns
 * left. Web Audio uses the same frame, so no axis conversion is applied.
 */
import { UP, clamp, dirFromYawPitch, distance, dot, isFiniteVec, sub, vec3 } from '@sz/kernel';
import type { Vec3 } from '@sz/kernel';
import type { ListenerPose } from './types';

export interface ListenerBasis {
  readonly forward: Vec3;
  readonly right: Vec3;
  readonly up: Vec3;
}

export const DEFAULT_POSE: ListenerPose = Object.freeze({ pos: vec3(0, 0, 0), yaw: 0 });

export function basis(yaw: number): ListenerBasis {
  return {
    forward: dirFromYawPitch(yaw, 0),
    right: vec3(Math.cos(yaw), 0, -Math.sin(yaw)),
    up: UP,
  };
}

/** p in listener space: x < 0 is left, z > 0 is ahead. */
export function listenerSpace(pose: ListenerPose, p: Vec3): Vec3 {
  const b = basis(pose.yaw);
  const d = sub(p, pose.pos);
  return vec3(dot(d, b.right), d.y, dot(d, b.forward));
}

/** -1 = hard left, +1 = hard right, 0 = ahead, behind or on top of the listener. */
export function panOf(pose: ListenerPose, p: Vec3): number {
  const l = listenerSpace(pose, p);
  const h = Math.hypot(l.x, l.z);
  return h < 0.001 ? 0 : clamp(l.x / h, -1, 1);
}

export function inRange(pose: ListenerPose, p: Vec3, maxRangeM: number): boolean {
  return distance(pose.pos, p) <= maxRangeM;
}

/** True for a plain object whose x, y and z are finite numbers. Never coerces. */
export function isFinitePosition(v: unknown): v is Vec3 {
  if (typeof v !== 'object' || v === null) return false;
  const { x, y, z } = v as Partial<Record<'x' | 'y' | 'z', unknown>>;
  return (
    typeof x === 'number' &&
    typeof y === 'number' &&
    typeof z === 'number' &&
    isFiniteVec({ x, y, z })
  );
}

/** BR-A-17: a non-finite position or yaw keeps the previous pose. */
export function acceptPose(prev: ListenerPose, pos: unknown, yaw: unknown): ListenerPose {
  if (!isFinitePosition(pos) || typeof yaw !== 'number' || !Number.isFinite(yaw)) return prev;
  return { pos: vec3(pos.x, pos.y, pos.z), yaw };
}
