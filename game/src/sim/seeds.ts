/**
 * All seed derivation for a round (security-design-match-loop SD-ML-1 gap, BR-ML-01, REL-ML-4).
 * Every random stream is disjoint per consumer: spawn selection, each brain, each weapon.
 * round imports spawnSeed from here because it may not import @sz/ai.
 */
import { seedFor } from '@sz/ai';

export const SPAWN_SALT = 0xa11ce;
export const PLAYER_WEAPON_SALT = 0x27d4eb2f;
/** Matches test/support/ai-arena.ts, so arena and sim bot weapons draw the same streams. */
export const BOT_WEAPON_SALT = 0x5bd1e995;

export function spawnSeed(seed: number): number {
  return seedFor(seed, SPAWN_SALT);
}

export function brainSeed(seed: number, botIndex: number): number {
  return seedFor(seed, botIndex);
}

export function playerWeaponSeed(seed: number): number {
  return seedFor((seed ^ PLAYER_WEAPON_SALT) >>> 0, 0);
}

export function botWeaponSeed(seed: number, botIndex: number): number {
  return seedFor((seed ^ BOT_WEAPON_SALT) >>> 0, botIndex);
}
