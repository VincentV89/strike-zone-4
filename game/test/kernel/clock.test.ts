import { describe, expect, it } from 'vitest';
import { MAX_SUBSTEPS, STEP_SEC, createFixedClock } from '@sz/kernel';

const newClock = () => createFixedClock({ stepHz: 60, maxSubsteps: 5 });

function run(dts: ReadonlyArray<number>) {
  const clock = newClock();
  return dts.map((dt) => clock.advance(dt));
}

describe('FixedClock (BR-K-16 to BR-K-19b)', () => {
  it('exposes a 1/60 s step', () => {
    expect(newClock().stepSec).toBe(STEP_SEC);
    expect(MAX_SUBSTEPS).toBe(5);
  });

  it('S1: exactly 1/60 per frame yields exactly 1 step every frame for 600 frames (BR-K-19)', () => {
    const frames = run(Array.from({ length: 600 }, () => 1 / 60));
    expect(frames.every((f) => f.steps === 1)).toBe(true);
    expect(frames.reduce((n, f) => n + f.steps, 0)).toBe(600);
  });

  it('S2: 144 Hz yields 0 or 1 steps per frame, 60 ± 1 per second, alpha in [0, 1)', () => {
    const frames = run(Array.from({ length: 144 }, () => 1 / 144));
    expect(frames.every((f) => f.steps === 0 || f.steps === 1)).toBe(true);
    const total = frames.reduce((n, f) => n + f.steps, 0);
    expect(Math.abs(total - 60)).toBeLessThanOrEqual(1);
    expect(frames.every((f) => f.alpha >= 0 && f.alpha < 1)).toBe(true);
    expect(frames.some((f) => f.alpha > 0.5)).toBe(true);
  });

  it('30 Hz yields 2 steps every frame', () => {
    const frames = run(Array.from({ length: 30 }, () => 1 / 30));
    expect(frames.every((f) => f.steps === 2)).toBe(true);
  });

  it('S3: a 2 s tab return clamps to 0.25 s, caps at 5 steps and drops ~1.9167 s (BR-K-18)', () => {
    const [f] = run([2.0]);
    expect(f?.steps).toBe(5);
    expect(f?.droppedSec).toBeCloseTo(2 - 5 / 60, 9);
  });

  it('BR-K-17: NaN, negative, zero and Infinity produce no steps and keep the accumulator', () => {
    const clock = newClock();
    clock.advance(0.5 / 60);
    const before = clock.advance(0).alpha;
    for (const bad of [Number.NaN, -0.01, 0, Infinity, -Infinity]) {
      const f = clock.advance(bad);
      expect(f).toEqual({ steps: 0, alpha: before, droppedSec: 0 });
    }
    expect(before).toBeCloseTo(0.5, 9);
  });

  it('0.1 then 0.1: each frame caps at 5 and drops 1 step; the remainder fraction is kept', () => {
    const clock = newClock();
    const a = clock.advance(0.1);
    expect(a.steps).toBe(5);
    expect(a.droppedSec).toBeCloseTo(STEP_SEC, 9);
    const b = clock.advance(0.1);
    expect(b.steps).toBe(5);
    expect(b.droppedSec).toBeCloseTo(STEP_SEC, 9);
  });

  it('S4 / BR-K-19a: not calling advance while paused means zero steps; resume keeps the fraction', () => {
    const clock = newClock();
    clock.advance(1.5 / 60); // 1 step, half a step left over
    // Paused: app-shell calls nothing. On resume the next frame continues from the fraction.
    const resumed = clock.advance(0.5 / 60);
    expect(resumed.steps).toBe(1);
    expect(resumed.alpha).toBeCloseTo(0, 6);
  });

  it('S5 / BR-K-19b: reset() clears the leftover fraction', () => {
    const clock = newClock();
    clock.advance(1.5 / 60);
    clock.reset();
    expect(clock.advance(0.5 / 60)).toMatchObject({ steps: 0 });
    expect(clock.advance(0).alpha).toBeCloseTo(0.5, 9);
  });

  it('SCAL-K-04: never more than 5 steps in any frame', () => {
    const frames = run([0.2, 0.25, 1, 10, 1e9, 0.0001]);
    expect(Math.max(...frames.map((f) => f.steps))).toBeLessThanOrEqual(5);
  });
});
