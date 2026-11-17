/**
 * Sound bank synthesis and validation (business-logic-model-game-audio W1,
 * BR-A-60 to BR-A-65). Pure: the event-loop yield is injected.
 */
import { createRng } from '@sz/kernel';
import { CUE_DEFINITIONS } from './cues';
import { finish, meanOf, peakOf, samplesFor } from './dsp';
import { RECIPES, type SynthRecipe } from './recipes';
import type { CueDefinition, PcmClip, SoundBankPcm, SoundCue } from './types';

export const BANK_SEED = 20261115;
export const BANK_SAMPLE_RATE = 48000;
/** BR-A-64: at most 12 s of audio in the bank. */
export const MAX_BANK_SAMPLES = 12 * BANK_SAMPLE_RATE;

const MIN_PEAK = 0.05;
const MAX_PEAK = 0.95;
const MAX_EDGE = 1e-3;
const MAX_DC = 0.01;

export type YieldFn = () => Promise<void>;

export interface SynthesizeOptions {
  readonly yieldFn: YieldFn;
  /** Test seam: replaces the recipe table. */
  readonly recipes?: ReadonlyMap<SoundCue, SynthRecipe>;
}

/** BR-A-61: seed = BANK_SEED + 101 × cueIndex + variant. */
export function clipSeed(cueIndex: number, variant: number): number {
  return BANK_SEED + 101 * cueIndex + variant;
}

export function synthesizeClip(
  recipe: SynthRecipe,
  cueIndex: number,
  def: CueDefinition,
  variant: number,
): PcmClip {
  const fs = BANK_SAMPLE_RATE;
  const n = samplesFor(def.durationSec, fs);
  const rng = createRng(clipSeed(cueIndex, variant));
  const raw = recipe({ rng, variant, fs, n });
  return { samples: finish(raw, fs), sampleRate: fs };
}

/** Thrown when the bank fails validation (BR-A-70 wraps it in AudioBootFailure). */
export class BankValidationError extends Error {
  readonly problems: ReadonlyArray<string>;
  constructor(problems: ReadonlyArray<string>) {
    super(`sound bank invalid: ${problems.slice(0, 3).join('; ')}`);
    this.name = 'BankValidationError';
    this.problems = problems;
  }
}

/** Synthesises every clip in table order, yielding between clips (BR-A-65). */
export async function synthesizeBank(opts: SynthesizeOptions): Promise<SoundBankPcm> {
  const recipes = opts.recipes ?? RECIPES;
  const clips = new Map<SoundCue, PcmClip[]>();
  let totalSamples = 0;
  for (const [cueIndex, def] of CUE_DEFINITIONS.entries()) {
    const recipe = recipes.get(def.id);
    if (recipe === undefined) throw new BankValidationError([`${def.id}: no recipe`]);
    const list: PcmClip[] = [];
    for (let v = 0; v < def.variants; v++) {
      const clip = synthesizeClip(recipe, cueIndex, def, v);
      list.push(clip);
      totalSamples += clip.samples.length;
      await opts.yieldFn();
    }
    clips.set(def.id, list);
  }
  const bank: SoundBankPcm = { sampleRate: BANK_SAMPLE_RATE, clips, totalSamples };
  const problems = validateBank(bank);
  if (problems.length > 0) throw new BankValidationError(problems);
  return bank;
}

/** BR-A-63 checks for one clip. Returns human-readable problems, empty when valid. */
export function validateClip(def: CueDefinition, clip: PcmClip, label: string): string[] {
  const problems: string[] = [];
  const x = clip.samples;
  const expected = samplesFor(def.durationSec, BANK_SAMPLE_RATE);
  if (clip.sampleRate !== BANK_SAMPLE_RATE) problems.push(`${label}: sample rate`);
  if (x.length !== expected) problems.push(`${label}: length ${x.length} != ${expected}`);
  if (!x.every((v) => Number.isFinite(v))) {
    problems.push(`${label}: non-finite sample`);
    return problems;
  }
  const peak = peakOf(x);
  if (peak < MIN_PEAK || peak > MAX_PEAK) problems.push(`${label}: peak ${peak.toFixed(3)}`);
  const first = Math.abs(x[0] ?? 1);
  const last = Math.abs(x[x.length - 1] ?? 1);
  if (first >= MAX_EDGE || last >= MAX_EDGE) problems.push(`${label}: edges not faded`);
  if (Math.abs(meanOf(x)) > MAX_DC) problems.push(`${label}: DC offset`);
  return problems;
}

/** BR-A-63 and BR-A-64 checks for the whole bank. */
export function validateBank(bank: SoundBankPcm): string[] {
  const problems: string[] = [];
  let total = 0;
  for (const def of CUE_DEFINITIONS) {
    const list = bank.clips.get(def.id) ?? [];
    if (list.length !== def.variants) problems.push(`${def.id}: ${list.length} variants`);
    list.forEach((clip, v) => {
      total += clip.samples.length;
      problems.push(...validateClip(def, clip, `${def.id}#${v}`));
    });
  }
  if (total !== bank.totalSamples) problems.push('totalSamples mismatch');
  if (total > MAX_BANK_SAMPLES) problems.push(`bank too long: ${total} samples`);
  return problems;
}
