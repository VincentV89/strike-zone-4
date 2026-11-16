// SD-R-6, CMP-R-03, BR-R-20: every muzzle flash covers < 2% of the viewport.
import {
  MAX_FLASH_AREA,
  VIEWMODEL_FOV_DEG,
  VM_FLASH_DIST,
  VM_FLASH_SIZE,
  flashWorldSize,
  projectedAreaFraction,
} from '@sz/render/core/flash';
import { WORLD_MUZZLE_BASE_M } from '@sz/render/core/effects';
import { describe, expect, it } from 'vitest';

const DEG = Math.PI / 180;

describe('flash size cap', () => {
  it('stays under 2% for distance 0.3–140 m, vertical FOV 25–110°, aspect 4:3–21:9', () => {
    for (const dist of [0.3, 0.5, 1, 2, 5, 10, 30, 60, 140]) {
      for (const v of [25, 40, 58.7, 75, 90, 110]) {
        for (const aspect of [4 / 3, 16 / 10, 16 / 9, 21 / 9]) {
          const size = flashWorldSize(WORLD_MUZZLE_BASE_M, dist, v * DEG, aspect);
          expect(projectedAreaFraction(size, dist, v * DEG, aspect)).toBeLessThan(MAX_FLASH_AREA);
        }
      }
    }
  });

  it('keeps the base size when it is already small enough', () => {
    expect(flashWorldSize(0.35, 60, 58.7 * DEG, 16 / 9)).toBe(0.35);
  });

  it('the viewmodel flash is ≈1.2% at 4:3 and smaller on wider screens', () => {
    const at43 = projectedAreaFraction(
      VM_FLASH_SIZE,
      VM_FLASH_DIST,
      VIEWMODEL_FOV_DEG * DEG,
      4 / 3,
    );
    expect(at43).toBeGreaterThan(0.011);
    expect(at43).toBeLessThan(0.013);
    const at169 = projectedAreaFraction(
      VM_FLASH_SIZE,
      VM_FLASH_DIST,
      VIEWMODEL_FOV_DEG * DEG,
      16 / 9,
    );
    expect(at169).toBeLessThan(at43);
  });

  it('hostile numbers never produce a large or non-finite size', () => {
    for (const [d, v, a] of [
      [Number.NaN, 1, 1],
      [-5, 1, 1],
      [1, Number.NaN, 1],
      [1, 1, 0],
    ] as const) {
      const s = flashWorldSize(0.35, d, v, a);
      expect(Number.isFinite(s)).toBe(true);
      expect(s).toBeLessThanOrEqual(0.35);
    }
    expect(flashWorldSize(Number.NaN, 1, 1, 1)).toBe(0);
    expect(projectedAreaFraction(1, 0, 1, 1)).toBe(1);
  });
});
