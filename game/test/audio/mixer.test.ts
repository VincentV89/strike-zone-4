// Volume curve, bus gains, voice gain and the ceiling curve (W10, BR-A-40 to BR-A-47, SD-A-6).
import { describe, expect, it } from 'vitest';
import {
  busGains,
  ceilingAt,
  ceilingCurve,
  dbToGain,
  sanitizeVolume,
  sliderGain,
  voiceGain,
} from '@sz/audio/core/mixer';

describe('volume', () => {
  it('BR-A-41: g(v) = v², exact at the ends', () => {
    expect(sliderGain(0)).toBe(0);
    expect(sliderGain(1)).toBe(1);
    expect(sliderGain(0.5)).toBe(0.25);
  });

  it.each([
    [1, 1, false, 1, 1],
    [0, 1, false, 0, 0],
    [1, 0, false, 0, 1],
    [0.5, 0.8, false, 0.16, 0.25],
    [1, 1, true, 0.3, 1],
  ])('BR-A-42: master %s effects %s ducked %s → sfx %s ui %s', (m, e, d, sfx, ui) => {
    const g = busGains({ master: m, effects: e }, d);
    expect(g.sfx).toBeCloseTo(sfx, 12);
    expect(g.ui).toBeCloseTo(ui, 12);
  });

  it('master 0 makes every bus exactly 0 (req-settings AC2)', () => {
    expect(busGains({ master: 0, effects: 1 }, true)).toEqual({ sfx: 0, ui: 0 });
  });

  it.each([
    [0.4, 0.4],
    [-1, 0],
    [2, 1],
    [1e308, 1],
    [-0, 0],
    [Number.NaN, 0.7],
    [Number.POSITIVE_INFINITY, 0.7],
    [Number.NEGATIVE_INFINITY, 0.7],
    ['1', 0.7],
    [null, 0.7],
    [undefined, 0.7],
    [{}, 0.7],
    [1n, 0.7],
  ])('SD-A-2: sanitizeVolume(%s) with prev 0.7 → %s', (v, expected) => {
    const out = sanitizeVolume(v, 0.7);
    expect(out).toBe(expected);
    expect(Object.is(out, -0)).toBe(false);
  });
});

describe('voiceGain (BR-A-47)', () => {
  it('converts dB and applies the scale', () => {
    expect(voiceGain(0, 1)).toBe(1);
    expect(voiceGain(-6, 1)).toBeCloseTo(dbToGain(-6), 12);
    expect(dbToGain(-20)).toBeCloseTo(0.1, 12);
  });
  it('clamps to [0, 2]', () => {
    expect(voiceGain(0, 5)).toBe(2);
    expect(voiceGain(0, -1)).toBe(0);
  });
  it.each([Number.NaN, Number.POSITIVE_INFINITY, '1', null, {}])('rejects scale %s', (s) => {
    expect(voiceGain(0, s)).toBeNull();
  });
});

describe('ceiling curve (SD-A-6)', () => {
  const curve = ceilingCurve(1025);
  it('is identity for |x| <= 0.7', () => {
    for (const x of [-0.7, -0.3, 0, 0.25, 0.7]) expect(ceilingAt(x)).toBe(x);
  });
  it('is odd, monotonic and stays below 0.98', () => {
    expect(curve).toHaveLength(1025);
    expect(Math.max(...curve)).toBeLessThan(0.98);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1] ?? -1);
      expect(curve[i]).toBeCloseTo(-(curve[curve.length - 1 - i] ?? 0), 6);
    }
    expect(curve[512]).toBe(0);
    expect(ceilingAt(100)).toBeLessThanOrEqual(0.98);
  });
  it('has at least 3 points', () => {
    expect(ceilingCurve(1)).toHaveLength(3);
  });
});
