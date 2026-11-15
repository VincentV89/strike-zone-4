import type { Vec3 } from './types';

/** Lengths below this count as zero for normalisation. */
const ZERO_LENGTH = 1e-9;

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export const ZERO: Vec3 = vec3(0, 0, 0);
export const UP: Vec3 = vec3(0, 1, 0);

export function add(a: Vec3, b: Vec3): Vec3 {
  return vec3(a.x + b.x, a.y + b.y, a.z + b.z);
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return vec3(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function scale(v: Vec3, s: number): Vec3 {
  return vec3(v.x * s, v.y * s, v.z * s);
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}

export function lengthSq(v: Vec3): number {
  return dot(v, v);
}

export function length(v: Vec3): number {
  return Math.sqrt(lengthSq(v));
}

export function distanceSq(a: Vec3, b: Vec3): number {
  return lengthSq(sub(a, b));
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.sqrt(distanceSq(a, b));
}

export function isFiniteVec(v: Vec3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

/** Unit vector, or ZERO for a near-zero or non-finite input. */
export function normalize(v: Vec3): Vec3 {
  if (!isFiniteVec(v)) return ZERO;
  const len = length(v);
  if (len < ZERO_LENGTH) return ZERO;
  return scale(v, 1 / len);
}

/** t is not clamped; the renderer passes alpha in [0, 1). */
export function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return vec3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
}

/** The horizontal (y = 0) part of v. */
export function horizontal(v: Vec3): Vec3 {
  return vec3(v.x, 0, v.z);
}
