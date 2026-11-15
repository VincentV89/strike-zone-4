import type { Vec3 } from './types';
import { dot, normalize, vec3 } from './vec3';

/*
 * Coordinate convention (BR-K-15): right-handed, +Y up, 1 unit = 1 m.
 * Yaw 0 faces -Z, positive yaw turns left (counter-clockwise from above),
 * positive pitch looks up. Matches Three.js Object3D.rotation.y.
 */

const TWO_PI = Math.PI * 2;

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Clamps v to [lo, hi]. NaN is returned as lo. */
export function clamp(v: number, lo: number, hi: number): number {
  if (Number.isNaN(v)) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}

/** Maps an angle into (-π, π]. A non-finite input returns 0. */
export function wrapAngle(theta: number): number {
  if (!Number.isFinite(theta)) return 0;
  let a = theta % TWO_PI; // (-2π, 2π)
  if (a <= -Math.PI) a += TWO_PI;
  else if (a > Math.PI) a -= TWO_PI;
  return a;
}

export function dirFromYawPitch(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  return vec3(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}

/** Inverse of the horizontal part of dirFromYawPitch. */
export function yawOf(v: Vec3): number {
  return Math.atan2(-v.x, -v.z);
}

/** Angle in [0, π] between a and b; 0 if either is zero. */
export function angleBetween(a: Vec3, b: Vec3): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (dot(na, na) === 0 || dot(nb, nb) === 0) return 0;
  return Math.acos(clamp(dot(na, nb), -1, 1));
}
