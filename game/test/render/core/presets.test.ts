// BR-R-07, story-graphics-presets: preset table invariants.
import { MAX_CAPS, PRESETS, PRESET_IDS, presetOrMedium, presetRow } from '@sz/render/core/presets';
import { describe, expect, it } from 'vitest';

const NUMERIC = [
  'renderScale',
  'pixelRatioCap',
  'shadowMapSize',
  'shadowRadius',
  'botShadowNearM',
  'drawDistanceM',
  'animLodM',
  'anisotropy',
] as const;

describe('graphics presets (BR-R-07)', () => {
  const low = PRESETS.get('low');
  const medium = PRESETS.get('medium');
  const high = PRESETS.get('high');

  it('has Low, Medium and High', () => {
    expect(PRESET_IDS).toEqual(['low', 'medium', 'high']);
    expect([low, medium, high].every((r) => r !== undefined)).toBe(true);
  });

  it('Low has sun shadows off and render scale below 1', () => {
    expect(low?.sunShadows).toBe(false);
    expect(low?.renderScale).toBeLessThan(1);
    expect(low?.botShadowNearM).toBe(0);
  });

  it('High exceeds Medium on draw distance and shadow map size', () => {
    expect(high?.drawDistanceM).toBeGreaterThan(medium?.drawDistanceM ?? Infinity);
    expect(high?.shadowMapSize).toBeGreaterThan(medium?.shadowMapSize ?? Infinity);
  });

  it.each(NUMERIC)('%s is non-decreasing Low → High (Infinity counts as largest)', (field) => {
    const values = PRESET_IDS.map((id) => PRESETS.get(id)?.[field] ?? Number.NaN);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1] ?? Infinity);
    }
  });

  it.each(['decal', 'puff', 'spark', 'muzzle'] as const)(
    'cap %s is non-decreasing and ≤ the pool size',
    (k) => {
      const caps = PRESET_IDS.map((id) => PRESETS.get(id)?.caps[k] ?? Number.NaN);
      expect(caps[0]).toBeLessThanOrEqual(caps[1] ?? 0);
      expect(caps[1]).toBeLessThanOrEqual(caps[2] ?? 0);
      expect(caps[2]).toBe(MAX_CAPS[k]);
    },
  );

  it('High muzzle cap covers 21 holders firing in one frame (PD-R-12)', () => {
    expect(high?.caps.muzzle).toBe(21);
  });

  it('rows are frozen and lookups reject hostile ids', () => {
    expect(Object.isFrozen(medium)).toBe(true);
    expect(Object.isFrozen(medium?.caps)).toBe(true);
    for (const id of ['__proto__', 'constructor', 'toString', '', 'ultra', 1, null]) {
      expect(presetRow(id)).toBeUndefined();
    }
    expect(presetOrMedium('nope').id).toBe('medium');
    expect(presetOrMedium('high').id).toBe('high');
  });
});
