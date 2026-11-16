// Internal entry guards (SD-P-4). Not re-exported from the barrel.
import { MAX_SUBSTEPS, clamp } from '@sz/kernel';

/** v when it is a finite number, otherwise fallback. */
export function finiteOr(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback;
}

/** Non-finite → fallback, then clamped to [lo, hi]. */
export function clampFinite(v: number, lo: number, hi: number, fallback: number): number {
  return clamp(finiteOr(v, fallback), lo, hi);
}

/** Tick count as clamp(floor(steps), 0, MAX_SUBSTEPS); NaN and Infinity count as 0 (BR-P-62). */
export function tickCount(steps: number): number {
  if (!Number.isFinite(steps) || steps <= 0) return 0;
  return Math.min(Math.floor(steps), MAX_SUBSTEPS);
}

/** Axis value normalised to -1, 0 or 1; anything non-finite is 0. */
export function axis(v: number): -1 | 0 | 1 {
  if (!Number.isFinite(v) || v === 0) return 0;
  return v > 0 ? 1 : -1;
}
