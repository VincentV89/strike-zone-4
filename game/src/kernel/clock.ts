import { MAX_FRAME_SEC } from './constants';
import type { FixedClock, FrameSteps } from './types';

/** Floating-point tolerance for step counting (BR-K-19). */
const EPS = 1e-9;
/** Keeps alpha strictly below 1. */
const ALPHA_MAX = 1 - 1e-12;

export interface FixedClockOptions {
  readonly stepHz: 60;
  readonly maxSubsteps: 5;
}

/**
 * Fixed-timestep accumulator (dec-fixed-timestep, business-logic-model).
 *
 * The clock has no pause state. Pause means app-shell calls neither advance()
 * nor simulation.step() (BR-K-19a, story-pause-game), so the accumulator keeps
 * its fraction and resume continues from the frozen tick.
 */
export function createFixedClock(opts: FixedClockOptions): FixedClock {
  const stepSec = 1 / opts.stepHz;
  const maxSubsteps = opts.maxSubsteps;
  let acc = 0;

  function alphaOf(a: number): number {
    return Math.min(a / stepSec, ALPHA_MAX);
  }

  function advance(frameDtSec: number): FrameSteps {
    // BR-K-17: NaN, ±Infinity, 0 and negatives count as 0.
    if (!Number.isFinite(frameDtSec) || frameDtSec <= 0) {
      return { steps: 0, alpha: alphaOf(acc), droppedSec: 0 };
    }
    let dropped = 0;
    let dt = frameDtSec;
    if (dt > MAX_FRAME_SEC) {
      dropped += dt - MAX_FRAME_SEC; // BR-K-18
      dt = MAX_FRAME_SEC;
    }
    acc += dt;
    const whole = Math.floor((acc + EPS) / stepSec);
    const steps = Math.min(whole, maxSubsteps);
    if (whole > steps) dropped += (whole - steps) * stepSec; // discard, never carry
    acc -= whole * stepSec;
    if (acc < 0) acc = 0; // EPS can push it slightly negative
    return { steps, alpha: alphaOf(acc), droppedSec: dropped };
  }

  function reset(): void {
    acc = 0; // BR-K-19b
  }

  return { stepSec, advance, reset };
}
