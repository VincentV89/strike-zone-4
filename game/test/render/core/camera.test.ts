// FD-R-1, BR-R-05, BR-R-06, req-player-collision AC2: FOV maths and the eye pose.
import {
  CAMERA_NEAR,
  DEATH_EYE_M,
  createCameraPose,
  horizontalFovDeg,
  updateCamera,
  verticalFovDeg,
} from '@sz/render/core/camera';
import { vec3 } from '@sz/kernel';
import { DEFAULT_CAPSULE } from '@sz/physics';
import { describe, expect, it } from 'vitest';
import { player } from '../../support/render-frames';

const base = {
  fovDeg: 90,
  aspect: 16 / 9,
  drawDistanceM: 90,
  scopedFovDeg: null,
  deathT: -1,
  reducedMotion: false,
};

describe('FOV (FD-R-1)', () => {
  it('90° horizontal at 16:9 gives about 58.7° vertical', () => {
    expect(verticalFovDeg(90, 16 / 9)).toBeCloseTo(58.72, 1);
  });

  it.each([60, 75, 90, 110])('the derived horizontal FOV equals the setting (%s°)', (h) => {
    for (const aspect of [4 / 3, 16 / 9, 21 / 9]) {
      expect(horizontalFovDeg(verticalFovDeg(h, aspect), aspect)).toBeCloseTo(h, 6);
    }
  });

  it('clamps the setting to [60, 110] and defaults bad input', () => {
    expect(verticalFovDeg(10, 1)).toBeCloseTo(verticalFovDeg(60, 1), 9);
    expect(verticalFovDeg(500, 1)).toBeCloseTo(verticalFovDeg(110, 1), 9);
    expect(verticalFovDeg(Number.NaN, 1)).toBeCloseTo(verticalFovDeg(90, 1), 9);
    expect(verticalFovDeg(90, 0)).toBeCloseTo(verticalFovDeg(90, 16 / 9), 9);
  });

  it('the scope overrides with its vertical FOV', () => {
    const c = updateCamera(createCameraPose(), player(), undefined, 0, {
      ...base,
      scopedFovDeg: 25,
    });
    expect(c.vFovDeg).toBe(25);
  });
});

describe('eye pose', () => {
  it('interpolates feet position and adds the eye height', () => {
    const p = player({ prevPos: vec3(0, 0, 0), pos: vec3(2, 0, -4), eyeHeight: 1.62 });
    const c = updateCamera(createCameraPose(), p, undefined, 0.5, base);
    expect([c.x, c.y, c.z]).toEqual([1, 1.62, -2]);
    expect(c.far).toBe(100);
  });

  it('lerps the eye height from the previous snapshot during a stance change', () => {
    const prev = player({ eyeHeight: 1.62 });
    const curr = player({ eyeHeight: 1.05 });
    const c = updateCamera(createCameraPose(), curr, prev, 0.5, base);
    expect(c.y).toBeCloseTo((1.62 + 1.05) / 2, 9);
  });

  it('near plane is ≤ 0.1 m and smaller than the capsule radius (BR-R-06)', () => {
    expect(CAMERA_NEAR).toBeLessThanOrEqual(0.1);
    expect(CAMERA_NEAR).toBeLessThan(DEFAULT_CAPSULE.radius);
  });

  it('death camera lowers to 0.4 m and rolls 20° over 0.6 s; reduced motion stays still', () => {
    const p = player();
    const dead = updateCamera(createCameraPose(), p, undefined, 0, { ...base, deathT: 0.6 });
    expect(dead.y).toBeCloseTo(DEATH_EYE_M, 9);
    expect(dead.roll).toBeCloseTo((20 * Math.PI) / 180, 9);
    const still = updateCamera(createCameraPose(), p, undefined, 0, {
      ...base,
      deathT: 0.6,
      reducedMotion: true,
    });
    expect(still.y).toBeCloseTo(1.62, 9);
    expect(still.roll).toBe(0);
  });

  it('non-finite input keeps the previous pose', () => {
    const c = createCameraPose();
    updateCamera(
      c,
      player({ pos: vec3(1, 0, 1), prevPos: vec3(1, 0, 1), yaw: 0.5 }),
      undefined,
      0,
      base,
    );
    updateCamera(c, player({ pos: vec3(Number.NaN, 0, 0), yaw: Number.NaN }), undefined, 0, base);
    expect([c.x, c.z, c.yaw]).toEqual([1, 1, 0.5]);
  });
});
