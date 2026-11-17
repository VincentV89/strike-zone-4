/**
 * First-person weapon models as box lists (req-weapon-viewmodel AC1). Viewmodel camera space:
 * +X right, +Y up, -Z forward. Each model is well under 600 triangles and has a distinct
 * silhouette (length, scope, grip angle).
 */
import type { WeaponId } from '@sz/kernel';
import { vec3 } from '@sz/kernel';
import type { BoxSpec, Rgb } from './box-mesh';

const GUNMETAL: Rgb = [0.2, 0.21, 0.23];
const POLYMER: Rgb = [0.09, 0.09, 0.1];
const WOOD: Rgb = [0.42, 0.27, 0.14];

const box = (
  cx: number,
  cy: number,
  cz: number,
  hx: number,
  hy: number,
  hz: number,
  color: Rgb,
  pitch = 0,
): BoxSpec => ({
  center: vec3(cx, cy, cz),
  half: vec3(hx, hy, hz),
  yaw: 0,
  pitch,
  color,
});

const RIFLE: ReadonlyArray<BoxSpec> = [
  box(0, 0, 0, 0.025, 0.04, 0.18, GUNMETAL),
  box(0, 0.01, -0.3, 0.01, 0.01, 0.14, GUNMETAL),
  box(0, -0.08, -0.05, 0.018, 0.05, 0.025, POLYMER, 0.2),
  box(0, -0.01, 0.24, 0.022, 0.045, 0.08, POLYMER),
  box(0, -0.07, 0.08, 0.015, 0.04, 0.02, POLYMER, -0.3),
  box(0, 0.055, -0.02, 0.008, 0.015, 0.04, GUNMETAL),
];

const PISTOL: ReadonlyArray<BoxSpec> = [
  box(0, 0.02, -0.05, 0.016, 0.02, 0.09, GUNMETAL),
  box(0, -0.005, -0.04, 0.015, 0.012, 0.08, POLYMER),
  box(0, -0.06, 0.02, 0.016, 0.05, 0.022, POLYMER, -0.25),
  box(0, 0.02, -0.15, 0.006, 0.006, 0.012, GUNMETAL),
];

const SNIPER: ReadonlyArray<BoxSpec> = [
  box(0, 0, 0, 0.024, 0.04, 0.22, GUNMETAL),
  box(0, 0.01, -0.42, 0.009, 0.009, 0.22, GUNMETAL),
  box(0, 0.08, -0.02, 0.022, 0.022, 0.13, POLYMER),
  box(0, 0.05, -0.08, 0.01, 0.012, 0.01, GUNMETAL),
  box(0, 0.05, 0.05, 0.01, 0.012, 0.01, GUNMETAL),
  box(0, -0.015, 0.3, 0.024, 0.05, 0.11, WOOD),
  box(0, -0.07, -0.02, 0.016, 0.035, 0.03, POLYMER),
];

export interface ViewmodelSpec {
  readonly boxes: ReadonlyArray<BoxSpec>;
  /** Hip-fire rest offset of the model origin in viewmodel camera space. */
  readonly rest: { readonly x: number; readonly y: number; readonly z: number };
  /** Muzzle point in model space (for the viewmodel flash). */
  readonly muzzleZ: number;
}

export const VIEWMODELS: ReadonlyMap<WeaponId, ViewmodelSpec> = new Map<WeaponId, ViewmodelSpec>([
  ['rifle', { boxes: RIFLE, rest: { x: 0.17, y: -0.17, z: -0.42 }, muzzleZ: -0.44 }],
  ['pistol', { boxes: PISTOL, rest: { x: 0.15, y: -0.15, z: -0.36 }, muzzleZ: -0.17 }],
  ['sniper', { boxes: SNIPER, rest: { x: 0.17, y: -0.18, z: -0.44 }, muzzleZ: -0.64 }],
]);
