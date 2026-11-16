/**
 * Bot rig part table (FD-R-6, LC-A-2). Shared by forward kinematics (render/core/rig.ts) and
 * geometry building (assets/gl). Sizes fit inside @sz/physics DEFAULT_HITBOXES for both stances
 * (BR-R-04), so what the player sees is what can be hit. Metres, bot space: +Y up, facing -Z.
 */
import type { Rgb } from './box-mesh';

export type RigPart =
  'torso' | 'head' | 'helmet' | 'upperArm' | 'forearm' | 'thigh' | 'shin' | 'rifle';

export interface RigPartSpec {
  readonly part: RigPart;
  /** Instances per bot (limbs come in pairs). */
  readonly perBot: 1 | 2;
  /** Full box size. */
  readonly size: { readonly x: number; readonly y: number; readonly z: number };
  /** Linear 0..1 base colour; the hit tint mixes toward red per instance. */
  readonly color: Rgb;
}

const TAN: Rgb = [0.55, 0.47, 0.33];
const DARK: Rgb = [0.24, 0.24, 0.2];
const ARMBAND: Rgb = [0.62, 0.12, 0.1];

export const RIG_PARTS: ReadonlyArray<RigPartSpec> = Object.freeze([
  { part: 'torso', perBot: 1, size: { x: 0.5, y: 0.65, z: 0.3 }, color: TAN },
  { part: 'head', perBot: 1, size: { x: 0.3, y: 0.3, z: 0.3 }, color: [0.62, 0.5, 0.4] },
  { part: 'helmet', perBot: 1, size: { x: 0.34, y: 0.1, z: 0.34 }, color: DARK },
  { part: 'upperArm', perBot: 2, size: { x: 0.11, y: 0.3, z: 0.11 }, color: ARMBAND },
  { part: 'forearm', perBot: 2, size: { x: 0.09, y: 0.28, z: 0.09 }, color: TAN },
  { part: 'thigh', perBot: 2, size: { x: 0.15, y: 0.43, z: 0.15 }, color: TAN },
  { part: 'shin', perBot: 2, size: { x: 0.13, y: 0.42, z: 0.13 }, color: DARK },
  { part: 'rifle', perBot: 1, size: { x: 0.06, y: 0.1, z: 0.8 }, color: [0.12, 0.12, 0.13] },
] as const satisfies ReadonlyArray<RigPartSpec>);

/** Joint layout (stand pose). Crouch lowers the hip so the head centre sits at 1.1 m. */
export const RIG = Object.freeze({
  hipStand: 0.85,
  hipCrouch: 0.25,
  torsoHeight: 0.65,
  /** Head centre above the hip (0.85 + 0.85 = 1.7 m standing). */
  headAboveHip: 0.85,
  helmetAboveHip: 0.98,
  shoulderAboveHip: 0.6,
  shoulderX: 0.3,
  hipX: 0.12,
  /** Capsule radius from @sz/physics; the rig never exceeds it horizontally at rest. */
  capsuleRadius: 0.35,
});

/** Total part instances per bot (12). */
export const PARTS_PER_BOT = RIG_PARTS.reduce((n, p) => n + p.perBot, 0);
