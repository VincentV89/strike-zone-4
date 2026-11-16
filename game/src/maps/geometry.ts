/**
 * Oriented-box maths shared with the physics adapter (business-logic-model-world-maps,
 * "Authoring helpers"). Rotation is yaw about +Y, then pitch about the box's local X axis:
 * q = qYaw × qPitch, so a world vector is v' = Ry(yaw) · Rx(pitch) · v.
 */
import { add, vec3, type Vec3 } from '@sz/kernel';
import type { Solid } from './types';

export interface Quat {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

/** Quaternion for yaw about +Y followed by pitch about the local X axis. */
export function quatFromYawPitch(yaw: number, pitch: number): Quat {
  const cy = Math.cos(yaw / 2);
  const sy = Math.sin(yaw / 2);
  const cp = Math.cos(pitch / 2);
  const sp = Math.sin(pitch / 2);
  return { x: cy * sp, y: sy * cp, z: -sy * sp, w: cy * cp };
}

/** Rotates a local vector into world space: Ry(yaw) · Rx(pitch) · v. */
export function rotateYawPitch(v: Vec3, yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  // Rx(pitch): +pitch turns local -Z (forward) toward +Y (look up).
  const x1 = v.x;
  const y1 = v.y * cp - v.z * sp;
  const z1 = v.y * sp + v.z * cp;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  // Ry(yaw): +yaw turns -Z toward -X (turn left), matching the kernel convention.
  return vec3(x1 * cy + z1 * sy, y1, -x1 * sy + z1 * cy);
}

const SIGNS = [-1, 1] as const;

/** The 8 world-space corners of a solid, in a fixed order. */
export function solidCorners(s: Solid): ReadonlyArray<Vec3> {
  const out: Vec3[] = [];
  for (const sx of SIGNS) {
    for (const sy of SIGNS) {
      for (const sz of SIGNS) {
        const local = vec3(sx * s.half.x, sy * s.half.y, sz * s.half.z);
        out.push(add(s.center, rotateYawPitch(local, s.yaw, s.pitch)));
      }
    }
  }
  return out;
}

/** Top of a solid: the highest corner y. */
export function solidTop(s: Solid): number {
  let top = -Infinity;
  for (const c of solidCorners(s)) top = Math.max(top, c.y);
  return top;
}

/**
 * The 4 bottom-face corners projected to (x, z), in loop order. For an unpitched box
 * this is its plan-view rectangle.
 */
export function footprint2d(s: Solid): ReadonlyArray<{ readonly x: number; readonly z: number }> {
  const local = [
    vec3(-s.half.x, -s.half.y, -s.half.z),
    vec3(s.half.x, -s.half.y, -s.half.z),
    vec3(s.half.x, -s.half.y, s.half.z),
    vec3(-s.half.x, -s.half.y, s.half.z),
  ];
  return local.map((l) => {
    const w = add(s.center, rotateYawPitch(l, s.yaw, s.pitch));
    return { x: w.x, z: w.z };
  });
}
