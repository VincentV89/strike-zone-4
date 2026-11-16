// SD-R-3 hostile-input table for the core guards.
import {
  asWeaponId,
  clampAlpha,
  clampDt,
  clampFov,
  finiteOr,
  finiteVec,
  listOr,
  safeDpr,
  weaponRow,
} from '@sz/render/core/guards';
import { describe, expect, it } from 'vitest';

const HOSTILE = [
  '__proto__',
  'constructor',
  'toString',
  '',
  'bot-0',
  'bot-21',
  Number.NaN,
  Infinity,
  -0,
  1e308,
  null,
  {},
  [],
];

describe('guards', () => {
  it('weapon lookups use own keys only', () => {
    for (const h of HOSTILE) {
      expect(weaponRow(h)).toBeUndefined();
      expect(asWeaponId(h)).toBeUndefined();
    }
    expect(weaponRow('sniper')?.scopedFovDeg).toBe(25);
    expect(asWeaponId('pistol')).toBe('pistol');
  });

  it('numbers fall back or clamp', () => {
    expect(finiteOr(Number.NaN, 3)).toBe(3);
    expect(finiteOr('1', 3)).toBe(3);
    expect(finiteOr(2, 3)).toBe(2);
    expect(clampFov(Infinity, 90)).toBe(90);
    expect(clampFov(20, 90)).toBe(60);
    expect(clampFov(200, 90)).toBe(110);
    expect([
      safeDpr(Number.NaN, 1.5),
      safeDpr(-2, 1.5),
      safeDpr(3, 1.5),
      safeDpr(1.25, 1.5),
      safeDpr(2, Number.NaN),
    ]).toEqual([1, 1, 1.5, 1.25, 1]);
    expect([clampAlpha(-1), clampAlpha(0.5), clampAlpha(1), clampAlpha(Number.NaN)]).toEqual([
      0, 0.5, 0.999999, 0,
    ]);
    expect([clampDt(-1), clampDt(0.05), clampDt(9), clampDt('x')]).toEqual([0, 0.05, 0.1, 0]);
  });

  it('vectors must be objects with three finite numbers', () => {
    expect(finiteVec({ x: 1, y: 2, z: 3 })).toBe(true);
    for (const v of [
      null,
      1,
      { x: 1, y: 2 },
      { x: 1, y: Number.NaN, z: 0 },
      { x: '1', y: 2, z: 3 },
    ]) {
      expect(finiteVec(v)).toBe(false);
    }
  });

  it('listOr replaces a non-array with an empty list', () => {
    expect(listOr([1, 2])).toEqual([1, 2]);
    expect(listOr('x' as unknown as number[])).toEqual([]);
  });
});
