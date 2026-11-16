import { describe, expect, it } from 'vitest';
import { DEFAULT_MATCH_SETUP } from '@sz/kernel';
import {
  DEFAULT_SETTINGS,
  DURATIONS,
  KEYS,
  MAX_RAW_LENGTH,
  decodeEnvelope,
  encodeEnvelope,
  sanitizeSettings,
  validateHistory,
  validateHistoryEntry,
  validateLastSetup,
  validateRecord,
  validateSettings,
  withSetting,
} from '@sz/persistence';
import { ROUND_DURATIONS } from '@sz/round';

describe('envelope (SD-UI-7)', () => {
  it('round-trips data', () => {
    expect(decodeEnvelope(encodeEnvelope({ a: 1 }))).toEqual({ a: 1 });
  });

  it.each([
    ['null', null],
    ['a number', 5],
    ['bad JSON', '{'],
    ['an array root', '[1]'],
    ['a string root', '"x"'],
    ['a missing version', '{"data":1}'],
    ['version 2', '{"schemaVersion":2,"data":1}'],
    ['version "1"', '{"schemaVersion":"1","data":1}'],
    ['an inherited-looking version', '{"__proto__":{"schemaVersion":1},"data":1}'],
  ])('returns undefined for %s', (_label, raw) => {
    expect(decodeEnvelope(raw)).toBeUndefined();
  });

  it('rejects oversize input before parsing', () => {
    const big = encodeEnvelope('x'.repeat(MAX_RAW_LENGTH));
    expect(big.length).toBeGreaterThan(MAX_RAW_LENGTH);
    expect(decodeEnvelope(big)).toBeUndefined();
  });

  it('survives absurd nesting: validators see a deep array and fall back without recursion', () => {
    const deep = '['.repeat(30_000) + ']'.repeat(30_000);
    const data = decodeEnvelope(`{"schemaVersion":1,"data":${deep}}`);
    expect(Array.isArray(data)).toBe(true);
    expect(sanitizeSettings(data)).toBe(DEFAULT_SETTINGS);
    expect(validateHistory(data)).toHaveLength(0);
    expect(validateRecord(data)).toEqual({ roundsWon: 0, roundsLost: 0 });
  });
});

describe('settings validation (BR-UI-03, BR-UI-07)', () => {
  it('defaults to graphics Medium and a 3:00 round', () => {
    expect(DEFAULT_SETTINGS.graphics).toBe('medium');
    expect(DEFAULT_SETTINGS.roundDurationSec).toBe(180);
    expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true);
  });

  it('DURATIONS equals ROUND_DURATIONS', () => {
    expect([...DURATIONS]).toEqual([...ROUND_DURATIONS]);
  });

  it('repairs each field independently', () => {
    const s = sanitizeSettings({
      sensitivity: 2.34,
      fovDeg: 500,
      masterVolume: '50',
      effectsVolume: 33.6,
      graphics: 'ultra',
      roundDurationSec: 300,
    });
    expect(s).toEqual({
      sensitivity: 2.3,
      fovDeg: 90,
      masterVolume: 80,
      effectsVolume: 34,
      graphics: 'medium',
      roundDurationSec: 300,
    });
    expect(Object.isFrozen(s)).toBe(true);
  });

  it('a __proto__ key reaches nothing', () => {
    const parsed: unknown = JSON.parse('{"__proto__":{"fovDeg":100},"fovDeg":70}');
    const s = sanitizeSettings(parsed);
    expect(s.fovDeg).toBe(70);
    expect(({} as Record<string, unknown>)['fovDeg']).toBeUndefined();
  });

  it.each([null, [], 'x', 1, Object.create({ fovDeg: 70 }) as unknown])(
    'a non-plain root gives the defaults (%s)',
    (x) => {
      expect(sanitizeSettings(x)).toBe(DEFAULT_SETTINGS);
    },
  );

  it('validateSettings is strict', () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS })).toEqual(DEFAULT_SETTINGS);
    expect(validateSettings({ ...DEFAULT_SETTINGS, sensitivity: 1.05 })).toBeNull();
    expect(validateSettings({ ...DEFAULT_SETTINGS, graphics: 'ultra' })).toBeNull();
    expect(validateSettings({ fovDeg: 90 })).toBeNull();
    expect(validateSettings(null)).toBeNull();
  });

  it('withSetting returns the same object for invalid or unchanged values', () => {
    const s = DEFAULT_SETTINGS;
    expect(withSetting(s, 'fovDeg', 90)).toBe(s);
    expect(withSetting(s, 'fovDeg', 111)).toBe(s);
    expect(withSetting(s, 'graphics', 'ultra')).toBe(s);
    expect(withSetting(s, 'roundDurationSec', 200)).toBe(s);
    expect(withSetting(s, 'sensitivity', Number.NaN)).toBe(s);
    const next = withSetting(s, 'graphics', 'high');
    expect(next).not.toBe(s);
    expect(next.graphics).toBe('high');
    expect(withSetting(next, 'roundDurationSec', 600).roundDurationSec).toBe(600);
    expect(withSetting(s, 'sensitivity', 0.26).sensitivity).toBe(0.3);
  });
});

const ENTRY = {
  seq: 3,
  at: 1_700_000_000_000,
  outcome: 'victory',
  setup: { mapId: 'desert-compound', botCount: 5, difficulty: 'hard' },
  kills: 5,
  deaths: 0,
  headshots: 2,
  accuracyPct: 41,
  damageDealt: 500,
  durationSec: 95.5,
};

describe('history and record (SD-UI-10)', () => {
  it('accepts a valid entry and freezes it', () => {
    const e = validateHistoryEntry(ENTRY);
    expect(e).toEqual(ENTRY);
    expect(Object.isFrozen(e)).toBe(true);
    expect(Object.isFrozen(e?.setup)).toBe(true);
  });

  it.each([
    ['unknown map', { setup: { ...ENTRY.setup, mapId: 'dust2' } }],
    ['bad bot count', { setup: { ...ENTRY.setup, botCount: 7 } }],
    ['bad outcome', { outcome: 'win' }],
    ['negative kills', { kills: -1 }],
    ['fractional deaths', { deaths: 0.5 }],
    ['accuracy over 100', { accuracyPct: 101 }],
    ['infinite at', { at: Number.POSITIVE_INFINITY }],
    ['string seq', { seq: '3' }],
    ['duration over 600', { durationSec: 601 }],
    ['negative duration', { durationSec: -1 }],
  ])('drops an entry with %s', (_label, patch) => {
    expect(validateHistoryEntry({ ...ENTRY, ...patch })).toBeUndefined();
  });

  it('drops invalid entries, sorts newest first and keeps 20', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ ...ENTRY, seq: i + 1 }));
    const h = validateHistory([{ bad: true }, ...many]);
    expect(h).toHaveLength(20);
    expect(h[0]?.seq).toBe(25);
    expect(h[19]?.seq).toBe(6);
    expect(validateHistory('x')).toEqual([]);
  });

  it('record goes through createSessionTotals', () => {
    expect(validateRecord({ roundsWon: 3, roundsLost: 2 })).toEqual({
      roundsWon: 3,
      roundsLost: 2,
    });
    expect(validateRecord({ roundsWon: -3, roundsLost: 1.5 })).toEqual({
      roundsWon: 0,
      roundsLost: 0,
    });
    expect(validateRecord([])).toEqual({ roundsWon: 0, roundsLost: 0 });
  });

  it('last setup falls back to Desert, 5, Normal', () => {
    expect(validateLastSetup({ mapId: 'nope' })).toEqual(DEFAULT_MATCH_SETUP);
    expect(
      validateLastSetup({ mapId: 'industrial-warehouse', botCount: 20, difficulty: 'easy' }),
    ).toEqual({ mapId: 'industrial-warehouse', botCount: 20, difficulty: 'easy' });
  });

  it('every key is in the strikezone: namespace', () => {
    for (const k of Object.values(KEYS)) expect(k.startsWith('strikezone:')).toBe(true);
  });
});
