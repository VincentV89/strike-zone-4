/**
 * Round configuration and its single validation pass (SD-ML-2, BR-ML-10, SEC-ML-01/02).
 * The first failing check returns 'invalid-config' before any state changes.
 */
import { err, ok, parseMatchSetup, type MatchSetup, type Result } from '@sz/kernel';

export type RoundDurationSec = 120 | 180 | 300 | 600;

/** req-settings Q5. `includes` uses SameValueZero, so '120', NaN and 121 fail. */
export const ROUND_DURATIONS: ReadonlyArray<RoundDurationSec> = Object.freeze([120, 180, 300, 600]);

export interface RoundConfig {
  readonly setup: MatchSetup;
  readonly durationSec: RoundDurationSec;
  /** uint32. app-shell supplies it; e2e passes a fixed one. */
  readonly seed: number;
}

export function isRoundDuration(d: unknown): d is RoundDurationSec {
  return (ROUND_DURATIONS as ReadonlyArray<unknown>).includes(d);
}

export function isSeed(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 0xffffffff;
}

/** Returns a fresh frozen literal; extra keys are dropped and later caller mutation is ignored. */
export function parseRoundConfig(raw: unknown): Result<RoundConfig, 'invalid-config'> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return err('invalid-config');
  const record = raw as Record<string, unknown>;
  const setup = parseMatchSetup(record['setup']);
  if (!setup.ok) return err('invalid-config');
  const durationSec = record['durationSec'];
  if (!isRoundDuration(durationSec)) return err('invalid-config');
  const seed = record['seed'];
  if (!isSeed(seed)) return err('invalid-config');
  return ok(Object.freeze({ setup: Object.freeze(setup.value), durationSec, seed }));
}
