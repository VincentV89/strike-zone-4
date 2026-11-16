/**
 * RoundView: the frozen pull contract for app-shell, ui-hud and the e2e hook
 * (domain-entities-match-loop "Round state", SD-ML-4). The controller memoises it.
 */
import { STEP_HZ, type MatchSetup, type RoundOutcome, type RoundPhase } from '@sz/kernel';
import type { RoundSummary, SessionTotals } from '@sz/stats';

export interface RoundView {
  readonly phase: RoundPhase;
  readonly paused: boolean;
  readonly started: boolean;
  /** ceil(countdownTicks / 60) while in the countdown phase. */
  readonly countdown?: 1 | 2 | 3;
  readonly timeLeftSec: number;
  readonly durationSec: number;
  readonly outcome?: RoundOutcome;
  readonly summary?: RoundSummary;
  readonly setup?: MatchSetup;
  readonly totals: SessionTotals;
}

export interface ViewInput {
  readonly phase: RoundPhase;
  readonly paused: boolean;
  readonly started: boolean;
  readonly countdownTicks: number;
  readonly liveTicks: number;
  readonly durationSec: number;
  readonly outcome: RoundOutcome | undefined;
  readonly summary: RoundSummary | undefined;
  readonly setup: MatchSetup | undefined;
  readonly totals: SessionTotals;
}

function countdownOf(ticks: number): 1 | 2 | 3 {
  const n = Math.ceil(ticks / STEP_HZ);
  return n >= 3 ? 3 : n <= 1 ? 1 : 2;
}

export function buildView(i: ViewInput): RoundView {
  return Object.freeze({
    phase: i.phase,
    paused: i.paused,
    started: i.started,
    ...(i.phase === 'countdown' ? { countdown: countdownOf(i.countdownTicks) } : {}),
    timeLeftSec: Math.max(0, i.durationSec - i.liveTicks / STEP_HZ),
    durationSec: i.durationSec,
    ...(i.outcome === undefined ? {} : { outcome: i.outcome }),
    ...(i.summary === undefined ? {} : { summary: i.summary }),
    ...(i.setup === undefined ? {} : { setup: i.setup }),
    totals: i.totals,
  });
}
