/**
 * Aim helpers (LC-AI-33, BR-AI-55, BR-AI-76). Aim error is drawn inside a cone of half-angle
 * aimErrorRad with exactly two Rng draws, and held as a yaw/pitch offset until the next decide.
 */
import {
  UP,
  clamp,
  cross,
  normalize,
  scale,
  add,
  vec3,
  wrapAngle,
  yawOf,
  type Rng,
  type Vec3,
} from '@sz/kernel';

const X_AXIS: Vec3 = vec3(1, 0, 0);

export function pitchOf(v: Vec3): number {
  return Math.atan2(v.y, Math.hypot(v.x, v.z));
}

/** A unit direction inside the error cone around base. ZERO base gives forward (-Z). */
export function aimWithError(base: Vec3, errorRad: number, rng: Rng): Vec3 {
  const b = normalize(base);
  const r = Math.max(0, errorRad) * rng.next();
  const phi = 2 * Math.PI * rng.next();
  if (b.x === 0 && b.y === 0 && b.z === 0) return vec3(0, 0, -1);
  const u = normalize(cross(b, Math.abs(b.y) < 0.99 ? UP : X_AXIS));
  const w = cross(b, u);
  const off = add(scale(u, Math.cos(phi)), scale(w, Math.sin(phi)));
  return normalize(add(scale(b, Math.cos(r)), scale(off, Math.sin(r))));
}

/** The (yaw, pitch) offset that turns base into dir. */
export function errorOffset(base: Vec3, dir: Vec3): { errYaw: number; errPitch: number } {
  return {
    errYaw: wrapAngle(yawOf(dir) - yawOf(base)),
    errPitch: pitchOf(dir) - pitchOf(base),
  };
}

/** Moves `current` toward `target` by at most maxStep radians (angles wrap for yaw). */
export function turnAngle(current: number, target: number, maxStep: number): number {
  const delta = wrapAngle(target - current);
  return wrapAngle(current + clamp(delta, -maxStep, maxStep));
}

export function stepToward(current: number, target: number, maxStep: number): number {
  return current + clamp(target - current, -maxStep, maxStep);
}
