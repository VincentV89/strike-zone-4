/** Shared character dimensions and controller tuning (BR-WM-59, domain-entities-world-maps). */
import { vec3 } from '@sz/kernel';
import type { CapsuleSpec, CharacterSpec, HitboxSpec } from './types';

export const DEFAULT_CAPSULE: CapsuleSpec = Object.freeze({
  radius: 0.35,
  standHeight: 1.8,
  crouchHeight: 1.2,
});

/** Eye heights used by spawn line of sight and perception. */
export const EYE_HEIGHT = Object.freeze({ stand: 1.62, crouch: 1.05 });

export const DEFAULT_HITBOXES: ReadonlyArray<HitboxSpec> = Object.freeze([
  { zone: 'body', stance: 'stand', offset: vec3(0, 0.75, 0), half: vec3(0.3, 0.75, 0.25) },
  { zone: 'head', stance: 'stand', offset: vec3(0, 1.7, 0), half: vec3(0.18, 0.2, 0.18) },
  { zone: 'body', stance: 'crouch', offset: vec3(0, 0.5, 0), half: vec3(0.3, 0.5, 0.25) },
  { zone: 'head', stance: 'crouch', offset: vec3(0, 1.1, 0), half: vec3(0.18, 0.2, 0.18) },
] as const);

export const DEFAULT_CHARACTER: CharacterSpec = Object.freeze({
  ...DEFAULT_CAPSULE,
  hitboxes: DEFAULT_HITBOXES,
});

export const CONTROLLER_TUNING = Object.freeze({
  offset: 0.02,
  autostepMaxHeight: 0.4,
  autostepMinWidth: 0.2,
  maxSlopeClimbDeg: 40,
  minSlopeSlideDeg: 30,
  snapToGround: 0.3,
  /** A collision normal with y below this counts as a ceiling hit (BR-WM-60). */
  ceilingNormalY: -0.7,
});

/** Player plus 20 bots (SD-WM-9). */
export const MAX_CHARACTERS = 21;

export const PHYSICS_STEP_SEC = 1 / 60;
