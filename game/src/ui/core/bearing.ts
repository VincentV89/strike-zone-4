/**
 * Damage bearing and radar projection (business-logic-model-ui-hud §9.1, §9.2).
 * Kernel convention: yaw 0 faces -Z and positive yaw turns left. Forward f = (-sin y, 0, -cos y),
 * right r = (cos y, 0, -sin y).
 */
import type { Vec3 } from '@sz/kernel';

/** Normalises degrees to [0, 360). */
export function normDeg(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const d = deg % 360;
  const n = d < 0 ? d + 360 : d;
  return n >= 360 ? 0 : n;
}

/**
 * Screen angle of a damage arc: 0 = top, clockwise. `dir` is DamageTaken.dir, the unit vector
 * from the victim toward the attacker (FD-UI-9), so an attacker behind gives 180°.
 */
export function damageArcAngle(yaw: number, dir: Pick<Vec3, 'x' | 'z'>): number {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const alongRight = dir.x * c - dir.z * s;
  const alongForward = -dir.x * s - dir.z * c;
  return normDeg((Math.atan2(alongRight, alongForward) * 180) / Math.PI);
}

/** World bearing of a direction, for merging arcs from the same side (§7.2). */
export function worldBearingDeg(dir: Pick<Vec3, 'x' | 'z'>): number {
  return normDeg((Math.atan2(dir.x, -dir.z) * 180) / Math.PI);
}

/** Smallest absolute difference between two angles in degrees, 0..180. */
export function angleDiffDeg(a: number, b: number): number {
  const d = Math.abs(normDeg(a) - normDeg(b));
  return d > 180 ? 360 - d : d;
}

export interface RadarPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Projects a world point to radar pixels: the player at the centre (c, c), forward up.
 * This is the same matrix as the SVG group `translate(c c) scale(k) rotate(yawDeg)
 * translate(-x -z)`.
 */
export function worldToRadar(
  p: Pick<Vec3, 'x' | 'z'>,
  player: Pick<Vec3, 'x' | 'z'>,
  yaw: number,
  centre: number,
  pxPerM: number,
): RadarPoint {
  const rx = p.x - player.x;
  const rz = p.z - player.z;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const sx = rx * c - rz * s;
  const sy = rx * s + rz * c;
  return { x: centre + pxPerM * sx, y: centre + pxPerM * sy };
}
