/**
 * Frame planner (PD-AS-1, PD-AS-3, PD-AS-4). Pure and allocation-light: the DOM loop asks it how
 * much wall time to feed the clock, whether to sample the probe and whether the round runs.
 */
import type { RoundPhase } from '@sz/kernel';

/** dt clamp (BR-AS-31 neighbourhood): a backgrounded tab never floods the clock. */
export const MAX_FRAME_DT_SEC = 0.25;

export interface FramePlan {
  /** Wall time to feed the clock, clamped to [0, 0.25]. */
  readonly dtSec: number;
  /** Raw frame time in ms for the probe. */
  readonly frameMs: number;
  /** False on the first frame after start and on frames of 0.25 s or more (tab backgrounding). */
  readonly sample: boolean;
}

export function planFrame(tMs: number, lastMs: number | undefined): FramePlan {
  if (lastMs === undefined || !Number.isFinite(tMs) || !Number.isFinite(lastMs)) {
    return { dtSec: 0, frameMs: 0, sample: false };
  }
  const raw = (tMs - lastMs) / 1000;
  const dtSec = raw > 0 ? Math.min(raw, MAX_FRAME_DT_SEC) : 0;
  return { dtSec, frameMs: raw > 0 ? raw * 1000 : 0, sample: raw > 0 && raw < MAX_FRAME_DT_SEC };
}

export interface RunInput {
  readonly phase: RoundPhase;
  readonly paused: boolean;
}

/**
 * The clock advances and the round ticks only in countdown and live, unpaused, with a GL context
 * (PD-AS-4). Ready never steps the sim (match-loop), so it does not advance the clock.
 */
export function isRunning(view: RunInput, contextLost: boolean): boolean {
  return !contextLost && !view.paused && (view.phase === 'countdown' || view.phase === 'live');
}
