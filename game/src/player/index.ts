// Public surface of player-controller (re-exports only).
export type {
  EdgeCarry,
  LookDelta,
  MoveAxes,
  MoveIntent,
  MovementLocks,
  MovementOutcome,
  PlayerInputIntent,
  PlayerMotionView,
  PlayerPose,
  RecoilKick,
  SwitchRequest,
} from './types';
export type { PlayerMotion } from './motion';
export { createPlayerMotion, eyePosition, motionView, placePlayer } from './motion';
export { applyLook, applyRecoil, effectiveSensitivity } from './look';
export { stepMovement } from './movement';
export { EMPTY_CARRY, NEUTRAL_INTENT, distributeIntent } from './intent';
export type { DistributedIntent } from './intent';
export { LOOK_TUNING, MOVEMENT_TUNING } from './tuning';
