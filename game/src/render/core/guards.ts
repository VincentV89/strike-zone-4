/**
 * Entry guards for outside ids and numbers (SD-R-3, RD-R-4, LC-R-2). Internal; not re-exported.
 * Every failure keeps a previous value instead of throwing (BR-R-19).
 */
import type { Vec3, WeaponId } from '@sz/kernel';
import { isWeaponId } from '@sz/kernel';
import { WEAPON_TABLE, type WeaponStats } from '@sz/weapons';

export const FOV_MIN_DEG = 60;
export const FOV_MAX_DEG = 110;
export const MAX_DT_SEC = 0.1;

/** v when finite, otherwise prev. */
export function finiteOr(v: unknown, prev: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : prev;
}

export function clampFov(deg: unknown, prev: number): number {
  if (typeof deg !== 'number' || !Number.isFinite(deg)) return prev;
  return Math.min(FOV_MAX_DEG, Math.max(FOV_MIN_DEG, deg));
}

/** Non-finite or non-positive → 1; then clamped to [1, cap]. */
export function safeDpr(v: unknown, cap: number): number {
  const d = typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 1;
  const c = Number.isFinite(cap) && cap >= 1 ? cap : 1;
  return Math.min(c, Math.max(1, d));
}

export function clampAlpha(a: unknown): number {
  if (typeof a !== 'number' || !Number.isFinite(a) || a < 0) return 0;
  return a >= 1 ? 0.999999 : a;
}

export function clampDt(dt: unknown): number {
  if (typeof dt !== 'number' || !Number.isFinite(dt) || dt <= 0) return 0;
  return Math.min(MAX_DT_SEC, dt);
}

/** WEAPON_TABLE row via isWeaponId and Object.hasOwn, so '__proto__' is undefined. */
export function weaponRow(id: unknown): WeaponStats | undefined {
  return typeof id === 'string' && isWeaponId(id) && Object.hasOwn(WEAPON_TABLE, id)
    ? WEAPON_TABLE[id]
    : undefined;
}

export function asWeaponId(id: unknown): WeaponId | undefined {
  return weaponRow(id)?.id;
}

/** True for an object whose x, y and z are finite numbers. */
export function finiteVec(v: unknown): v is Vec3 {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as { x?: unknown; y?: unknown; z?: unknown };
  return (
    typeof o.x === 'number' &&
    Number.isFinite(o.x) &&
    typeof o.y === 'number' &&
    Number.isFinite(o.y) &&
    typeof o.z === 'number' &&
    Number.isFinite(o.z)
  );
}

const EMPTY: ReadonlyArray<never> = Object.freeze([]);

/** The list itself, or an empty list when a hostile caller passed something else. */
export function listOr<T>(xs: ReadonlyArray<T>): ReadonlyArray<T> {
  const ok: boolean = Array.isArray(xs);
  return ok ? xs : EMPTY;
}
