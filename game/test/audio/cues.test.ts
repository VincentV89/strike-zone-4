// Cue table invariants (domain-entities-game-audio "Cue table", BR-A-31, SD-A-3, SD-A-6).
import { describe, expect, it } from 'vitest';
import {
  CATEGORY_CAPS,
  COMPRESSOR_SETTINGS,
  CUE_DEFINITIONS,
  CUE_TABLE,
  FIRE_CUE_BY_WEAPON,
  MAX_VOICES,
  PANNER_SETTINGS,
  SOUND_CUES,
  SPRINT_GAIN_SCALE,
  cueDefinition,
} from '@sz/audio/core/cues';
import { MAX_VOICE_GAIN, dbToGain } from '@sz/audio/core/mixer';
import { WEAPON_IDS } from '@sz/kernel';

describe('cue table', () => {
  it('has 14 cues, 23 variants and 9.14 s of audio', () => {
    expect(SOUND_CUES).toHaveLength(14);
    expect(CUE_DEFINITIONS.reduce((n, d) => n + d.variants, 0)).toBe(23);
    const seconds = CUE_DEFINITIONS.reduce((s, d) => s + d.durationSec * d.variants, 0);
    expect(seconds).toBeCloseTo(9.14, 6);
  });

  it('every row is sane', () => {
    for (const d of CUE_DEFINITIONS) {
      expect(d.gainDb).toBeLessThanOrEqual(0);
      expect(d.priority).toBeGreaterThanOrEqual(1);
      expect(d.priority).toBeLessThanOrEqual(5);
      expect(d.variants).toBeGreaterThanOrEqual(1);
      expect(d.durationSec).toBeGreaterThan(0);
      expect(d.bus).toBe(d.category === 'ui' ? 'ui' : 'sfx');
      expect(d.spatialAllowed ? Number.isFinite(d.maxRangeM) : d.maxRangeM).toBe(
        d.spatialAllowed ? true : Number.POSITIVE_INFINITY,
      );
      expect(Object.isFrozen(d)).toBe(true);
    }
  });

  it('only gunfire and footsteps are spatial, at 90 m and 25 m', () => {
    const spatial = CUE_DEFINITIONS.filter((d) => d.spatialAllowed).map((d) => [d.id, d.maxRangeM]);
    expect(spatial).toEqual([
      ['fire-rifle', 90],
      ['fire-pistol', 90],
      ['fire-sniper', 90],
      ['footstep', 25],
    ]);
  });

  it('BR-A-31: caps total 27 across categories with a 24-voice pool', () => {
    expect(MAX_VOICES).toBe(24);
    expect(Object.fromEntries(CATEGORY_CAPS)).toEqual({
      gunfire: 10,
      weapon: 3,
      feedback: 4,
      footstep: 6,
      sting: 1,
      ui: 3,
    });
  });

  it('SD-A-6: the loudest voice gain stays within the per-voice clamp', () => {
    for (const d of CUE_DEFINITIONS) {
      expect(dbToGain(d.gainDb) * SPRINT_GAIN_SCALE).toBeLessThanOrEqual(MAX_VOICE_GAIN);
    }
  });

  it('SD-A-1: fixed node attributes are finite and in range', () => {
    expect(PANNER_SETTINGS).toEqual({
      panningModel: 'equalpower',
      distanceModel: 'inverse',
      refDistance: 2,
      rolloffFactor: 1,
      maxDistance: 90,
    });
    for (const v of Object.values(COMPRESSOR_SETTINGS)) expect(Number.isFinite(v)).toBe(true);
    expect(COMPRESSOR_SETTINGS.thresholdDb).toBe(-6);
  });

  it('every weapon has a fire cue', () => {
    for (const w of WEAPON_IDS)
      expect(CUE_TABLE.has(FIRE_CUE_BY_WEAPON.get(w) ?? 'ui-click')).toBe(true);
    expect([...FIRE_CUE_BY_WEAPON.keys()]).toEqual(WEAPON_IDS);
  });

  it.each(['__proto__', 'constructor', 'toString', '', 42, null, undefined, {}])(
    'SD-A-3: cueDefinition(%s) finds nothing',
    (id) => {
      expect(cueDefinition(id)).toBeUndefined();
    },
  );
});
