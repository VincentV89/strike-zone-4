// Listener geometry (W9, BR-A-16, BR-A-17, BR-A-53) and variants (BR-A-36, BR-A-37).
import { describe, expect, it } from 'vitest';
import { createRng, dirFromYawPitch, vec3 } from '@sz/kernel';
import {
  DEFAULT_POSE,
  acceptPose,
  basis,
  inRange,
  isFinitePosition,
  listenerSpace,
  panOf,
} from '@sz/audio/core/listener';
import { createPlaybackRandom, createVariantPicker, pitchRate } from '@sz/audio/core/variants';

describe('pan direction (req-spatial-audio, BR-A-53)', () => {
  const at = vec3(10, 1.6, -4);
  it.each([
    [0, vec3(-5, 0, 0), -1],
    [0, vec3(0, 0, -5), 0],
    [Math.PI / 2, vec3(0, 0, 5), -1],
    [Math.PI, vec3(5, 0, 0), -1],
    [-Math.PI / 2, vec3(0, 0, 5), 1],
  ])('yaw %s, source offset %o → pan %s', (yaw, offset, pan) => {
    const pose = { pos: at, yaw };
    const p = vec3(at.x + offset.x, at.y + offset.y, at.z + offset.z);
    expect(panOf(pose, p)).toBeCloseTo(pan, 9);
  });

  it('a source on the listener has pan 0', () => {
    expect(panOf(DEFAULT_POSE, vec3(0, 3, 0))).toBe(0);
  });

  it('BR-A-16: forward matches dirFromYawPitch and the basis is orthonormal', () => {
    for (const yaw of [0, 0.4, -2, Math.PI]) {
      const b = basis(yaw);
      const f = dirFromYawPitch(yaw, 0);
      expect(b.forward).toEqual(f);
      expect(b.right.x * f.x + b.right.z * f.z).toBeCloseTo(0, 12);
      expect(Math.hypot(b.right.x, b.right.z)).toBeCloseTo(1, 12);
      expect(b.up).toEqual(vec3(0, 1, 0));
    }
  });

  it('listenerSpace puts ahead on +z and keeps height', () => {
    const l = listenerSpace(DEFAULT_POSE, vec3(0, 2, -7));
    expect(l.x).toBeCloseTo(0, 12);
    expect(l.y).toBe(2);
    expect(l.z).toBeCloseTo(7, 12);
  });

  it('BR-A-14: range check', () => {
    expect(inRange(DEFAULT_POSE, vec3(0, 0, 25), 25)).toBe(true);
    expect(inRange(DEFAULT_POSE, vec3(0, 0, 25.01), 25)).toBe(false);
  });
});

describe('acceptPose (BR-A-17, SD-A-2)', () => {
  const prev = { pos: vec3(1, 1, 1), yaw: 0.5 };
  it('accepts a finite pose', () => {
    expect(acceptPose(prev, vec3(2, 3, 4), -1)).toEqual({ pos: vec3(2, 3, 4), yaw: -1 });
  });
  it.each([
    [vec3(Number.NaN, 0, 0), 0],
    [vec3(0, Number.POSITIVE_INFINITY, 0), 0],
    [vec3(0, 0, 0), Number.NaN],
    [null, 0],
    [{ x: '1', y: 0, z: 0 }, 0],
    [{ x: 1, y: 2 }, 0],
    [vec3(0, 0, 0), '1'],
    [vec3(0, 0, 0), 1n],
  ])('keeps the previous pose for %o / %s', (pos, yaw) => {
    expect(acceptPose(prev, pos, yaw)).toBe(prev);
  });
  it('isFinitePosition never coerces', () => {
    expect(isFinitePosition({ x: 1, y: 2, z: 3 })).toBe(true);
    expect(isFinitePosition('1,2,3')).toBe(false);
  });
});

describe('variants', () => {
  it('BR-A-36: round robin from a random start never repeats', () => {
    const picker = createVariantPicker(createRng(7));
    const seq = Array.from({ length: 12 }, () => picker.next('footstep', 4));
    for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1]);
    expect(new Set(seq)).toEqual(new Set([0, 1, 2, 3]));
    expect(seq[4]).toBe(seq[0]);
  });
  it('single-variant and invalid counts return 0', () => {
    const picker = createVariantPicker(createRng(7));
    expect(picker.next('ui-click', 1)).toBe(0);
    expect(picker.next('ui-click', 0)).toBe(0);
    expect(picker.next('ui-click', Number.NaN)).toBe(0);
  });
  it('cues are tracked independently', () => {
    const picker = createVariantPicker(createRng(1));
    const a = picker.next('fire-rifle', 3);
    picker.next('fire-pistol', 3);
    expect(picker.next('fire-rifle', 3)).toBe((a + 1) % 3);
  });
  it('BR-A-37: pitch jitter is deterministic and in range', () => {
    const a = createRng(0x5a17);
    const b = createRng(0x5a17);
    for (let i = 0; i < 100; i++) {
      const r = pitchRate(a, 0.06);
      expect(r).toBe(pitchRate(b, 0.06));
      expect(r).toBeGreaterThanOrEqual(0.94);
      expect(r).toBeLessThanOrEqual(1.06);
    }
    expect(pitchRate(a, 0)).toBe(1);
  });
  it('createPlaybackRandom shares one Rng', () => {
    const r = createPlaybackRandom(createRng(3));
    expect(r.rate(0)).toBe(1);
    expect(r.variant('footstep', 4)).toBeGreaterThanOrEqual(0);
  });
});
