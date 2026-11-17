import { UP, add, cross, normalize, scale, vec3, type Rng, type Vec3 } from '@sz/kernel';
import type { WeaponInventory } from './types';
import type { WeaponStats } from './weapon-table';

const X_AXIS = vec3(1, 0, 0);
const TWO_PI = Math.PI * 2;

/**
 * BR-W-61: min(spreadMax, (scoped ? spreadScoped : spreadBase) + movePenalty + bloom),
 * taken before the current shot adds its bloom.
 */
export function currentSpread(inv: WeaponInventory, stats: WeaponStats, moving: boolean): number {
  const base = inv.scoped && stats.spreadScoped !== null ? stats.spreadScoped : stats.spreadBase;
  const move = moving ? stats.spreadMovePenalty : 0;
  return Math.min(stats.spreadMax, base + move + inv.bloom);
}

/**
 * A unit vector inside the cone of half-angle `s` around the unit vector `d`, uniform over
 * the cone's cross-section. Always draws exactly two Rng values (BR-W-83), even for s = 0,
 * so tuning never shifts the random sequence. Returns `d` itself when the angle is zero.
 */
export function sampleCone(d: Vec3, s: number, rng: Rng): Vec3 {
  const r1 = rng.next();
  const r2 = rng.next();
  const theta = s > 0 ? s * Math.sqrt(r1) : 0;
  if (theta === 0) return d;
  const helper = Math.abs(d.y) < 0.99 ? UP : X_AXIS;
  const u = normalize(cross(d, helper));
  const v = cross(u, d);
  const phi = TWO_PI * r2;
  const radial = add(scale(u, Math.cos(phi)), scale(v, Math.sin(phi)));
  return normalize(add(scale(d, Math.cos(theta)), scale(radial, Math.sin(theta))));
}

/** Sideways kick from the third per-shot draw u in [0, 1): kickYawMax × (2u − 1) (BR-W-70). */
export function yawKick(stats: WeaponStats, u: number): number {
  return stats.kickYawMax * (2 * u - 1);
}
