import { clamp, wrapAngle } from '@sz/kernel';
import { clampFinite } from './guards';
import type { PlayerMotion } from './motion';
import { LOOK_TUNING } from './tuning';
import type { LookDelta, RecoilKick } from './types';

const { pitchLimit, maxDeltaPerFrame, maxRecoilRad } = LOOK_TUNING;

/** Sensitivity clamped to [0.1, 5.0]; non-finite → 1.0 (BR-P-11). */
export function effectiveSensitivity(sensitivity: number): number {
  return clampFinite(
    sensitivity,
    LOOK_TUNING.sensitivityMin,
    LOOK_TUNING.sensitivityMax,
    LOOK_TUNING.sensitivityDefault,
  );
}

/**
 * Applies one render frame of mouse look (FD-P-2, BR-P-10 to BR-P-13).
 * Δyaw = −dx × 0.0022 × s and Δpitch = −dy × 0.0022 × s. No dt: look is a pure
 * displacement, so frame rate does not change sensitivity. Pitch is clamped to ±89°
 * and yaw wrapped into (−π, π] on every call.
 */
export function applyLook(motion: PlayerMotion, look: LookDelta, sensitivity: number): void {
  const k = LOOK_TUNING.radPerPixel * effectiveSensitivity(sensitivity);
  const dx = clampFinite(look.dx, -maxDeltaPerFrame, maxDeltaPerFrame, 0);
  const dy = clampFinite(look.dy, -maxDeltaPerFrame, maxDeltaPerFrame, 0);
  motion.yaw = wrapAngle(motion.yaw - dx * k);
  motion.pitch = clamp(motion.pitch - dy * k, -pitchLimit, pitchLimit);
}

/**
 * Applies a weapon view kick (BR-P-15). Positive pitchRad looks up, positive yawRad turns
 * left. Each axis is capped at ±10° per call; non-finite axes are ignored.
 */
export function applyRecoil(motion: PlayerMotion, kick: RecoilKick): void {
  const p = clampFinite(kick.pitchRad, -maxRecoilRad, maxRecoilRad, 0);
  const y = clampFinite(kick.yawRad, -maxRecoilRad, maxRecoilRad, 0);
  motion.pitch = clamp(motion.pitch + p, -pitchLimit, pitchLimit);
  motion.yaw = wrapAngle(motion.yaw + y);
}
