/**
 * First-person weapon animation state (BR-R-13, LC-R-6). Pure and finite-checked: a non-finite
 * input leaves the previous pose. Kick is a damped spring back to rest in about 150 ms; reload
 * dips and rolls; draw rises from below; only a switch cancels a reload (matches weapons-combat).
 */
import type { WeaponId } from '@sz/kernel';

export const KICK_STIFFNESS = 220;
export const KICK_DAMPING = 22;
export const KICK_SCALE = 4;
export const VM_FLASH_SEC = 0.05;
export const RELOAD_DIP_M = 0.12;
export const RELOAD_ROLL_RAD = (35 * Math.PI) / 180;
export const DRAW_DROP_M = 0.25;
export const BOB_AMPLITUDE_M = 0.006;
const SPRING_STEP = 1 / 240;

export interface ViewmodelState {
  weapon: WeaponId;
  kick: number;
  kickVel: number;
  reloadStart: number;
  reloadDur: number;
  drawStart: number;
  drawDur: number;
  bobPhase: number;
  flashUntil: number;
}

export interface ViewmodelPose {
  visible: boolean;
  weapon: WeaponId;
  x: number;
  y: number;
  z: number;
  pitch: number;
  roll: number;
  flash: boolean;
}

export function createViewmodelState(weapon: WeaponId = 'rifle'): ViewmodelState {
  return {
    weapon,
    kick: 0,
    kickVel: 0,
    reloadStart: -1,
    reloadDur: 0,
    drawStart: -1,
    drawDur: 0,
    bobPhase: 0,
    flashUntil: -1,
  };
}

export function resetViewmodel(s: ViewmodelState, weapon: WeaponId): void {
  s.weapon = weapon;
  s.kick = 0;
  s.kickVel = 0;
  s.reloadStart = -1;
  s.reloadDur = 0;
  s.drawStart = -1;
  s.drawDur = 0;
  s.bobPhase = 0;
  s.flashUntil = -1;
}

export function createViewmodelPose(): ViewmodelPose {
  return { visible: false, weapon: 'rifle', x: 0, y: 0, z: 0, pitch: 0, roll: 0, flash: false };
}

/** Player ShotFired: pitch impulse (kickPitch × 4 for visibility) and a 50 ms flash. */
export function vmFire(s: ViewmodelState, t: number, kickPitch: number): void {
  if (Number.isFinite(kickPitch)) s.kick += Math.abs(kickPitch) * KICK_SCALE;
  s.flashUntil = t + VM_FLASH_SEC;
}

export function vmReload(s: ViewmodelState, t: number, durationSec: number): void {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return;
  s.reloadStart = t;
  s.reloadDur = durationSec;
}

/** WeaponSwitched: swap model, play the draw over drawSec, cancel any reload animation. */
export function vmSwitch(s: ViewmodelState, to: WeaponId, t: number, drawSec: number): void {
  s.weapon = to;
  s.reloadStart = -1;
  s.reloadDur = 0;
  s.drawStart = t;
  s.drawDur = Number.isFinite(drawSec) && drawSec > 0 ? drawSec : 0;
}

/** Advances the spring and the bob by dt (0 while paused, so nothing moves). */
export function vmStep(s: ViewmodelState, dt: number, speed: number, reducedMotion: boolean): void {
  if (!(dt > 0)) return;
  let left = dt;
  while (left > 1e-9) {
    const h = Math.min(SPRING_STEP, left);
    const acc = -KICK_STIFFNESS * s.kick - KICK_DAMPING * s.kickVel;
    s.kickVel += acc * h;
    s.kick += s.kickVel * h;
    left -= h;
  }
  if (!Number.isFinite(s.kick) || !Number.isFinite(s.kickVel)) {
    s.kick = 0;
    s.kickVel = 0;
  }
  const v = Number.isFinite(speed) && speed > 0 ? speed : 0;
  if (!reducedMotion) s.bobPhase = (s.bobPhase + v * dt * 2 * Math.PI) % (Math.PI * 200);
}

function reloadShape(k: number): number {
  if (k < 0.4) return k / 0.4;
  if (k < 0.7) return 1;
  return Math.max(0, (1 - k) / 0.3);
}

/** Writes the pose for presentation time t. `speed` scales the bob amplitude. */
export function vmPose(
  s: ViewmodelState,
  t: number,
  speed: number,
  reducedMotion: boolean,
  out: ViewmodelPose,
): ViewmodelPose {
  let y = 0;
  let roll = 0;
  if (s.reloadStart >= 0 && s.reloadDur > 0) {
    const k = (t - s.reloadStart) / s.reloadDur;
    if (k >= 0 && k < 1) {
      const a = reloadShape(k);
      y -= RELOAD_DIP_M * a;
      roll += reducedMotion ? 0 : RELOAD_ROLL_RAD * a;
    } else if (k >= 1) {
      s.reloadStart = -1;
    }
  }
  if (s.drawStart >= 0) {
    const k = s.drawDur > 0 ? (t - s.drawStart) / s.drawDur : 1;
    if (k >= 0 && k < 1) y -= DRAW_DROP_M * (1 - k);
    else if (k >= 1) s.drawStart = -1;
  }
  if (!reducedMotion) {
    const v = Number.isFinite(speed) && speed > 0 ? speed : 0;
    y += BOB_AMPLITUDE_M * Math.min(v / 5, 1.5) * Math.sin(s.bobPhase);
  }
  out.weapon = s.weapon;
  out.x = 0;
  out.y = Number.isFinite(y) ? y : out.y;
  out.z = Number.isFinite(s.kick) ? s.kick * 0.15 : out.z;
  out.pitch = Number.isFinite(s.kick) ? s.kick : out.pitch;
  out.roll = Number.isFinite(roll) ? roll : out.roll;
  out.flash = t < s.flashUntil;
  return out;
}
