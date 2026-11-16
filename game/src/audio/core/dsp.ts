/**
 * DSP primitives over Float32Array (business-logic-model-game-audio W2).
 * Pure functions; randomness only from the injected kernel Rng (BR-A-61).
 */
import type { Rng } from '@sz/kernel';

export type Pcm = Float32Array<ArrayBuffer>;

const TWO_PI = Math.PI * 2;
const DEFAULT_ATTACK_SEC = 0.001;

export function samplesFor(sec: number, fs: number): number {
  return Math.max(0, Math.round(sec * fs));
}

export function whiteNoise(rng: Rng, n: number): Pcm {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = 2 * rng.next() - 1;
  return out;
}

/** One-pole low-pass: y[n] = (1 - a)·x[n] + a·y[n-1], a = exp(-2π·fc/fs). */
export function lowpass(x: Pcm, fc: number, fs: number): Pcm {
  const a = Math.exp((-TWO_PI * fc) / fs);
  const out = new Float32Array(x.length);
  let y = 0;
  for (let i = 0; i < x.length; i++) {
    y = (1 - a) * (x[i] ?? 0) + a * y;
    out[i] = y;
  }
  return out;
}

/** One-pole high-pass: x - lowpass(x). */
export function highpass(x: Pcm, fc: number, fs: number): Pcm {
  const lp = lowpass(x, fc, fs);
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = (x[i] ?? 0) - (lp[i] ?? 0);
  return out;
}

/** RBJ band-pass biquad with 0 dB peak gain. */
export function bandpass(x: Pcm, f0: number, q: number, fs: number): Pcm {
  const w0 = (TWO_PI * f0) / fs;
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0;
  const b2 = -alpha / a0;
  const a1 = (-2 * Math.cos(w0)) / a0;
  const a2 = (1 - alpha) / a0;
  const out = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i] ?? 0;
    const y = b0 * xi + b2 * x2 - a1 * y1 - a2 * y2;
    out[i] = y;
    x2 = x1;
    x1 = xi;
    y2 = y1;
    y1 = y;
  }
  return out;
}

export function sine(n: number, freq: number, fs: number): Pcm {
  const out = new Float32Array(n);
  const step = (TWO_PI * freq) / fs;
  let phase = 0;
  for (let i = 0; i < n; i++) {
    out[i] = Math.sin(phase);
    phase += step;
  }
  return out;
}

/** Exponential sine sweep f(t) = f0·(f1/f0)^(min(t, T)/T), phase-accumulated. */
export function sweep(n: number, f0: number, f1: number, durSec: number, fs: number): Pcm {
  const out = new Float32Array(n);
  const ratio = f1 / f0;
  let phase = 0;
  for (let i = 0; i < n; i++) {
    out[i] = Math.sin(phase);
    const t = Math.min(i / fs, durSec);
    phase += (TWO_PI * f0 * Math.pow(ratio, t / durSec)) / fs;
  }
  return out;
}

export interface LayerShape {
  /** Exponential decay time constant in seconds. */
  readonly tau: number;
  readonly level: number;
  /** Linear attack in seconds, default 1 ms. */
  readonly att?: number;
  /** Start offset in seconds, default 0. */
  readonly offset?: number;
}

/** env(t) = t < att ? t/att : exp(-(t - att)/τ). */
export function envelopeAt(t: number, att: number, tau: number): number {
  if (t < 0) return 0;
  return t < att ? t / att : Math.exp(-(t - att) / tau);
}

/**
 * Adds `source × env × level` into `out`, starting `offset` seconds in.
 * `source` index 0 lines up with the offset.
 */
export function addLayer(out: Pcm, source: Pcm, shape: LayerShape, fs: number): void {
  const start = samplesFor(shape.offset ?? 0, fs);
  const att = shape.att ?? DEFAULT_ATTACK_SEC;
  for (let i = start; i < out.length; i++) {
    const k = i - start;
    if (k >= source.length) break;
    out[i] = (out[i] ?? 0) + (source[k] ?? 0) * envelopeAt(k / fs, att, shape.tau) * shape.level;
  }
}

/** Length of a source that starts `offsetSec` into a clip of `n` samples. */
export function remaining(n: number, offsetSec: number, fs: number): number {
  return Math.max(0, n - samplesFor(offsetSec, fs));
}

export function scaleInPlace(x: Pcm, k: number): void {
  for (let i = 0; i < x.length; i++) x[i] = (x[i] ?? 0) * k;
}

export function peakOf(x: Pcm): number {
  let peak = 0;
  for (const v of x) {
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  return peak;
}

export function meanOf(x: Pcm): number {
  if (x.length === 0) return 0;
  let sum = 0;
  for (const v of x) sum += v;
  return sum / x.length;
}

export const FINISH_PEAK = 0.9;
export const FADE_SEC = 0.002;

/** W1 finish: DC removal, normalise peak to 0.9, 2 ms raised-cosine fades (BR-A-63). */
export function finish(raw: Pcm, fs: number): Pcm {
  const out = new Float32Array(raw);
  const mean = meanOf(out);
  for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) - mean;
  const peak = peakOf(out);
  if (peak > 0) scaleInPlace(out, FINISH_PEAK / peak);
  const fade = Math.min(samplesFor(FADE_SEC, fs), Math.floor(out.length / 2));
  for (let k = 0; k < fade; k++) {
    const w = 0.5 * (1 - Math.cos((Math.PI * k) / fade));
    out[k] = (out[k] ?? 0) * w;
    const j = out.length - 1 - k;
    out[j] = (out[j] ?? 0) * w;
  }
  return out;
}
