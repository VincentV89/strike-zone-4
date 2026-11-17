// match-stats (src/stats): BR-ML-50 to BR-ML-56, SD-ML-6.
import { describe, expect, it } from 'vitest';
import { PLAYER_ID, ZERO, type ActorId, type DomainEvent, type MatchSetup } from '@sz/kernel';
import {
  ZERO_TOTALS,
  accuracy,
  accuracyPct,
  addSat,
  applyOutcome,
  createRoundStats,
  createSessionTotals,
  recordEvent,
  summarize,
} from '@sz/stats';
import { denyHits } from '../support/deny-list';

const BOT = 'bot-1' as ActorId;
const BOT2 = 'bot-2' as ActorId;
const SETUP: MatchSetup = { mapId: 'desert-compound', botCount: 5, difficulty: 'normal' };

const shot = (shooter: ActorId): DomainEvent => ({
  type: 'ShotFired',
  shooter,
  weapon: 'rifle',
  origin: ZERO,
  dir: ZERO,
});
const hit = (shooter: ActorId, zone: 'head' | 'body', damage: number): DomainEvent => ({
  type: 'HitConfirmed',
  shooter,
  target: shooter === PLAYER_ID ? BOT : PLAYER_ID,
  zone,
  damage,
  killed: false,
});
const kill = (killer: ActorId, victim: ActorId): DomainEvent => ({
  type: 'ActorKilled',
  killer,
  victim,
  weapon: 'rifle',
  headshot: false,
});
const taken = (victim: ActorId, amount: number): DomainEvent => ({
  type: 'DamageTaken',
  victim,
  from: victim === PLAYER_ID ? BOT : PLAYER_ID,
  dir: ZERO,
  amount,
  healthAfter: 50,
  armorAfter: 0,
});

describe('addSat', () => {
  it.each([
    [1, 2, 3],
    [5, 0, 5],
    [5, -1, 5],
    [5, 1.5, 5],
    [5, Number.NaN, 5],
    [5, Infinity, 5],
    [Number.MAX_SAFE_INTEGER - 1, 5, Number.MAX_SAFE_INTEGER],
  ])('addSat(%s, %s) = %s', (a, b, out) => {
    expect(addSat(a, b)).toBe(out);
  });
});

describe('recordEvent', () => {
  it('counts only the player as shooter, killer or victim', () => {
    const s = createRoundStats();
    for (const e of [
      shot(PLAYER_ID),
      shot(BOT),
      hit(PLAYER_ID, 'body', 28),
      hit(BOT, 'body', 14),
      taken(PLAYER_ID, 14),
      taken(BOT, 28),
      kill(PLAYER_ID, BOT),
      kill(BOT, BOT2),
      { type: 'DryFire', actor: PLAYER_ID, weapon: 'rifle' } as const,
    ]) {
      recordEvent(s, e);
    }
    expect(s).toEqual({
      kills: 1,
      deaths: 0,
      headshots: 0,
      shotsFired: 1,
      shotsHit: 1,
      damageDealt: 28,
      damageReceived: 14,
    });
  });

  it('Q1: every player head-zone hit is a headshot, kill or not', () => {
    const s = createRoundStats();
    recordEvent(s, hit(PLAYER_ID, 'head', 40));
    recordEvent(s, { ...hit(PLAYER_ID, 'head', 60), killed: true } as DomainEvent);
    recordEvent(s, hit(PLAYER_ID, 'body', 28));
    recordEvent(s, hit(BOT, 'head', 112));
    expect(s.headshots).toBe(2);
    expect(s.shotsHit).toBe(3);
    expect(s.damageDealt).toBe(128);
  });

  it('the player death counts as a death, never as a kill', () => {
    const s = createRoundStats();
    recordEvent(s, kill(BOT, PLAYER_ID));
    recordEvent(s, kill(PLAYER_ID, PLAYER_ID));
    expect(s.deaths).toBe(2);
    expect(s.kills).toBe(0);
  });

  it('SEC-ML-23: non-finite damage is ignored, never NaN', () => {
    const s = createRoundStats();
    recordEvent(s, hit(PLAYER_ID, 'body', Number.NaN));
    recordEvent(s, taken(PLAYER_ID, Infinity));
    expect(s.damageDealt).toBe(0);
    expect(s.damageReceived).toBe(0);
    expect(s.shotsHit).toBe(1);
  });
});

describe('accuracy', () => {
  it.each([
    [10, 4, 40],
    [0, 0, 0],
    [3, 1, 33],
    [3, 2, 67],
    [1, 1, 100],
  ])('%s shots, %s hits → %s%%', (shotsFired, shotsHit, pct) => {
    expect(accuracyPct({ shotsFired, shotsHit })).toBe(pct);
  });

  it('never exceeds 1 even for inconsistent counters', () => {
    expect(accuracy({ shotsFired: 1, shotsHit: 5 })).toBe(1);
  });
});

describe('totals', () => {
  it('victory adds a win; every other outcome adds a loss (BR-ML-23)', () => {
    expect(applyOutcome(ZERO_TOTALS, 'victory')).toEqual({ roundsWon: 1, roundsLost: 0 });
    for (const o of ['defeat', 'time-expired', 'abandoned'] as const) {
      expect(applyOutcome(ZERO_TOTALS, o)).toEqual({ roundsWon: 0, roundsLost: 1 });
    }
  });

  it('totals are frozen values, replaced rather than mutated', () => {
    const t = createSessionTotals(2, 3);
    const next = applyOutcome(t, 'victory');
    expect(t).toEqual({ roundsWon: 2, roundsLost: 3 });
    expect(Object.isFrozen(next)).toBe(true);
  });

  it.each([[-1], [1.5], [Number.NaN], ['3'], [null]])('invalid seed count %s becomes 0', (n) => {
    expect(createSessionTotals(n, n)).toEqual({ roundsWon: 0, roundsLost: 0 });
  });
});

describe('summarize', () => {
  const stats = () => {
    const s = createRoundStats();
    for (let i = 0; i < 10; i++) recordEvent(s, shot(PLAYER_ID));
    for (let i = 0; i < 4; i++) recordEvent(s, hit(PLAYER_ID, i === 0 ? 'head' : 'body', 25));
    recordEvent(s, kill(PLAYER_ID, BOT));
    return s;
  };

  it('builds the end-of-round figures from the same stats (BR-ML-55)', () => {
    const out = summarize(stats(), {
      outcome: 'victory',
      liveTicks: 3725,
      enemiesRemaining: 0,
      setup: SETUP,
      totals: { roundsWon: 1, roundsLost: 0 },
    });
    expect(out).toMatchObject({
      outcome: 'victory',
      result: 'victory',
      label: 'Victory',
      kills: 1,
      headshots: 1,
      shotsFired: 10,
      shotsHit: 4,
      accuracyPct: 40,
      damageDealt: 100,
      durationSec: 62.08,
      enemiesRemaining: 0,
    });
  });

  it.each([
    ['defeat', 'Defeat', 'defeat'],
    ['time-expired', 'Time Expired', 'defeat'],
    ['abandoned', 'Abandoned', 'defeat'],
    ['victory', 'Victory', 'victory'],
  ] as const)('%s → label %s, result %s', (outcome, label, result) => {
    const out = summarize(createRoundStats(), {
      outcome,
      liveTicks: 0,
      enemiesRemaining: 2,
      setup: SETUP,
      totals: ZERO_TOTALS,
    });
    expect(out.label).toBe(label);
    expect(out.result).toBe(result);
    expect(denyHits(label)).toEqual([]);
  });

  it('SEC-ML-24: the summary keys are an allowlist, deep-frozen, with no wall-clock time', () => {
    const setup = { ...SETUP, extra: 'x' } as MatchSetup;
    const out = summarize(stats(), {
      outcome: 'defeat',
      liveTicks: -5,
      enemiesRemaining: Number.NaN,
      setup,
      totals: ZERO_TOTALS,
    });
    expect(Object.keys(out).sort()).toEqual(
      [
        'outcome',
        'result',
        'label',
        'setup',
        'kills',
        'deaths',
        'headshots',
        'shotsFired',
        'shotsHit',
        'accuracyPct',
        'damageDealt',
        'damageReceived',
        'enemiesRemaining',
        'durationSec',
        'totals',
      ].sort(),
    );
    expect(Object.keys(out.setup).sort()).toEqual(['botCount', 'difficulty', 'mapId']);
    expect(Object.keys(out.totals).sort()).toEqual(['roundsLost', 'roundsWon']);
    expect(Object.isFrozen(out)).toBe(true);
    expect(Object.isFrozen(out.setup)).toBe(true);
    expect(Object.isFrozen(out.totals)).toBe(true);
    expect(out.durationSec).toBe(0);
    expect(out.enemiesRemaining).toBe(0);
  });
});
