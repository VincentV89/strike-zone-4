/**
 * Variant choice and pitch jitter (BR-A-36, BR-A-37). Randomness comes from an
 * injected kernel Rng (createRng(PLAYBACK_SEED) in the adapter), never Math.random.
 */
import type { Rng } from '@sz/kernel';
import type { SoundCue } from './types';

export interface VariantPicker {
  /** Round-robin from a random start; never repeats the previous variant when count > 1. */
  next(cue: SoundCue, count: number): number;
}

export function createVariantPicker(rng: Rng): VariantPicker {
  const last = new Map<SoundCue, number>();
  return {
    next(cue, count) {
      const n = Math.floor(count);
      if (!(n > 1)) return 0;
      const prev = last.get(cue);
      const index = prev === undefined ? Math.floor(rng.next() * n) % n : (prev + 1) % n;
      last.set(cue, index);
      return index;
    },
  };
}

/** playbackRate = 1 + jitter × (2r - 1). */
export function pitchRate(rng: Rng, jitter: number): number {
  return 1 + jitter * (2 * rng.next() - 1);
}

export interface PlaybackRandom {
  /** BR-A-37 playbackRate for a cue with this jitter. */
  rate(jitter: number): number;
  /** BR-A-36 variant index. */
  variant(cue: SoundCue, count: number): number;
}

/** One presentation Rng shared by pitch jitter and variant starts. */
export function createPlaybackRandom(rng: Rng): PlaybackRandom {
  const picker = createVariantPicker(rng);
  return {
    rate: (jitter) => pitchRate(rng, jitter),
    variant: (cue, count) => picker.next(cue, count),
  };
}
