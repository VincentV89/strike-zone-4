import type { RoundOutcome } from '@sz/kernel';
import { addSat } from './saturate';

/** Rounds won and lost this page session (BR-ML-23). Immutable; replaced on each outcome. */
export interface SessionTotals {
  readonly roundsWon: number;
  readonly roundsLost: number;
}

const count = (n: unknown): number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : 0;

/** app-shell seeds totals from persistence; invalid counts become 0. */
export function createSessionTotals(
  roundsWon: unknown = 0,
  roundsLost: unknown = 0,
): SessionTotals {
  return Object.freeze({ roundsWon: count(roundsWon), roundsLost: count(roundsLost) });
}

export const ZERO_TOTALS: SessionTotals = createSessionTotals();

/** Victory: won +1. Defeat, time-expired and abandoned: lost +1. */
export function applyOutcome(t: SessionTotals, outcome: RoundOutcome): SessionTotals {
  return outcome === 'victory'
    ? Object.freeze({ roundsWon: addSat(t.roundsWon, 1), roundsLost: t.roundsLost })
    : Object.freeze({ roundsWon: t.roundsWon, roundsLost: addSat(t.roundsLost, 1) });
}
