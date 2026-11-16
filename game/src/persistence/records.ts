/**
 * Last match setup, history entries and the lifetime record (business-logic-model-ui-hud §4.2,
 * SD-UI-10). Each validator takes unknown and returns a fresh frozen value or a default.
 */
import {
  DEFAULT_MATCH_SETUP,
  parseMatchSetup,
  type MatchSetup,
  type RoundOutcome,
} from '@sz/kernel';
import { createSessionTotals, type RoundSummary, type SessionTotals } from '@sz/stats';
import { isPlainRecord, own } from './envelope';

export const HISTORY_LIMIT = 20;
/** The longest round is 600 s of live time; summary durations are live ticks / 60. */
const MAX_DURATION_SEC = 600;

export interface HistoryEntry {
  readonly seq: number;
  /** Epoch ms from the injected now(). */
  readonly at: number;
  readonly outcome: RoundOutcome;
  readonly setup: MatchSetup;
  readonly kills: number;
  readonly deaths: number;
  readonly headshots: number;
  readonly accuracyPct: number;
  readonly damageDealt: number;
  readonly durationSec: number;
}

const OUTCOMES: ReadonlySet<unknown> = new Set<RoundOutcome>([
  'victory',
  'defeat',
  'time-expired',
  'abandoned',
]);

const isCount = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

function freezeSetup(s: MatchSetup): MatchSetup {
  return Object.freeze({ mapId: s.mapId, botCount: s.botCount, difficulty: s.difficulty });
}

/** Last-used setup through the kernel validator; a bad value gives the first-run default. */
export function validateLastSetup(x: unknown): MatchSetup {
  const r = parseMatchSetup(x);
  return freezeSetup(r.ok ? r.value : DEFAULT_MATCH_SETUP);
}

export function validateHistoryEntry(x: unknown): HistoryEntry | undefined {
  if (!isPlainRecord(x)) return undefined;
  const seq = own(x, 'seq');
  const at = own(x, 'at');
  const outcome = own(x, 'outcome');
  const setup = parseMatchSetup(own(x, 'setup'));
  const kills = own(x, 'kills');
  const deaths = own(x, 'deaths');
  const headshots = own(x, 'headshots');
  const accuracyPct = own(x, 'accuracyPct');
  const damageDealt = own(x, 'damageDealt');
  const durationSec = own(x, 'durationSec');
  if (!isCount(seq) || typeof at !== 'number' || !Number.isFinite(at)) return undefined;
  if (!OUTCOMES.has(outcome) || !setup.ok) return undefined;
  if (!isCount(kills) || !isCount(deaths) || !isCount(headshots) || !isCount(damageDealt)) {
    return undefined;
  }
  if (!isCount(accuracyPct) || accuracyPct > 100) return undefined;
  if (typeof durationSec !== 'number' || !Number.isFinite(durationSec)) return undefined;
  if (durationSec < 0 || durationSec > MAX_DURATION_SEC) return undefined;
  return Object.freeze({
    seq,
    at,
    outcome: outcome as RoundOutcome,
    setup: freezeSetup(setup.value),
    kills,
    deaths,
    headshots,
    accuracyPct,
    damageDealt,
    durationSec,
  });
}

/** Drops invalid entries, keeps the newest 20 by seq (BR-UI-10). */
export function validateHistory(x: unknown): ReadonlyArray<HistoryEntry> {
  if (!Array.isArray(x)) return Object.freeze([]);
  const valid: HistoryEntry[] = [];
  for (const item of x as ReadonlyArray<unknown>) {
    const e = validateHistoryEntry(item);
    if (e) valid.push(e);
  }
  valid.sort((a, b) => b.seq - a.seq);
  return Object.freeze(valid.slice(0, HISTORY_LIMIT));
}

export function entryFromSummary(s: RoundSummary, seq: number, at: number): HistoryEntry {
  return Object.freeze({
    seq,
    at: Number.isFinite(at) ? at : 0,
    outcome: s.outcome,
    setup: freezeSetup(s.setup),
    kills: s.kills,
    deaths: s.deaths,
    headshots: s.headshots,
    accuracyPct: s.accuracyPct,
    damageDealt: s.damageDealt,
    durationSec: Math.min(MAX_DURATION_SEC, Math.max(0, s.durationSec)),
  });
}

/** Lifetime W/L (FD-UI-1). createSessionTotals turns invalid counts into 0. */
export function validateRecord(x: unknown): SessionTotals {
  if (!isPlainRecord(x)) return createSessionTotals();
  return createSessionTotals(own(x, 'roundsWon'), own(x, 'roundsLost'));
}

export function historyData(h: ReadonlyArray<HistoryEntry>): unknown {
  return h.map((e) => ({
    seq: e.seq,
    at: e.at,
    outcome: e.outcome,
    setup: { mapId: e.setup.mapId, botCount: e.setup.botCount, difficulty: e.setup.difficulty },
    kills: e.kills,
    deaths: e.deaths,
    headshots: e.headshots,
    accuracyPct: e.accuracyPct,
    damageDealt: e.damageDealt,
    durationSec: e.durationSec,
  }));
}
