/**
 * Volume curve, bus gains, voice gain and the output ceiling curve
 * (business-logic-model-game-audio W10, BR-A-40 to BR-A-47, SD-A-6).
 */
import { clamp } from '@sz/kernel';
import type { BusGains, Volumes } from './types';

export const DUCK_FACTOR = 0.3;
export const VOLUME_TAU = 0.015;
export const DUCK_TAU = 0.08;
/** BR-A-43: exact-zero targets are pinned to 0 this long after the ramp starts. */
export const ZERO_PIN_DELAY = 0.1;
/** BR-A-35: stolen voices fade over 5 ms. */
export const STEAL_FADE_SEC = 0.005;
export const MAX_VOICE_GAIN = 2;
export const DEFAULT_VOLUMES: Volumes = Object.freeze({ master: 1, effects: 1 });

/** BR-A-41: g(v) = v². */
export function sliderGain(v: number): number {
  return v * v;
}

/** BR-A-40 / SD-A-2: finite values clamp to [0, 1]; anything else keeps `prev`. */
export function sanitizeVolume(v: unknown, prev: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return prev;
  return clamp(v, 0, 1) + 0; // + 0 turns -0 into +0
}

/** BR-A-42. */
export function busGains(v: Volumes, ducked: boolean): BusGains {
  const master = sliderGain(v.master);
  return { sfx: master * sliderGain(v.effects) * (ducked ? DUCK_FACTOR : 1), ui: master };
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** BR-A-47: 10^(gainDb/20) × scale, clamped to [0, 2]. Null when scale is not finite. */
export function voiceGain(gainDb: number, scale: unknown): number | null {
  if (typeof scale !== 'number' || !Number.isFinite(scale)) return null;
  return clamp(dbToGain(gainDb) * scale, 0, MAX_VOICE_GAIN) + 0;
}

const KNEE = 0.7;
const HEADROOM = 0.28;

/** SD-A-6 ceiling: identity for |x| <= 0.7, tanh knee above, maximum < 0.98. */
export function ceilingAt(x: number): number {
  const a = Math.abs(x);
  if (a <= KNEE) return x;
  return Math.sign(x) * (KNEE + HEADROOM * Math.tanh((a - KNEE) / HEADROOM));
}

/** WaveShaper curve over x in [-1, 1], `n` points (odd so x = 0 is sampled). */
export function ceilingCurve(n = 1025): Float32Array<ArrayBuffer> {
  const size = Math.max(3, Math.floor(n));
  const out = new Float32Array(size);
  for (let i = 0; i < size; i++) out[i] = ceilingAt((2 * i) / (size - 1) - 1);
  return out;
}
