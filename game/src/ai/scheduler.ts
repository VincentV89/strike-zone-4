/**
 * Decision scheduler (LC-AI-34, BR-AI-80) and per-brain seeds (LC-AI-C18, ADR-AI-6).
 * Bot i decides on ticks where (tick + i) % period === 0, so each bot decides at 10 Hz and at
 * most ceil(N / period) bots decide in one tick.
 */
import { STEP_HZ } from '@sz/kernel';

const DEFAULT_PERIOD = 6;

export interface AiScheduler {
  readonly period: number;
  shouldDecide(index: number, tick: number): boolean;
  maxPerTick(botCount: number): number;
}

export function createScheduler(tickHz: number = STEP_HZ, decideHz = 10): AiScheduler {
  const ratio = tickHz / decideHz;
  const period = Number.isInteger(ratio) && ratio > 0 ? ratio : DEFAULT_PERIOD;
  return Object.freeze({
    period,
    shouldDecide: (index: number, tick: number) =>
      Number.isInteger(index) &&
      Number.isInteger(tick) &&
      index >= 0 &&
      tick >= 0 &&
      (tick + index) % period === 0,
    maxPerTick: (botCount: number) =>
      Number.isInteger(botCount) && botCount > 0 ? Math.ceil(botCount / period) : 0,
  });
}

/** Mixes the match seed and the 0-based bot index into one 32-bit seed per brain. */
export function seedFor(matchSeed: number, botIndex: number): number {
  const s = Number.isFinite(matchSeed) ? matchSeed >>> 0 : 0;
  const i = Number.isInteger(botIndex) && botIndex >= 0 ? botIndex : 0;
  let h = Math.imul(s ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(i + 1, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  return h >>> 0;
}
