/**
 * Harness aiming for win scenarios (security-design-verification-suite SD-VS-9, SEC-VS-24).
 *
 * DISCLOSURE: this file reads bot positions from window.__strikezone.snapshot() to steer the
 * INJECTED player. It is test-harness code only. The data flows into inject() look deltas for
 * the player and nowhere else; nothing here can reach bot-ai. Rows that use it are `injected`.
 *
 * Kernel convention: yaw 0 faces -Z, positive yaw turns left, positive pitch looks up, so the
 * view direction is (-sin y cos p, sin p, -cos y cos p).
 */

export interface V3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Wraps an angle to (-π, π]. */
export function wrapAngle(a: number): number {
  const t = (a + Math.PI) % (2 * Math.PI);
  return (t <= 0 ? t + 2 * Math.PI : t) - Math.PI;
}

/** Yaw and pitch that look from `eye` at `target`. */
export function lookAt(eye: V3, target: V3): { readonly yaw: number; readonly pitch: number } {
  const dx = target.x - eye.x;
  const dy = target.y - eye.y;
  const dz = target.z - eye.z;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

/**
 * Look delta in pixels that turns the view by (dYaw, dPitch), given measured gains in radians
 * per pixel (sign included). Clamped so one step never exceeds `maxPx`.
 */
export function lookDelta(
  dYaw: number,
  dPitch: number,
  gainYaw: number,
  gainPitch: number,
  maxPx = 400,
): { readonly dx: number; readonly dy: number } {
  const clamp = (v: number): number => Math.max(-maxPx, Math.min(maxPx, v));
  const dx = gainYaw === 0 ? 0 : clamp(dYaw / gainYaw);
  const dy = gainPitch === 0 ? 0 : clamp(dPitch / gainPitch);
  return { dx: Number.isFinite(dx) ? dx : 0, dy: Number.isFinite(dy) ? dy : 0 };
}

/** Nearest live target to `from` by horizontal distance, or undefined. */
export function nearest<T extends { readonly pos: V3; readonly alive: boolean }>(
  from: V3,
  bots: ReadonlyArray<T>,
): T | undefined {
  let best: T | undefined;
  let bestD = Infinity;
  for (const b of bots) {
    if (!b.alive) continue;
    const d = Math.hypot(b.pos.x - from.x, b.pos.z - from.z);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

/** Chest height above the feet point used as the aim point (body hitbox spans 0 to 1.5 m). */
export const CHEST_HEIGHT_M = 1.2;
