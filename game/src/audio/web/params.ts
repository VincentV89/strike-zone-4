/**
 * The only module that writes AudioParams (security-design-game-audio SD-A-1).
 * Every write is finite-guarded: Web Audio throws TypeError on non-finite values.
 * Lint bans `.value =` and the scheduling methods everywhere else in src/audio/**.
 */
import type { Vec3 } from '@sz/kernel';
import type { ListenerBasis } from '@sz/audio/core/listener';

const finite = (...xs: ReadonlyArray<number>): boolean => xs.every((x) => Number.isFinite(x));

export function setParam(param: AudioParam, value: number): void {
  if (!finite(value)) return;
  // eslint-disable-next-line no-restricted-syntax -- SD-A-1 finite-guarded write
  param.value = value;
}

export function rampParam(param: AudioParam, target: number, now: number, tau: number): void {
  if (!finite(target, now, tau) || tau <= 0) return;
  // eslint-disable-next-line no-restricted-syntax -- SD-A-1 finite-guarded write
  param.setTargetAtTime(target, now, tau);
}

export function pinParam(param: AudioParam, value: number, at: number): void {
  if (!finite(value, at)) return;
  // eslint-disable-next-line no-restricted-syntax -- SD-A-1 finite-guarded write
  param.setValueAtTime(value, at);
}

/** BR-A-35: linear fade from the current value to 0 over `dur` seconds. */
export function fadeOut(param: AudioParam, now: number, dur: number): void {
  if (!finite(now, dur) || dur <= 0) return;
  param.cancelScheduledValues(now);
  pinParam(param, param.value, now);
  // eslint-disable-next-line no-restricted-syntax -- SD-A-1 finite-guarded write
  param.linearRampToValueAtTime(0, now + dur);
}

/** Legacy positional API (BR-A-18) on AudioListener and PannerNode. */
interface LegacyPositional {
  setPosition(x: number, y: number, z: number): void;
}
interface LegacyListener extends LegacyPositional {
  setOrientation(fx: number, fy: number, fz: number, ux: number, uy: number, uz: number): void;
}

function legacyPosition(node: object, p: Vec3): void {
  if (!finite(p.x, p.y, p.z)) return;
  // eslint-disable-next-line no-restricted-syntax -- SD-A-1 finite-guarded write
  (node as LegacyPositional).setPosition(p.x, p.y, p.z);
}

/** BR-A-18: feature-detect the AudioParam form, which some engines lack. */
export function hasParam(node: object, name: string): boolean {
  return name in node;
}

export function setListenerPose(listener: AudioListener, pos: Vec3, b: ListenerBasis): void {
  if (!hasParam(listener, 'positionX')) {
    legacyPosition(listener, pos);
    const { forward: f, up: u } = b;
    if (!finite(f.x, f.y, f.z, u.x, u.y, u.z)) return;
    // eslint-disable-next-line no-restricted-syntax -- SD-A-1 finite-guarded write
    (listener as unknown as LegacyListener).setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    return;
  }
  setParam(listener.positionX, pos.x);
  setParam(listener.positionY, pos.y);
  setParam(listener.positionZ, pos.z);
  setParam(listener.forwardX, b.forward.x);
  setParam(listener.forwardY, b.forward.y);
  setParam(listener.forwardZ, b.forward.z);
  setParam(listener.upX, b.up.x);
  setParam(listener.upY, b.up.y);
  setParam(listener.upZ, b.up.z);
}

export function setPannerPosition(panner: PannerNode, pos: Vec3): void {
  if (!hasParam(panner, 'positionX')) {
    legacyPosition(panner, pos);
    return;
  }
  setParam(panner.positionX, pos.x);
  setParam(panner.positionY, pos.y);
  setParam(panner.positionZ, pos.z);
}
