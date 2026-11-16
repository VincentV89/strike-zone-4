// BR-R-11, BR-R-12, FD-R-2: flinch and death timing.
import {
  DEATH_SEC,
  FLINCH_SEC,
  deathProgress,
  flinchAmount,
  horizontalUnit,
  resetReactions,
  startDeath,
  startFlinch,
  type ReactionState,
} from '@sz/render/core/reactions';
import { describe, expect, it } from 'vitest';

function fresh(): ReactionState {
  const r = { flinchStart: 0, flinchDx: 0, flinchDz: 0, deathStart: 0, deathDx: 0, deathDz: 0 };
  resetReactions(r);
  return r;
}

describe('bot reactions', () => {
  it('a hit starts a 150 ms flinch that eases out; a new hit restarts it', () => {
    const r = fresh();
    startFlinch(r, 1, 3, 4);
    expect([r.flinchDx, r.flinchDz]).toEqual([0.6, 0.8]);
    expect(flinchAmount(r, 1)).toBe(1);
    expect(flinchAmount(r, 1 + FLINCH_SEC / 2)).toBeCloseTo(0.25, 9);
    expect(flinchAmount(r, 1 + FLINCH_SEC)).toBeCloseTo(0, 12);
    startFlinch(r, 2, 0, 0);
    expect(flinchAmount(r, 2)).toBe(1);
    expect([r.flinchDx, r.flinchDz]).toEqual([0, 1]);
    expect(flinchAmount(r, 1.9)).toBe(0);
  });

  it('death runs 600 ms to lying flat, then stays; a dead bot never flinches again', () => {
    const r = fresh();
    startFlinch(r, 0, 1, 0);
    startDeath(r, 1, -1, 0);
    expect(flinchAmount(r, 1)).toBe(0);
    expect(deathProgress(r, 1)).toBe(0);
    expect(deathProgress(r, 1 + DEATH_SEC / 2)).toBeCloseTo(0.25, 9);
    expect(deathProgress(r, 1 + DEATH_SEC)).toBe(1);
    expect(deathProgress(r, 100)).toBe(1);
    startFlinch(r, 2, 1, 0);
    expect(flinchAmount(r, 2)).toBe(0);
    startDeath(r, 5, 0, 1);
    expect(r.deathStart).toBe(1);
    expect([r.deathDx, r.deathDz]).toEqual([-1, 0]);
  });

  it('horizontalUnit falls back for zero or non-finite input', () => {
    expect(horizontalUnit(0, 0, 1, 0)).toEqual([1, 0]);
    expect(horizontalUnit(Number.NaN, 1, 0, 1)).toEqual([0, 1]);
  });
});
