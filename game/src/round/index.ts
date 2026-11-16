// Public surface of round-controller (`@sz/round`). Re-exports only.
export { createRound } from './controller';
export type {
  AbandonResult,
  RestartResult,
  RoundController,
  RoundDeps,
  StartError,
} from './controller';
export { ROUND_DURATIONS, isRoundDuration, parseRoundConfig } from './config';
export type { RoundConfig, RoundDurationSec } from './config';
export { COUNTDOWN_TICKS } from './phases';
export { evaluateOutcome } from './outcome';
export type { RoundView } from './view';
