import { degToRad } from '@sz/kernel';

/** Simulation numbers (domain-entities-match-loop "Value objects", business-logic-model §3). */
export const SIM_RULES = Object.freeze({
  /** Bot vertical motion is sim-owned (BR-ML-35); same values as player-movement tuning. */
  botGravity: 18,
  botStickVy: -1,
  botTerminalFall: 50,
  /** Bot eye heights, the same as @sz/physics EYE_HEIGHT (pinned by a test). */
  botEyeStand: 1.62,
  botEyeCrouch: 1.05,
  /** Bot chest height used by the player-view (radar) check. */
  botChestHeight: 1.0,
  /** Bot vision cone: 110° horizontal, ±60° vertical (business-logic-model §3 step 3). */
  botFovRad: degToRad(110),
  botVFovHalfRad: degToRad(60),
  /** Player camera field of view for the radar playerCanSee check. */
  playerHFovRad: degToRad(100),
  /** hitFlash lasts 9 ticks (0.15 s) after damage (BR-ML-63). */
  hitFlashTicks: 9,
  /** Horizontal speed above which the player counts as moving for weapon spread. */
  movingSpeed: 0.1,
});
