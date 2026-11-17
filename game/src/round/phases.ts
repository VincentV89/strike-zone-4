/**
 * Round phase constants and the pause table (LC-ML-22, business-logic-model §2.6, BR-ML-12 to 17).
 */
import type { RoundPhase } from '@sz/kernel';
import type { SimGates } from '@sz/sim';

/** 3 s at 60 Hz (BR-ML-12). */
export const COUNTDOWN_TICKS = 180;

/** Countdown: the player may look but not move or fire; bots idle under gravity (BR-ML-13). */
export const COUNTDOWN_GATES: SimGates = Object.freeze({ move: false, fire: false, ai: false });
export const LIVE_GATES: SimGates = Object.freeze({ move: true, fire: true, ai: true });

export interface PauseState {
  readonly phase: RoundPhase;
  readonly paused: boolean;
  readonly countdownTicks: number;
}

/**
 * setPaused(p) per phase. Pausing in the countdown cancels it: back to Ready, paused, and the
 * next lock gain restarts a full 3 s countdown (BR-ML-16). Loading and ended ignore pause.
 */
export function applyPause(s: PauseState, p: boolean): PauseState {
  switch (s.phase) {
    case 'ready':
    case 'live':
      return { ...s, paused: p };
    case 'countdown':
      return p ? { phase: 'ready', paused: true, countdownTicks: COUNTDOWN_TICKS } : s;
    case 'loading':
    case 'ended':
      return s;
    default: {
      const never: never = s.phase;
      return never;
    }
  }
}

/** Phases in which look is applied (BR-ML-18). */
export function looksAllowed(phase: RoundPhase): boolean {
  return phase === 'ready' || phase === 'countdown' || phase === 'live';
}
