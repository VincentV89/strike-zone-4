/**
 * Pure outcome and abandon rules (LC-ML-23, BR-ML-21 to BR-ML-27, SEC-ML-32).
 * Checked after every live tick in this order: victory, defeat, time-expired.
 */
import { STEP_HZ, type RoundOutcome, type RoundPhase } from '@sz/kernel';

export interface OutcomeInput {
  readonly aliveBots: number;
  readonly playerAlive: boolean;
  readonly liveTicks: number;
  readonly durationSec: number;
}

/**
 * Victory first: the player's shots resolve before any bot fires in a tick, so the last kill on
 * the final timer tick is a victory and no bot can kill the player after the last bot dies.
 */
export function evaluateOutcome(i: OutcomeInput): Exclude<RoundOutcome, 'abandoned'> | null {
  if (i.aliveBots <= 0) return 'victory';
  if (!i.playerAlive) return 'defeat';
  if (i.liveTicks >= i.durationSec * STEP_HZ) return 'time-expired';
  return null;
}

/** Q2: an abandon counts as a loss only after GO and before an outcome (BR-ML-27). */
export function shouldRecordAbandon(started: boolean, phase: RoundPhase): boolean {
  return started && phase === 'live';
}
