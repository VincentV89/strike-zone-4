import { describe, expect, it } from 'vitest';
import {
  UP,
  ZERO,
  add,
  angleBetween,
  clamp,
  cross,
  degToRad,
  dirFromYawPitch,
  distance,
  distanceSq,
  dot,
  horizontal,
  isFiniteVec,
  length,
  lengthSq,
  lerp,
  normalize,
  radToDeg,
  scale,
  sub,
  vec3,
  wrapAngle,
  yawOf,
  type Vec3,
} from '@sz/kernel';

const EPS = 1e-12;

function expectVec(actual: Vec3, expected: Vec3, eps = EPS): void {
  expect(Math.abs(actual.x - expected.x)).toBeLessThan(eps);
  expect(Math.abs(actual.y - expected.y)).toBeLessThan(eps);
  expect(Math.abs(actual.z - expected.z)).toBeLessThan(eps);
}

describe('vec3 helpers', () => {
  const a = vec3(1, 2, 3);
  const b = vec3(-4, 5, 0.5);

  it('arithmetic returns new objects and leaves inputs unchanged', () => {
    expect(add(a, b)).toEqual(vec3(-3, 7, 3.5));
    expect(sub(a, b)).toEqual(vec3(5, -3, 2.5));
    expect(scale(a, 2)).toEqual(vec3(2, 4, 6));
    expect(add(a, ZERO)).not.toBe(a);
    expect(a).toEqual(vec3(1, 2, 3));
  });

  it('dot, cross, length and distance identities', () => {
    expect(dot(a, b)).toBe(-4 + 10 + 1.5);
    expect(cross(vec3(1, 0, 0), vec3(0, 1, 0))).toEqual(vec3(0, 0, 1));
    expect(dot(cross(a, b), a)).toBeCloseTo(0, 12);
    expect(lengthSq(vec3(3, 4, 0))).toBe(25);
    expect(length(vec3(3, 4, 0))).toBe(5);
    expect(distance(vec3(1, 1, 1), vec3(1, 4, 5))).toBe(5);
    expect(distanceSq(vec3(1, 1, 1), vec3(1, 4, 5))).toBe(25);
  });

  it('normalize returns a unit vector, or ZERO for zero and non-finite input', () => {
    expect(length(normalize(b))).toBeCloseTo(1, 12);
    expect(normalize(ZERO)).toBe(ZERO);
    expect(normalize(vec3(1e-10, 0, 0))).toBe(ZERO);
    expect(normalize(vec3(Number.NaN, 1, 0))).toBe(ZERO);
    expect(normalize(vec3(Infinity, 0, 0))).toBe(ZERO);
  });

  it('lerp does not clamp t', () => {
    expect(lerp(ZERO, vec3(2, 4, 6), 0.5)).toEqual(vec3(1, 2, 3));
    expect(lerp(ZERO, vec3(2, 0, 0), 1.5)).toEqual(vec3(3, 0, 0));
  });

  it('horizontal drops y; isFiniteVec checks every component', () => {
    expect(horizontal(a)).toEqual(vec3(1, 0, 3));
    expect(isFiniteVec(a)).toBe(true);
    expect(isFiniteVec(vec3(0, Number.NaN, 0))).toBe(false);
    expect(isFiniteVec(vec3(0, 0, -Infinity))).toBe(false);
    expect(UP).toEqual(vec3(0, 1, 0));
  });
});

describe('angles and the coordinate convention (BR-K-15)', () => {
  it('yaw 0 faces -Z, +π/2 yaw turns left to -X, +π/2 pitch looks up', () => {
    expectVec(dirFromYawPitch(0, 0), vec3(0, 0, -1));
    expectVec(dirFromYawPitch(Math.PI / 2, 0), vec3(-1, 0, 0));
    expectVec(dirFromYawPitch(0, Math.PI / 2), vec3(0, 1, 0), 1e-12);
  });

  it('yawOf inverts the horizontal part of dirFromYawPitch', () => {
    for (const y of [0, 0.3, -1.2, 2.9, Math.PI, -3, 7, -10]) {
      expect(yawOf(dirFromYawPitch(y, 0))).toBeCloseTo(wrapAngle(y), 12);
    }
  });

  it('wrapAngle maps into (-π, π] and returns 0 for non-finite input', () => {
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI, 15);
    expect(wrapAngle(-Math.PI)).toBeCloseTo(Math.PI, 15);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(Math.PI + 0.1)).toBeCloseTo(-Math.PI + 0.1, 12);
    expect(wrapAngle(0.5)).toBe(0.5);
    for (const t of [-100, -7, -3.2, 0, 3.2, 7, 100]) {
      const w = wrapAngle(t);
      expect(w).toBeGreaterThan(-Math.PI);
      expect(w).toBeLessThanOrEqual(Math.PI);
    }
    expect(wrapAngle(Number.NaN)).toBe(0);
    expect(wrapAngle(Infinity)).toBe(0);
  });

  it('degToRad and radToDeg round-trip (BR-K-14)', () => {
    expect(degToRad(180)).toBe(Math.PI);
    expect(radToDeg(Math.PI / 2)).toBe(90);
    expect(radToDeg(degToRad(37.5))).toBeCloseTo(37.5, 12);
  });

  it('clamp bounds values and maps NaN to lo', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.4, 0, 1)).toBe(0.4);
    expect(clamp(Number.NaN, -1, 1)).toBe(-1);
  });

  it('angleBetween is in [0, π] and 0 for a zero vector', () => {
    expect(angleBetween(vec3(1, 0, 0), vec3(0, 0, 1))).toBeCloseTo(Math.PI / 2, 12);
    expect(angleBetween(vec3(1, 0, 0), vec3(-3, 0, 0))).toBeCloseTo(Math.PI, 12);
    expect(angleBetween(vec3(2, 2, 0), vec3(1, 1, 0))).toBeCloseTo(0, 6);
    expect(angleBetween(ZERO, vec3(1, 0, 0))).toBe(0);
    expect(angleBetween(vec3(1, 0, 0), ZERO)).toBe(0);
  });
});
