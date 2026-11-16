/**
 * Per-decide context (LC-AI-10 `context(...)`): the facts every guard reads, computed once.
 * Built only from BotPercepts and BotSelfView (BR-AI-01).
 */
import type { BotPercepts, VisibleTarget } from '@sz/ai/perception';
import type { Vec3 } from '@sz/kernel';
import type { BotBrain } from './brain';
import { count, finiteNum } from './input-guards';
import { AI_RULES } from './rules';
import type { BotSelfView } from './types';

export interface DecideContext {
  readonly now: number;
  readonly self: BotSelfView;
  readonly seen: VisibleTarget | undefined;
  readonly lastKnown: { readonly pos: Vec3; readonly at: number } | undefined;
  readonly heard: BotPercepts['heardNoise'];
  readonly damage: BotPercepts['recentDamageFrom'];
  /** Seconds since the target was last seen; Infinity when nothing is known. */
  readonly lostFor: number;
  readonly freshDamage: boolean;
  readonly newNoise: boolean;
  readonly lowHealth: boolean;
  readonly magazine: number;
  readonly reserve: number;
  readonly hasAmmo: boolean;
  /** Set once a cover or retreat selection spent sight checks in this decide (BR-AI-82). */
  planUsed: boolean;
  /** Set when a path query was refused by the budget; stimuli then stay unhandled. */
  budgetRefused: boolean;
  /** Set when a non-urgent row was skipped for dwell; stimuli then stay unhandled. */
  dwellBlocked: boolean;
}

export function buildContext(
  brain: BotBrain,
  percepts: BotPercepts,
  self: BotSelfView,
  now: number,
): DecideContext {
  const seen = percepts.visibleTarget;
  const lastKnown = percepts.lastKnown;
  const damage = percepts.recentDamageFrom;
  const heard = percepts.heardNoise;
  const magazine = count(self.weapon.magazine);
  const reserve = count(self.weapon.reserve);
  const health = finiteNum(self.health) ? self.health : 0;
  return {
    now,
    self,
    seen,
    lastKnown,
    heard,
    damage,
    lostFor: seen ? 0 : lastKnown ? now - lastKnown.at : Infinity,
    freshDamage:
      damage !== undefined &&
      damage.at > brain.handled.damageAt &&
      now - damage.at <= AI_RULES.damageFreshSec,
    newNoise: heard !== undefined && heard.at > brain.handled.noiseAt,
    lowHealth: health < AI_RULES.retreatHealth,
    magazine,
    reserve,
    hasAmmo: magazine + reserve > 0,
    planUsed: false,
    budgetRefused: false,
    dwellBlocked: false,
  };
}

/** Marks the noise and damage stimuli of this decide as acted on. */
export function markHandled(brain: BotBrain, c: DecideContext): void {
  if (c.budgetRefused || c.dwellBlocked) return;
  if (c.heard && c.heard.at > brain.handled.noiseAt) brain.handled.noiseAt = c.heard.at;
  if (c.damage && c.damage.at > brain.handled.damageAt) brain.handled.damageAt = c.damage.at;
}
