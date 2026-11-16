/**
 * Per-tick path query limiter (BR-WM-49). simulation calls resetTick first in every tick;
 * bot-ai calls tryConsume before every path query and keeps its old path on false.
 */
import type { PathBudget } from './types';

export const DEFAULT_MAX_PATH_QUERIES_PER_TICK = 4;
const MAX_ALLOWED = 1000;

export function createPathBudget(
  maxQueriesPerTick: number = DEFAULT_MAX_PATH_QUERIES_PER_TICK,
): PathBudget {
  const max =
    Number.isInteger(maxQueriesPerTick) && maxQueriesPerTick >= 0
      ? Math.min(maxQueriesPerTick, MAX_ALLOWED)
      : DEFAULT_MAX_PATH_QUERIES_PER_TICK;
  let used = 0;
  return {
    maxQueriesPerTick: max,
    tryConsume() {
      if (used >= max) return false;
      used++;
      return true;
    },
    resetTick() {
      used = 0;
    },
  };
}
