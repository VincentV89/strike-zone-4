/**
 * Input guards at the WASM boundary (SD-WM-1). Pure, never throw, never coerce. Internal;
 * not re-exported from the barrel.
 */
import type { Vec3 } from '@sz/kernel';
import { LAYER_ALL } from './groups';

export const MAX_RAY_DIST = 512;
export const MAX_COORD = 10_000;
export const MAX_DT = 0.25;
const MIN_DIR_LENGTH = 1e-9;

export function okVec(v: Vec3): boolean {
  return (
    Number.isFinite(v.x) &&
    Number.isFinite(v.y) &&
    Number.isFinite(v.z) &&
    Math.abs(v.x) <= MAX_COORD &&
    Math.abs(v.y) <= MAX_COORD &&
    Math.abs(v.z) <= MAX_COORD
  );
}

/** Unit direction, or null for a non-finite or near-zero vector. */
export function unitDir(v: Vec3): Vec3 | null {
  if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) return null;
  const len = Math.hypot(v.x, v.y, v.z);
  if (!Number.isFinite(len) || len < MIN_DIR_LENGTH) return null;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/** Finite positive distance clamped to MAX_RAY_DIST, or null. */
export function rayDist(d: number): number | null {
  return Number.isFinite(d) && d > 0 ? Math.min(d, MAX_RAY_DIST) : null;
}

export function okDt(dt: number): boolean {
  return Number.isFinite(dt) && dt > 0 && dt <= MAX_DT;
}

/** Kernel layers only; 0 means "nothing selectable". */
export function clampMask(mask: number): number {
  return Number.isInteger(mask) ? mask & LAYER_ALL : 0;
}

/** Non-finite velocity components are treated as zero. */
export function safeVelocity(v: Vec3): Vec3 {
  const f = (n: number) => (Number.isFinite(n) && Math.abs(n) <= MAX_COORD ? n : 0);
  return { x: f(v.x), y: f(v.y), z: f(v.z) };
}

export function okSize(n: number, max: number): boolean {
  return Number.isFinite(n) && n > 0 && n <= max;
}
