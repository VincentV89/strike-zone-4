import { describe, expect, it } from 'vitest';
import {
  BOT_COUNTS,
  BOT_STATES,
  DEFAULT_MATCH_SETUP,
  DIFFICULTIES,
  Layer,
  MAP_IDS,
  MASK_SHOT_ALL,
  MASK_WORLD,
  MAX_BOTS,
  PLAYER_ID,
  ROUND_PHASES,
  WEAPON_IDS,
  botIds,
  err,
  includes,
  isBotCount,
  isBotId,
  isDifficulty,
  isMapId,
  isWeaponId,
  mask,
  ok,
  parseActorId,
  parseMatchSetup,
  type ActorId,
} from '@sz/kernel';

// Hostile rows shared by every validator (SEC-K-01, ADR-K-3 table tests).
const HOSTILE: ReadonlyArray<unknown> = [
  undefined,
  null,
  true,
  0,
  -1,
  Number.NaN,
  Infinity,
  '',
  ' ',
  '5',
  [],
  ['desert-compound'],
  {},
  () => 'player',
  Symbol('x'),
  10n,
  Object('player') as unknown, // boxed String
  Object(5) as unknown, // boxed Number
];

describe('enumerations and guards (BR-K-12)', () => {
  it('tuples hold exactly the spec values in display order', () => {
    expect(BOT_COUNTS).toEqual([1, 2, 3, 5, 8, 10, 15, 20]);
    expect(DIFFICULTIES).toEqual(['easy', 'normal', 'hard']);
    expect(MAP_IDS).toEqual(['desert-compound', 'industrial-warehouse']);
    expect(WEAPON_IDS).toEqual(['rifle', 'pistol', 'sniper']);
    expect(BOT_STATES).toHaveLength(7);
    expect(ROUND_PHASES).toEqual(['loading', 'ready', 'countdown', 'live', 'ended']);
    expect(MAX_BOTS).toBe(20);
  });

  it('isBotCount accepts only the eight counts as numbers', () => {
    for (const n of BOT_COUNTS) expect(isBotCount(n)).toBe(true);
    for (const bad of [4, 0, 21, 5.0000001, '5', -1, Number.NaN, Infinity, ...HOSTILE]) {
      expect(isBotCount(bad)).toBe(false);
    }
  });

  it('string guards accept members only, never boxed strings or near misses', () => {
    expect(isDifficulty('hard')).toBe(true);
    expect(isMapId('industrial-warehouse')).toBe(true);
    expect(isWeaponId('sniper')).toBe(true);
    for (const bad of ['Hard', 'normal ', 'desert', 'shotgun', ...HOSTILE]) {
      expect(isDifficulty(bad)).toBe(false);
      expect(isMapId(bad)).toBe(false);
      expect(isWeaponId(bad)).toBe(false);
    }
  });
});

describe('actor ids (BR-K-10, BR-K-11, SEC-K-03)', () => {
  it('botIds(count) is bot-1 … bot-count in order', () => {
    expect(botIds(1)).toEqual(['bot-1']);
    expect(botIds(20)).toHaveLength(20);
    expect(botIds(20)[19]).toBe('bot-20');
    expect(botIds(5)).toEqual(['bot-1', 'bot-2', 'bot-3', 'bot-4', 'bot-5']);
  });

  it.each(['player', 'bot-1', 'bot-9', 'bot-10', 'bot-19', 'bot-20'])('accepts %s', (s) => {
    expect(parseActorId(s)).toEqual({ ok: true, value: s });
  });

  it.each([
    'bot-0',
    'bot-01',
    'bot-21',
    'bot-99',
    'bot-',
    'bot-1a',
    'bot-a',
    'Bot-1',
    'BOT-1',
    'bot-100',
    'bot--1',
    'player1',
    'Player',
    'bot1',
    'xot-1',
    ' bot-1',
  ])('rejects %s', (s) => {
    expect(parseActorId(s)).toEqual({ ok: false, error: 'invalid-actor-id' });
  });

  it('rejects non-strings and a 100,000-character string without echoing it', () => {
    for (const bad of HOSTILE) expect(parseActorId(bad).ok).toBe(false);
    const huge = `bot-1${'0'.repeat(100_000)}`;
    const r = parseActorId(huge);
    expect(r).toEqual({ ok: false, error: 'invalid-actor-id' });
    expect(JSON.stringify(r).length).toBeLessThan(100);
  });

  it('isBotId distinguishes bots from the player', () => {
    expect(isBotId(PLAYER_ID)).toBe(false);
    expect(isBotId('bot-3' as ActorId)).toBe(true);
  });
});

describe('parseMatchSetup (BR-K-13, SEC-K-02)', () => {
  const valid = { mapId: 'industrial-warehouse', botCount: 20, difficulty: 'hard' };

  it('defaults are Desert Compound, 5 bots, Normal (req-match-setup AC2)', () => {
    expect(DEFAULT_MATCH_SETUP).toEqual({
      mapId: 'desert-compound',
      botCount: 5,
      difficulty: 'normal',
    });
    expect(parseMatchSetup(DEFAULT_MATCH_SETUP).ok).toBe(true);
  });

  it('accepts a valid setup and returns a fresh object with exactly three keys', () => {
    const input = { ...valid, extra: 'ignored' };
    const r = parseMatchSetup(input);
    expect(r).toEqual({ ok: true, value: valid });
    if (r.ok) {
      expect(r.value).not.toBe(input);
      expect(Object.keys(r.value)).toEqual(['mapId', 'botCount', 'difficulty']);
    }
  });

  it('reports the first invalid field and never echoes the value', () => {
    expect(parseMatchSetup({ ...valid, mapId: 'x'.repeat(10_000) })).toEqual({
      ok: false,
      error: { field: 'mapId' },
    });
    expect(parseMatchSetup({ ...valid, botCount: '5' })).toEqual({
      ok: false,
      error: { field: 'botCount' },
    });
    expect(parseMatchSetup({ ...valid, botCount: 4 })).toEqual({
      ok: false,
      error: { field: 'botCount' },
    });
    expect(parseMatchSetup({ ...valid, difficulty: 'insane' })).toEqual({
      ok: false,
      error: { field: 'difficulty' },
    });
    expect(parseMatchSetup({ mapId: 1, botCount: 'x', difficulty: null })).toEqual({
      ok: false,
      error: { field: 'mapId' },
    });
  });

  it('rejects non-object roots, including arrays and null', () => {
    for (const bad of HOSTILE.filter((x) => typeof x !== 'object' || x === null)) {
      expect(parseMatchSetup(bad)).toEqual({ ok: false, error: { field: 'root' } });
    }
    expect(parseMatchSetup([valid])).toEqual({ ok: false, error: { field: 'root' } });
    expect(parseMatchSetup({})).toEqual({ ok: false, error: { field: 'mapId' } });
  });

  it('a __proto__ key from JSON.parse cannot pollute Object.prototype or the result', () => {
    const parsed: unknown = JSON.parse(
      '{"mapId":"desert-compound","botCount":5,"difficulty":"easy","__proto__":{"polluted":"yes"}}',
    );
    const r = parseMatchSetup(parsed);
    expect(r.ok).toBe(true);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    if (r.ok) {
      expect(Object.keys(r.value)).toEqual(['mapId', 'botCount', 'difficulty']);
      expect((r.value as unknown as Record<string, unknown>)['polluted']).toBeUndefined();
      expect(Object.getPrototypeOf(r.value)).toBe(Object.prototype);
    }
  });
});

describe('result helpers', () => {
  it('ok and err build the two variants', () => {
    expect(ok(3)).toEqual({ ok: true, value: 3 });
    expect(err('e')).toEqual({ ok: false, error: 'e' });
  });
});

describe('collision layers (SCAL-K-03)', () => {
  it('the five layer bits are distinct single bits within 16 bits', () => {
    const bits = Object.values(Layer);
    expect(bits).toHaveLength(5);
    expect(new Set(bits).size).toBe(5);
    for (const b of bits) {
      expect(b & (b - 1)).toBe(0);
      expect(b).toBeLessThan(0x10000);
    }
  });

  it('mask and includes', () => {
    const m = mask(Layer.WORLD, Layer.BOT_HEAD);
    expect(includes(m, Layer.WORLD)).toBe(true);
    expect(includes(m, Layer.BOT_HEAD)).toBe(true);
    expect(includes(m, Layer.BOT_BODY)).toBe(false);
    expect(mask()).toBe(0);
    expect(MASK_WORLD).toBe(Layer.WORLD);
    for (const b of Object.values(Layer)) expect(includes(MASK_SHOT_ALL, b)).toBe(true);
  });
});
