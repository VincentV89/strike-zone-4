import { isBotCount, isDifficulty, isMapId } from './enums';
import { err, ok } from './result';
import type { MatchSetup, Result } from './types';

/** First-run defaults: Desert Compound, 5 bots, Normal (req-match-setup AC2). */
export const DEFAULT_MATCH_SETUP: MatchSetup = {
  mapId: 'desert-compound',
  botCount: 5,
  difficulty: 'normal',
};

export interface MatchSetupError {
  readonly field: 'root' | 'mapId' | 'botCount' | 'difficulty';
}

/**
 * Validates untrusted input from localStorage or the e2e hook (BR-K-13, SEC-K-02).
 * Reads the three fields into locals and returns a fresh three-field literal. It never
 * spreads, merges or iterates the input, so a `__proto__` key cannot reach the result
 * or Object.prototype. Errors name the field, never the value.
 */
export function parseMatchSetup(x: unknown): Result<MatchSetup, MatchSetupError> {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return err({ field: 'root' });
  const record = x as Record<string, unknown>;
  const mapId = record['mapId'];
  const botCount = record['botCount'];
  const difficulty = record['difficulty'];
  if (!isMapId(mapId)) return err({ field: 'mapId' });
  if (!isBotCount(botCount)) return err({ field: 'botCount' });
  if (!isDifficulty(difficulty)) return err({ field: 'difficulty' });
  return ok({ mapId, botCount, difficulty });
}
