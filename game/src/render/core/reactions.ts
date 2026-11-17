/**
 * Bot hit and death reactions on the presentation clock (BR-R-11, BR-R-12, FD-R-2, LC-R-6).
 * Flinch: 12° tilt away from the shooter, easing out over 150 ms; a new hit restarts it.
 * Death: 600 ms fall to lying flat, then static until beginRound. A dead bot never flinches.
 */
export const FLINCH_SEC = 0.15;
export const FLINCH_RAD = (12 * Math.PI) / 180;
export const DEATH_SEC = 0.6;

export interface ReactionState {
  flinchStart: number;
  flinchDx: number;
  flinchDz: number;
  deathStart: number;
  deathDx: number;
  deathDz: number;
}

export function resetReactions(r: ReactionState): void {
  r.flinchStart = -1;
  r.flinchDx = 0;
  r.flinchDz = 0;
  r.deathStart = -1;
  r.deathDx = 0;
  r.deathDz = 1;
}

/** Unit horizontal direction, or (fallbackX, fallbackZ) for a zero or non-finite input. */
export function horizontalUnit(
  dx: number,
  dz: number,
  fallbackX: number,
  fallbackZ: number,
): readonly [number, number] {
  const len = Math.sqrt(dx * dx + dz * dz);
  if (!Number.isFinite(len) || len < 1e-6) return [fallbackX, fallbackZ];
  return [dx / len, dz / len];
}

export function startFlinch(r: ReactionState, t: number, dx: number, dz: number): void {
  if (r.deathStart >= 0) return;
  const [x, z] = horizontalUnit(dx, dz, 0, 1);
  r.flinchStart = t;
  r.flinchDx = x;
  r.flinchDz = z;
}

/** Idempotent: only the first call after death counts (ActorKilled or alive=false, whichever first). */
export function startDeath(r: ReactionState, t: number, dx: number, dz: number): void {
  if (r.deathStart >= 0) return;
  const [x, z] = horizontalUnit(dx, dz, 0, 1);
  r.deathStart = t;
  r.deathDx = x;
  r.deathDz = z;
  r.flinchStart = -1;
}

/** 1 at the hit, easing to 0 at 150 ms. */
export function flinchAmount(r: ReactionState, t: number): number {
  if (r.flinchStart < 0 || r.deathStart >= 0) return 0;
  const k = (t - r.flinchStart) / FLINCH_SEC;
  if (k < 0 || k >= 1) return 0;
  return (1 - k) * (1 - k);
}

/** 0 alive … 1 lying flat (ease-in fall). */
export function deathProgress(r: ReactionState, t: number): number {
  if (r.deathStart < 0) return 0;
  const k = Math.min(1, Math.max(0, (t - r.deathStart) / DEATH_SEC));
  return k * k;
}
