/**
 * World camera maths (FD-R-1, LC-R-3, BR-R-05, BR-R-06). Horizontal FOV setting → vertical FOV
 * per aspect; the sniper scope overrides with its vertical scopedFovDeg. YXZ rotation: yaw about
 * +Y, then pitch about local X (kernel convention: yaw 0 faces -Z).
 */
import type { SnapshotPlayer } from '@sz/sim';
import { clampFov, finiteOr, finiteVec } from './guards';

/** ≤ 0.1 m and well under the 0.35 m capsule radius, so walls never clip (req-player-collision AC2). */
export const CAMERA_NEAR = 0.05;
export const CAMERA_FAR_MARGIN_M = 10;
export const DEATH_CAMERA_SEC = 0.6;
export const DEATH_EYE_M = 0.4;
export const DEATH_ROLL_RAD = (20 * Math.PI) / 180;

const DEG = Math.PI / 180;

/** Vertical FOV in degrees for a horizontal FOV (clamped to [60, 110]) at this aspect. */
export function verticalFovDeg(hFovDeg: number, aspect: number): number {
  const h = clampFov(hFovDeg, 90) * DEG;
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
  return (2 * Math.atan(Math.tan(h / 2) / a)) / DEG;
}

/** Inverse of verticalFovDeg; used by tests to prove the derived horizontal FOV equals the setting. */
export function horizontalFovDeg(vFovDeg: number, aspect: number): number {
  return (2 * Math.atan(Math.tan((vFovDeg * DEG) / 2) * aspect)) / DEG;
}

export interface CameraPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  vFovDeg: number;
  near: number;
  far: number;
}

export function createCameraPose(): CameraPose {
  return {
    x: 0,
    y: 1.62,
    z: 0,
    yaw: 0,
    pitch: 0,
    roll: 0,
    vFovDeg: 58.7,
    near: CAMERA_NEAR,
    far: 100,
  };
}

export interface CameraInputs {
  readonly fovDeg: number;
  readonly aspect: number;
  readonly drawDistanceM: number;
  /** Vertical scope FOV when scoped with a scoped weapon, else null. */
  readonly scopedFovDeg: number | null;
  /** Seconds since the player died on the presentation clock, or -1 while alive. */
  readonly deathT: number;
  readonly reducedMotion: boolean;
}

/** Writes the interpolated eye pose into `out`. Non-finite inputs keep the previous pose fields. */
export function updateCamera(
  out: CameraPose,
  curr: SnapshotPlayer,
  prev: SnapshotPlayer | undefined,
  alpha: number,
  inp: CameraInputs,
): CameraPose {
  if (finiteVec(curr.pos) && finiteVec(curr.prevPos)) {
    const a = alpha;
    const fromEye = prev !== undefined ? finiteOr(prev.eyeHeight, curr.eyeHeight) : curr.eyeHeight;
    const eye = finiteOr(fromEye + (finiteOr(curr.eyeHeight, fromEye) - fromEye) * a, 1.62);
    let eyeY = eye;
    let roll = 0;
    if (inp.deathT >= 0 && !inp.reducedMotion) {
      const k = Math.min(1, inp.deathT / DEATH_CAMERA_SEC);
      eyeY = eye + (DEATH_EYE_M - eye) * k;
      roll = DEATH_ROLL_RAD * k;
    }
    out.x = curr.prevPos.x + (curr.pos.x - curr.prevPos.x) * a;
    out.y = curr.prevPos.y + (curr.pos.y - curr.prevPos.y) * a + eyeY;
    out.z = curr.prevPos.z + (curr.pos.z - curr.prevPos.z) * a;
    out.roll = roll;
  }
  out.yaw = finiteOr(curr.yaw, out.yaw);
  out.pitch = finiteOr(curr.pitch, out.pitch);
  out.vFovDeg =
    inp.scopedFovDeg !== null && Number.isFinite(inp.scopedFovDeg)
      ? inp.scopedFovDeg
      : verticalFovDeg(inp.fovDeg, inp.aspect);
  out.near = CAMERA_NEAR;
  out.far = finiteOr(inp.drawDistanceM, 90) + CAMERA_FAR_MARGIN_M;
  return out;
}
