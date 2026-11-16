/**
 * End-of-round hold (PD-AS-10, business-logic-model "End hold"). Timed by accumulated frame dt,
 * never by setTimeout, so pause-free tests drive it with scripted frames.
 */
import type { RoundOutcome } from '@sz/kernel';

/** Seconds to hold the HUD before the end screen. */
export function holdFor(outcome: RoundOutcome, reducedMotion: boolean): number {
  switch (outcome) {
    case 'victory':
      return reducedMotion ? 0 : 0.6;
    case 'defeat':
      return reducedMotion ? 0.3 : 1.5;
    case 'time-expired':
    case 'abandoned':
      return 0;
  }
}

export interface HoldTimer {
  start(seconds: number): void;
  /** Adds dt; returns true exactly once, on the frame the hold elapses. */
  advance(dtSec: number): boolean;
  readonly active: boolean;
  reset(): void;
}

const EPS = 1e-9;

export function createHoldTimer(): HoldTimer {
  let active = false;
  let acc = 0;
  let target = 0;
  return {
    start(seconds) {
      active = true;
      acc = 0;
      target = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
    },
    advance(dtSec) {
      if (!active) return false;
      if (Number.isFinite(dtSec) && dtSec > 0) acc += dtSec;
      if (acc + EPS < target) return false;
      active = false;
      return true;
    },
    get active() {
      return active;
    },
    reset() {
      active = false;
      acc = 0;
      target = 0;
    },
  };
}
