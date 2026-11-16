import { degToRad, vec3 } from '@sz/kernel';
import {
  LOOK_TUNING,
  applyLook,
  applyRecoil,
  createPlayerMotion,
  effectiveSensitivity,
} from '@sz/player';
import { describe, expect, it } from 'vitest';

const fresh = () => createPlayerMotion({ position: vec3(0, 0, 0), yaw: 0 });
const PITCH_89 = degToRad(89);

describe('applyLook (story-mouse-look, BR-P-10 to BR-P-13)', () => {
  it.each([
    [50, 1],
    [100, 1],
    [50, 2],
    [100, 2],
  ])('AC2: Δyaw = −dx × 0.0022 × s for dx=%d, s=%d', (dx, s) => {
    const m = fresh();
    applyLook(m, { dx, dy: 0 }, s);
    expect(m.yaw).toBeCloseTo(-dx * 0.0022 * s, 12);
  });

  it('doubling dx or sensitivity doubles the yaw change', () => {
    const a = fresh();
    const b = fresh();
    const c = fresh();
    applyLook(a, { dx: 40, dy: 0 }, 1);
    applyLook(b, { dx: 80, dy: 0 }, 1);
    applyLook(c, { dx: 40, dy: 0 }, 2);
    expect(b.yaw / a.yaw).toBeCloseTo(2, 12);
    expect(c.yaw / a.yaw).toBeCloseTo(2, 12);
  });

  it('mouse right turns right (yaw decreases), mouse down looks down', () => {
    const m = fresh();
    applyLook(m, { dx: 10, dy: 10 }, 1);
    expect(m.yaw).toBeLessThan(0);
    expect(m.pitch).toBeLessThan(0);
  });

  it('AC3: pitch never exceeds ±89° under extreme deltas over many frames', () => {
    const m = fresh();
    for (let i = 0; i < 100; i++) {
      applyLook(m, { dx: 0, dy: i % 2 === 0 ? 1e6 : -1e6 }, 5);
      expect(Math.abs(m.pitch)).toBeLessThanOrEqual(PITCH_89);
    }
    for (let i = 0; i < 50; i++) applyLook(m, { dx: 0, dy: -1e6 }, 5);
    expect(m.pitch).toBeCloseTo(PITCH_89, 12);
  });

  it('wraps yaw into (−π, π]', () => {
    const m = fresh();
    for (let i = 0; i < 200; i++) {
      applyLook(m, { dx: 3999, dy: 0 }, 5);
      expect(m.yaw).toBeGreaterThan(-Math.PI);
      expect(m.yaw).toBeLessThanOrEqual(Math.PI);
    }
  });

  it('clamps each axis to ±4000 px per frame', () => {
    const a = fresh();
    const b = fresh();
    applyLook(a, { dx: 4000, dy: 0 }, 0.1);
    applyLook(b, { dx: 1e9, dy: 0 }, 0.1);
    expect(b.yaw).toBe(a.yaw);
  });

  it.each([Number.NaN, Infinity, -Infinity])('treats a %d delta as 0 on that axis', (bad) => {
    const m = fresh();
    applyLook(m, { dx: bad, dy: 20 }, 1);
    expect(m.yaw).toBe(0);
    expect(m.pitch).toBeCloseTo(-20 * 0.0022, 12);
  });

  it.each([
    [Number.NaN, 1],
    [Infinity, 1],
    [0, 0.1],
    [-3, 0.1],
    [99, 5],
    [2.5, 2.5],
  ])('sensitivity %d is used as %d', (s, expected) => {
    expect(effectiveSensitivity(s)).toBe(expected);
  });

  it('pins the tuning anchors', () => {
    expect(LOOK_TUNING.radPerPixel).toBe(0.0022);
    expect(LOOK_TUNING.pitchLimit).toBe(PITCH_89);
    expect(Object.isFrozen(LOOK_TUNING)).toBe(true);
  });
});

describe('applyRecoil (BR-P-15)', () => {
  it('kicks pitch up and yaw left', () => {
    const m = fresh();
    applyRecoil(m, { pitchRad: 0.01, yawRad: 0.005 });
    expect(m.pitch).toBeCloseTo(0.01, 12);
    expect(m.yaw).toBeCloseTo(0.005, 12);
  });

  it('AC3: recoil cannot push pitch past +89°', () => {
    const m = fresh();
    applyLook(m, { dx: 0, dy: -1e6 }, 5);
    for (let i = 0; i < 100; i++) applyRecoil(m, { pitchRad: 0.2, yawRad: 0 });
    expect(m.pitch).toBeLessThanOrEqual(PITCH_89);
  });

  it('caps one kick at 10° per axis', () => {
    const m = fresh();
    applyRecoil(m, { pitchRad: 5, yawRad: -5 });
    expect(m.pitch).toBeCloseTo(degToRad(10), 12);
    expect(m.yaw).toBeCloseTo(-degToRad(10), 12);
  });

  it('ignores non-finite axes', () => {
    const m = fresh();
    applyRecoil(m, { pitchRad: Number.NaN, yawRad: Infinity });
    expect(m.pitch).toBe(0);
    expect(m.yaw).toBe(0);
  });
});
