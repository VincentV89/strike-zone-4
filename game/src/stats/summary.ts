import { STEP_HZ, type MatchSetup, type RoundOutcome } from '@sz/kernel';
import type { RoundStats } from './round-stats';
import type { SessionTotals } from './totals';

export type SummaryLabel = 'Victory' | 'Defeat' | 'Time Expired' | 'Abandoned';

/** Input of the end-of-round screen and match history (BR-ML-55). No wall-clock time (BR-ML-56). */
export interface RoundSummary {
  readonly outcome: RoundOutcome;
  /** time-expired and abandoned count as defeat (BR-ML-22). */
  readonly result: 'victory' | 'defeat';
  readonly label: SummaryLabel;
  readonly setup: MatchSetup;
  readonly kills: number;
  readonly deaths: number;
  readonly headshots: number;
  readonly shotsFired: number;
  readonly shotsHit: number;
  /** Integer 0..100. */
  readonly accuracyPct: number;
  readonly damageDealt: number;
  readonly damageReceived: number;
  readonly enemiesRemaining: number;
  /** Live ticks / 60, rounded to 2 decimals; excludes the countdown and pauses (BR-ML-20). */
  readonly durationSec: number;
  readonly totals: SessionTotals;
}

export interface SummaryInput {
  readonly outcome: RoundOutcome;
  readonly liveTicks: number;
  readonly enemiesRemaining: number;
  readonly setup: MatchSetup;
  readonly totals: SessionTotals;
}

const LABELS: ReadonlyMap<RoundOutcome, SummaryLabel> = new Map([
  ['victory', 'Victory'],
  ['defeat', 'Defeat'],
  ['time-expired', 'Time Expired'],
  ['abandoned', 'Abandoned'],
]);

/** shotsHit / shotsFired as a fraction; 0 when no shot was fired (BR-ML-54). */
export function accuracy(s: Pick<RoundStats, 'shotsFired' | 'shotsHit'>): number {
  return s.shotsFired > 0 ? Math.min(1, s.shotsHit / s.shotsFired) : 0;
}

export function accuracyPct(s: Pick<RoundStats, 'shotsFired' | 'shotsHit'>): number {
  return Math.round(100 * accuracy(s));
}

const round2 = (x: number): number => Math.round(x * 100) / 100;
const nonNegInt = (n: number): number => (Number.isSafeInteger(n) && n >= 0 ? n : 0);

/** Builds the frozen summary from an explicit field list (SD-ML-6, SEC-ML-24). */
export function summarize(s: RoundStats, input: SummaryInput): RoundSummary {
  const { outcome, setup, totals } = input;
  return Object.freeze({
    outcome,
    result: outcome === 'victory' ? 'victory' : 'defeat',
    label: LABELS.get(outcome) ?? 'Defeat',
    setup: Object.freeze({
      mapId: setup.mapId,
      botCount: setup.botCount,
      difficulty: setup.difficulty,
    }),
    kills: s.kills,
    deaths: s.deaths,
    headshots: s.headshots,
    shotsFired: s.shotsFired,
    shotsHit: s.shotsHit,
    accuracyPct: accuracyPct(s),
    damageDealt: s.damageDealt,
    damageReceived: s.damageReceived,
    enemiesRemaining: nonNegInt(input.enemiesRemaining),
    durationSec: round2(nonNegInt(input.liveTicks) / STEP_HZ),
    totals: Object.freeze({ roundsWon: totals.roundsWon, roundsLost: totals.roundsLost }),
  });
}
