import { toCount } from './guards';
import type { DamageOutcome, Vitals } from './types';

/** BR-C-10: armor absorbs up to half of each hit, capped by the armor left. */
export const ARMOR_ABSORB_RATIO = 0.5;

/** Starting vitals: player createVitals(100, 100), every bot createVitals(100, 0) (BR-C-15). */
export const PLAYER_START_VITALS: Vitals = Object.freeze({ health: 100, armor: 100 });
export const BOT_START_VITALS: Vitals = Object.freeze({ health: 100, armor: 0 });

/** Rounds each value to an integer; negative or non-finite becomes 0 (BR-C-15). */
export function createVitals(health = 100, armor = 0): Vitals {
  return { health: toCount(health), armor: toCount(armor) };
}

/**
 * BR-C-10 to BR-C-13. Integer in, integer out. Damage to a dead actor, or a raw value that
 * is not a positive finite number, changes nothing. `killed` is true only on the
 * positive-to-zero transition, so death fires exactly once.
 */
export function applyDamage(v: Vitals, raw: number): DamageOutcome {
  const health = toCount(v.health);
  const armor = toCount(v.armor);
  const amount = toCount(raw);
  if (health === 0 || amount === 0) {
    return { vitals: { health, armor }, healthLost: 0, armorLost: 0, killed: false };
  }
  const absorbed = Math.min(armor, Math.floor(amount * ARMOR_ABSORB_RATIO));
  const healthAfter = Math.max(0, health - (amount - absorbed));
  return {
    vitals: { health: healthAfter, armor: armor - absorbed },
    healthLost: health - healthAfter,
    armorLost: absorbed,
    killed: healthAfter === 0,
  };
}
