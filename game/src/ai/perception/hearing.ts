/**
 * Hearing and damage (LC-AI-02, LC-AI-04; BR-AI-05, BR-AI-16 to BR-AI-18). Noises carry the
 * noise position only; damage carries a direction only.
 */
import { PLAYER_ID, distance, type ActorId, type Vec3 } from '@sz/kernel';
import { finiteNum, finiteVec } from './guards';
import { copyInto, type Memory, type Slot } from './memory';
import { PERCEPTION_RULES } from './rules';
import type { NoiseInput } from './types';
import type { SpatialGrid } from './grid';

/** A validated, copied noise waiting in the per-tick queue. */
export interface QueuedNoise {
  readonly pos: Vec3;
  readonly radius: number;
  readonly kind: NoiseInput['kind'];
}

/** Only player-sourced noises with a finite position and positive radius are kept (BR-AI-17). */
export function acceptNoise(input: unknown): QueuedNoise | null {
  if (typeof input !== 'object' || input === null) return null;
  const n = input as Partial<Record<keyof NoiseInput, unknown>>;
  if (n.source !== PLAYER_ID || !finiteVec(n.pos) || !finiteNum(n.radius) || !(n.radius > 0)) {
    return null;
  }
  if (n.kind !== 'gunfire' && n.kind !== 'footstep') return null;
  const radius = Math.min(n.radius, PERCEPTION_RULES.maxNoiseRadiusM);
  return { pos: { x: n.pos.x, y: n.pos.y, z: n.pos.z }, radius, kind: n.kind };
}

export interface HearingDeps {
  readonly grid: SpatialGrid;
  readonly positions: ReadonlyMap<ActorId, Slot>;
  memoryOf(bot: ActorId): Memory | undefined;
}

/** Delivers one noise to every live bot whose feet are within its radius (no occlusion). */
export function deliverNoise(noise: QueuedNoise, now: number, deps: HearingDeps): void {
  for (const bot of deps.grid.near(noise.pos, noise.radius)) {
    const feet = deps.positions.get(bot);
    const m = deps.memoryOf(bot);
    if (feet === undefined || m === undefined || m.dead) continue;
    if (distance(feet, noise.pos) > noise.radius) continue;
    m.heardAt = now;
    m.heardKind = noise.kind;
    copyInto(m.heardPos, noise.pos);
    m.version++;
  }
}

/**
 * Stores a horizontal unit direction toward the attacker. A zero or unusable direction is kept
 * as "damaged, direction unknown" (the zero vector), never as a position.
 */
export function recordDamageInto(m: Memory, dir: Vec3, now: number): void {
  if (m.dead || !finiteNum(now)) return;
  const d = finiteVec(dir) ? Math.hypot(dir.x, dir.z) : 0;
  if (d > 1e-9) copyInto(m.damageDir, { x: dir.x / d, y: 0, z: dir.z / d });
  else copyInto(m.damageDir, { x: 0, y: 0, z: 0 });
  m.damageAt = now;
  m.version++;
}
