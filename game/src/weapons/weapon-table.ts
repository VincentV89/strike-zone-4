import { degToRad, isWeaponId, type WeaponId } from '@sz/kernel';

/*
 * WEAPON_TABLE is the only place weapon numbers live (BR-W-01). Angular fields are
 * radians; the table is written in degrees for readability and converted here.
 * Starting values: Q3 (damage, interval, magazine, reload) and FD-WC-A5 (the rest).
 * Tuning may change any number but must keep the invariants in weapon-table.test.ts.
 */

export type FireMode = 'auto' | 'semi';

export interface WeaponStats {
  readonly id: WeaponId;
  readonly fireMode: FireMode;
  /** Integer body damage before the zone multiplier. */
  readonly damage: number;
  readonly headMultiplier: number;
  readonly fireIntervalSec: number;
  readonly magazineSize: number;
  readonly reserveStart: number;
  readonly reloadSec: number;
  readonly drawSec: number;
  readonly rangeM: number;
  /** Half-angle of the spread cone, radians. */
  readonly spreadBase: number;
  /** Replaces spreadBase while scoped; null when the weapon has no scope. */
  readonly spreadScoped: number | null;
  readonly spreadMovePenalty: number;
  readonly bloomPerShot: number;
  readonly bloomMax: number;
  readonly spreadMax: number;
  /** Seconds after the last shot before bloom starts to recover. */
  readonly recoveryDelaySec: number;
  /** Bloom recovered per second once recovery has started, radians/s. */
  readonly recoveryRate: number;
  /** Upward view kick per shot, radians. */
  readonly kickPitch: number;
  /** Maximum sideways view kick per shot, radians, sampled in [-k, k]. */
  readonly kickYawMax: number;
  /** Camera vertical FOV while scoped, degrees (UI boundary value); null without a scope. */
  readonly scopedFovDeg: number | null;
  /** Gunfire hearing radius that match-loop puts in NoiseEmitted, metres. */
  readonly noiseRadiusM: number;
}

/** Tolerance for every "now >= t" comparison, so 6 ticks of 1/60 s count as 0.1 s. */
export const TIME_EPS = 1e-6;

const rad = degToRad;

const RIFLE: WeaponStats = Object.freeze({
  id: 'rifle',
  fireMode: 'auto',
  damage: 28,
  headMultiplier: 4,
  fireIntervalSec: 0.1,
  magazineSize: 30,
  reserveStart: 90,
  reloadSec: 2.5,
  drawSec: 0.6,
  rangeM: 200,
  spreadBase: rad(0.4),
  spreadScoped: null,
  spreadMovePenalty: rad(1.5),
  bloomPerShot: rad(0.35),
  bloomMax: rad(4),
  spreadMax: rad(6),
  recoveryDelaySec: 0.15,
  recoveryRate: rad(6),
  kickPitch: rad(0.6),
  kickYawMax: rad(0.25),
  scopedFovDeg: null,
  noiseRadiusM: 40,
});

const PISTOL: WeaponStats = Object.freeze({
  id: 'pistol',
  fireMode: 'semi',
  damage: 22,
  headMultiplier: 4,
  fireIntervalSec: 0.15,
  magazineSize: 15,
  reserveStart: 45,
  reloadSec: 1.5,
  drawSec: 0.35,
  rangeM: 120,
  spreadBase: rad(0.6),
  spreadScoped: null,
  spreadMovePenalty: rad(1),
  bloomPerShot: rad(0.8),
  bloomMax: rad(3.5),
  spreadMax: rad(5),
  recoveryDelaySec: 0.2,
  recoveryRate: rad(8),
  kickPitch: rad(1),
  kickYawMax: rad(0.3),
  scopedFovDeg: null,
  noiseRadiusM: 30,
});

const SNIPER: WeaponStats = Object.freeze({
  id: 'sniper',
  fireMode: 'semi',
  damage: 90,
  headMultiplier: 4,
  fireIntervalSec: 1.3,
  magazineSize: 5,
  reserveStart: 20,
  reloadSec: 3,
  drawSec: 0.9,
  rangeM: 400,
  spreadBase: rad(3),
  spreadScoped: rad(0.05),
  spreadMovePenalty: rad(4),
  bloomPerShot: rad(2),
  bloomMax: rad(2),
  spreadMax: rad(8),
  recoveryDelaySec: 0.3,
  recoveryRate: rad(10),
  kickPitch: rad(3.5),
  kickYawMax: rad(0.8),
  scopedFovDeg: 25,
  noiseRadiusM: 60,
});

/** Deep-frozen at module load (SEC-WC-20): rows hold primitives only, rows and table are frozen. */
export const WEAPON_TABLE: Readonly<Record<WeaponId, WeaponStats>> = Object.freeze({
  rifle: RIFLE,
  pistol: PISTOL,
  sniper: SNIPER,
});

/**
 * The only reader of WEAPON_TABLE for ids that come from outside (SEC-WC-03).
 * isWeaponId rejects '__proto__' and friends; Object.hasOwn is the second line of defence.
 */
export function weaponStats(id: unknown): WeaponStats | undefined {
  return isWeaponId(id) && Object.hasOwn(WEAPON_TABLE, id) ? WEAPON_TABLE[id] : undefined;
}
