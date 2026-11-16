import { degToRad } from '@sz/kernel';

/**
 * Single source of movement numbers (BR-P-07, domain-entities-player-movement).
 * Units: metres, seconds, radians.
 */
export const MOVEMENT_TUNING = Object.freeze({
  walkSpeed: 5.0,
  sprintSpeed: 7.5,
  crouchSpeed: 2.5,
  groundAccel: 40,
  groundDecel: 50,
  airAccel: 8,
  gravity: 18,
  jumpVelocity: 6.0,
  terminalFallSpeed: 50,
  groundStickVelocity: -1.0,
  standEyeHeight: 1.65,
  crouchEyeHeight: 1.05,
  eyeLerpSpeed: 6,
  walkStride: 2.0,
  sprintStride: 2.6,
  footstepMinSpeed: 1.0,
  /** Gait counts as sprint above walkSpeed + this margin (BR-P-51). */
  sprintGaitMargin: 0.25,
  killY: -50,
  maxTickDt: 0.1,
});

/** Mouse-look numbers (BR-P-11 to BR-P-13). */
export const LOOK_TUNING = Object.freeze({
  radPerPixel: 0.0022,
  sensitivityMin: 0.1,
  sensitivityMax: 5.0,
  sensitivityDefault: 1.0,
  pitchLimit: degToRad(89),
  maxDeltaPerFrame: 4000,
  /** Per-call cap on a recoil impulse, either axis (security-design entry guards). */
  maxRecoilRad: degToRad(10),
});
