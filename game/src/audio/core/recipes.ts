/**
 * One synthesis recipe per cue (business-logic-model-game-audio W3).
 *
 * Sounds are abstract by construction: filtered noise bursts, sine tones and
 * sweeps. They imitate no recorded or licensed game audio (BR-A-66).
 */
import type { Rng } from '@sz/kernel';
import {
  addLayer,
  bandpass,
  highpass,
  lowpass,
  remaining,
  sine,
  sweep,
  whiteNoise,
  type LayerShape,
  type Pcm,
} from './dsp';
import type { SoundCue } from './types';

export interface RecipeInput {
  readonly rng: Rng;
  readonly variant: number;
  readonly fs: number;
  /** Clip length in samples: round(durationSec × fs). */
  readonly n: number;
}

export type SynthRecipe = (input: RecipeInput) => Pcm;

type Filter = (x: Pcm, fs: number) => Pcm;

const lp =
  (fc: number): Filter =>
  (x, fs) =>
    lowpass(x, fc, fs);
const hp =
  (fc: number): Filter =>
  (x, fs) =>
    highpass(x, fc, fs);
const bp =
  (f0: number, q: number): Filter =>
  (x, fs) =>
    bandpass(x, f0, q, fs);

/** Filtered-noise layer. */
function noise(out: Pcm, input: RecipeInput, filter: Filter, shape: LayerShape): void {
  const len = remaining(input.n, shape.offset ?? 0, input.fs);
  addLayer(out, filter(whiteNoise(input.rng, len), input.fs), shape, input.fs);
}

function tone(out: Pcm, input: RecipeInput, freq: number, shape: LayerShape): void {
  const len = remaining(input.n, shape.offset ?? 0, input.fs);
  addLayer(out, sine(len, freq, input.fs), shape, input.fs);
}

function swept(
  out: Pcm,
  input: RecipeInput,
  f: readonly [number, number, number],
  shape: LayerShape,
): void {
  const len = remaining(input.n, shape.offset ?? 0, input.fs);
  addLayer(out, sweep(len, f[0], f[1], f[2], input.fs), shape, input.fs);
}

/** sin(f) + k·sin(m·f), the note timbre of the stings. */
function note(
  out: Pcm,
  input: RecipeInput,
  freq: number,
  harmonic: readonly [number, number],
  shape: LayerShape,
): void {
  tone(out, input, freq, shape);
  tone(out, input, freq * harmonic[0], { ...shape, level: shape.level * harmonic[1] });
}

function pickVariant(values: ReadonlyArray<number>, v: number): number {
  return values[v % values.length] ?? values[0] ?? 0;
}

function gunshot(
  bpHz: number,
  q: number,
  bpTau: number,
  thump: readonly [number, number, number],
  thumpTau: number,
  thumpLevel: number,
  crack: readonly [number, number, number],
): SynthRecipe {
  return (input) => {
    const out = new Float32Array(input.n);
    noise(out, input, bp(bpHz * (1 + 0.05 * input.variant), q), { tau: bpTau, level: 1 });
    swept(out, input, thump, { tau: thumpTau, level: thumpLevel });
    noise(out, input, hp(crack[0]), { tau: crack[1], level: crack[2] });
    return out;
  };
}

function click(
  out: Pcm,
  input: RecipeInput,
  at: number,
  level: number,
  c: { bpHz: number; q: number; bpTau: number; sineHz: number; sineTau: number; sineLevel: number },
): void {
  noise(out, input, bp(c.bpHz, c.q), { tau: c.bpTau, level, offset: at });
  tone(out, input, c.sineHz, { tau: c.sineTau, level: level * c.sineLevel, offset: at });
}

const RELOAD_START_CLICK = {
  bpHz: 2500,
  q: 4,
  bpTau: 0.015,
  sineHz: 900,
  sineTau: 0.02,
  sineLevel: 0.4,
};
const RELOAD_END_CLICK = {
  bpHz: 2000,
  q: 3,
  bpTau: 0.018,
  sineHz: 600,
  sineTau: 0.03,
  sineLevel: 0.6,
};

const fireRifle = gunshot(1200, 0.8, 0.04, [110, 55, 0.12], 0.06, 0.8, [4000, 0.008, 0.6]);
const firePistol = gunshot(1800, 1.0, 0.03, [160, 80, 0.08], 0.035, 0.6, [5000, 0.006, 0.5]);

const fireSniper: SynthRecipe = (input) => {
  const out = new Float32Array(input.n);
  noise(out, input, lp(800), { tau: 0.12, level: 1 });
  swept(out, input, [70, 40, 0.3], { tau: 0.15, level: 1 });
  noise(out, input, hp(3000), { tau: 0.01, level: 0.7 });
  noise(out, input, lp(400), { tau: 0.3, level: 0.25, offset: 0.02 });
  return out;
};

const dryFire: SynthRecipe = (input) => {
  const out = new Float32Array(input.n);
  noise(out, input, hp(3000), { tau: 0.004, level: 1 });
  tone(out, input, 2200, { tau: 0.006, level: 0.5 });
  return out;
};

const reloadStart: SynthRecipe = (input) => {
  const out = new Float32Array(input.n);
  click(out, input, 0, 1, RELOAD_START_CLICK);
  click(out, input, 0.12, 1, RELOAD_START_CLICK);
  return out;
};

const reloadEnd: SynthRecipe = (input) => {
  const out = new Float32Array(input.n);
  click(out, input, 0, 1, RELOAD_END_CLICK);
  click(out, input, 0.08, 0.5, RELOAD_END_CLICK);
  return out;
};

const hitBody: SynthRecipe = (input) => {
  const out = new Float32Array(input.n);
  tone(out, input, 1400, { tau: 0.03, level: 1 });
  noise(out, input, hp(6000), { tau: 0.003, level: 0.3 });
  return out;
};

const hitHead: SynthRecipe = (input) => {
  const out = new Float32Array(input.n);
  tone(out, input, 1800, { tau: 0.04, level: 1 });
  tone(out, input, 2600, { tau: 0.06, level: 0.9, offset: 0.05 });
  return out;
};

const enemyDeath: SynthRecipe = (input) => {
  const out = new Float32Array(input.n);
  swept(out, input, [600, 150, 0.35], { tau: 0.12, level: 0.8 });
  noise(out, input, lp(300), { tau: 0.06, level: 1 });
  return out;
};

const playerHurt: SynthRecipe = (input) => {
  const out = new Float32Array(input.n);
  tone(out, input, pickVariant([90, 75], input.variant), { tau: 0.09, level: 1 });
  noise(out, input, lp(pickVariant([500, 450], input.variant)), { tau: 0.08, level: 0.8 });
  return out;
};

const footstep: SynthRecipe = (input) => {
  const out = new Float32Array(input.n);
  const v = input.variant;
  noise(out, input, lp(pickVariant([450, 520, 600, 680], v)), { att: 0.003, tau: 0.025, level: 1 });
  tone(out, input, pickVariant([60, 65, 70, 75], v), { tau: 0.03, level: 0.5 });
  return out;
};

const victory: SynthRecipe = (input) => {
  const out = new Float32Array(input.n);
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((f, i) => {
    const tau = i === notes.length - 1 ? 0.6 : 0.35;
    note(out, input, f, [3, 0.3], { att: 0.005, tau, level: 1, offset: 0.15 * i });
  });
  return out;
};

const defeat: SynthRecipe = (input) => {
  const sum = new Float32Array(input.n);
  const notes = [440, 349.23, 293.66];
  notes.forEach((f, i) => {
    const tau = i === notes.length - 1 ? 0.7 : 0.45;
    note(sum, input, f, [2, 0.25], { att: 0.005, tau, level: 1, offset: 0.25 * i });
  });
  return lowpass(sum, 1800, input.fs);
};

const uiClick: SynthRecipe = (input) => {
  const out = new Float32Array(input.n);
  tone(out, input, 1000, { tau: 0.01, level: 1 });
  noise(out, input, hp(5000), { tau: 0.002, level: 0.3 });
  return out;
};

export const RECIPES: ReadonlyMap<SoundCue, SynthRecipe> = new Map<SoundCue, SynthRecipe>([
  ['fire-rifle', fireRifle],
  ['fire-pistol', firePistol],
  ['fire-sniper', fireSniper],
  ['dry-fire', dryFire],
  ['reload-start', reloadStart],
  ['reload-end', reloadEnd],
  ['hit-body', hitBody],
  ['hit-head', hitHead],
  ['enemy-death', enemyDeath],
  ['player-hurt', playerHurt],
  ['footstep', footstep],
  ['victory', victory],
  ['defeat', defeat],
  ['ui-click', uiClick],
]);
