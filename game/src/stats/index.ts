// Public surface of match-stats (`@sz/stats`). Re-exports only.
export { addSat } from './saturate';
export { createRoundStats, recordEvent } from './round-stats';
export type { RoundStats } from './round-stats';
export { ZERO_TOTALS, applyOutcome, createSessionTotals } from './totals';
export type { SessionTotals } from './totals';
export { accuracy, accuracyPct, summarize } from './summary';
export type { RoundSummary, SummaryInput, SummaryLabel } from './summary';
