import type { BotCount, BotStateName, Difficulty, MapId, RoundPhase, WeaponId } from './types';

/** Readonly tuples in display order. BOT_COUNTS is fixed by req-match-setup AC1 (BR-K-12). */
export const BOT_COUNTS: ReadonlyArray<BotCount> = [1, 2, 3, 5, 8, 10, 15, 20];
export const DIFFICULTIES: ReadonlyArray<Difficulty> = ['easy', 'normal', 'hard'];
export const MAP_IDS: ReadonlyArray<MapId> = ['desert-compound', 'industrial-warehouse'];
export const WEAPON_IDS: ReadonlyArray<WeaponId> = ['rifle', 'pistol', 'sniper'];
export const BOT_STATES: ReadonlyArray<BotStateName> = [
  'patrol',
  'investigate',
  'engage',
  'take-cover',
  'flank',
  'retreat',
  'dead',
];
export const ROUND_PHASES: ReadonlyArray<RoundPhase> = [
  'loading',
  'ready',
  'countdown',
  'live',
  'ended',
];

// Type guards over unknown. typeof first, then strict membership; no coercion (SEC-K-01).

export function isBotCount(value: unknown): value is BotCount {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    (BOT_COUNTS as ReadonlyArray<number>).includes(value)
  );
}

export function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === 'string' && (DIFFICULTIES as ReadonlyArray<string>).includes(value);
}

export function isMapId(value: unknown): value is MapId {
  return typeof value === 'string' && (MAP_IDS as ReadonlyArray<string>).includes(value);
}

export function isWeaponId(value: unknown): value is WeaponId {
  return typeof value === 'string' && (WEAPON_IDS as ReadonlyArray<string>).includes(value);
}
