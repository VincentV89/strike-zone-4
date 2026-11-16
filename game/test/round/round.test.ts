// Round controller (business-logic-model-match-loop §2, BR-ML-10 to BR-ML-30, BR-ML-46 to 48).
import { describe, expect, it } from 'vitest';
import { PLAYER_ID, type DomainEvent } from '@sz/kernel';
import { NEUTRAL_INTENT } from '@sz/player';
import {
  COUNTDOWN_TICKS,
  ROUND_DURATIONS,
  evaluateOutcome,
  isRoundDuration,
  parseRoundConfig,
} from '@sz/round';
import { applyPause } from '@sz/round/phases';
import { createSessionTotals } from '@sz/stats';
import {
  aimAt,
  botsInFront,
  config,
  createTestRound,
  fightToVictory,
  headOf,
  intentOf,
  type FakeSimPhysics,
  type TestRound,
} from '../support/round-driver';

const SETUP = { mapId: 'desert-compound', botCount: 1, difficulty: 'normal' } as const;
const phases = (t: TestRound): string[] =>
  t.bus.emitted
    .filter(
      (e): e is Extract<DomainEvent, { type: 'RoundPhaseChanged' }> =>
        e.type === 'RoundPhaseChanged',
    )
    .map((e) => `${e.from}>${e.to}`);

describe('parseRoundConfig (SD-ML-2, BR-ML-10)', () => {
  const good = { setup: SETUP, durationSec: 120, seed: 7 };

  it('accepts a valid config and returns a fresh frozen literal without extra keys', () => {
    const raw = { ...good, extra: true, setup: { ...SETUP, junk: 1 } };
    const r = parseRoundConfig(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual(good);
    expect(Object.isFrozen(r.value)).toBe(true);
    expect(Object.isFrozen(r.value.setup)).toBe(true);
    raw.setup.botCount = 20 as 1;
    expect(r.value.setup.botCount).toBe(1);
  });

  it.each([
    ['null', null],
    ['array', []],
    ['string', 'x'],
    ['bad setup', { ...good, setup: { ...SETUP, botCount: 4 } }],
    ['missing setup', { durationSec: 120, seed: 1 }],
    ['duration as string', { ...good, durationSec: '120' }],
    ['duration NaN', { ...good, durationSec: Number.NaN }],
    ['duration 121', { ...good, durationSec: 121 }],
    ['duration -0', { ...good, durationSec: -0 }],
    ['seed negative', { ...good, seed: -1 }],
    ['seed fraction', { ...good, seed: 1.5 }],
    ['seed too big', { ...good, seed: 2 ** 32 }],
    ['seed string', { ...good, seed: '1' }],
    [
      'proto key',
      JSON.parse(
        '{"__proto__":{"durationSec":120},"setup":{"mapId":"desert-compound","botCount":1,"difficulty":"normal"},"seed":1}',
      ) as unknown,
    ],
  ])('rejects %s', (_name, raw) => {
    expect(parseRoundConfig(raw)).toEqual({ ok: false, error: 'invalid-config' });
  });

  it('ROUND_DURATIONS is frozen and complete', () => {
    expect(ROUND_DURATIONS).toEqual([120, 180, 300, 600]);
    expect(Object.isFrozen(ROUND_DURATIONS)).toBe(true);
    expect(isRoundDuration(300)).toBe(true);
    expect(isRoundDuration(0)).toBe(false);
  });

  it('an invalid start changes nothing', () => {
    const t = createTestRound();
    const before = t.round.state();
    expect(t.round.start({ ...good, durationSec: 7 })).toEqual({
      ok: false,
      error: 'invalid-config',
    });
    expect(t.round.state()).toBe(before);
    expect(t.builds).toBe(0);
    expect(t.bus.emitted).toHaveLength(0);
  });
});

describe('evaluateOutcome (BR-ML-21)', () => {
  const base = { aliveBots: 2, playerAlive: true, liveTicks: 10, durationSec: 120 };
  it.each([
    [{ ...base }, null],
    [{ ...base, aliveBots: 0 }, 'victory'],
    [{ ...base, playerAlive: false }, 'defeat'],
    [{ ...base, liveTicks: 7200 }, 'time-expired'],
    [{ ...base, liveTicks: 7199 }, null],
    [{ ...base, aliveBots: 0, playerAlive: false, liveTicks: 7200 }, 'victory'],
    [{ ...base, playerAlive: false, liveTicks: 7200 }, 'defeat'],
  ])('%o → %s', (input, out) => {
    expect(evaluateOutcome(input)).toBe(out);
  });
});

describe('applyPause (§2.6)', () => {
  it.each([
    ['ready', true, 'ready', true],
    ['ready', false, 'ready', false],
    ['live', true, 'live', true],
    ['countdown', true, 'ready', true],
    ['countdown', false, 'countdown', false],
    ['loading', true, 'loading', false],
    ['ended', true, 'ended', false],
  ] as const)('%s + setPaused(%s) → %s, paused %s', (phase, p, to, paused) => {
    const out = applyPause({ phase: phase, paused: false, countdownTicks: 42 }, p);
    expect(out.phase).toBe(to);
    expect(out.paused).toBe(paused);
    if (phase === 'countdown' && p) expect(out.countdownTicks).toBe(COUNTDOWN_TICKS);
  });
});

describe('lifecycle and countdown (R1 to R3, BR-ML-11 to BR-ML-15)', () => {
  it('start → ready; Ready does not step; lock gain starts a 180-tick countdown; GO goes live', () => {
    const t = createTestRound({ botCount: 2 });
    expect(t.round.state()).toMatchObject({ phase: 'loading', started: false });
    expect(t.round.snapshot()).toBeUndefined();
    expect(t.round.start(config(t)).ok).toBe(true);
    expect(t.round.state().phase).toBe('ready');
    t.run(50);
    expect(t.sim().stats().tick).toBe(0); // BR-ML-14
    t.round.beginCountdown();
    expect(t.round.state()).toMatchObject({ phase: 'countdown', countdown: 3 });
    const spawn = t.round.snapshot()!.player.pos;
    t.run(60, () => intentOf({ fire: true, firePressed: true, move: { forward: 1, right: 0 } }));
    expect(t.round.state().countdown).toBe(2);
    t.run(60, () => intentOf({ fire: true, move: { forward: 1, right: 0 } }));
    expect(t.round.state().countdown).toBe(1);
    t.run(59, () => intentOf({ fire: true, move: { forward: 1, right: 0 }, jump: true }));
    expect(t.round.state().phase).toBe('countdown');
    const p = t.round.snapshot()!.player.pos;
    expect(Math.hypot(p.x - spawn.x, p.z - spawn.z)).toBeLessThan(1e-9);
    expect(t.bus.emitted.some((e) => e.type === 'ShotFired')).toBe(false);
    t.run(1);
    expect(t.round.state()).toMatchObject({ phase: 'live', started: true, timeLeftSec: 120 });
    expect(phases(t)).toEqual(['loading>ready', 'ready>countdown', 'countdown>live']);
    // The first live tick allows fire.
    t.run(1, () => intentOf({ fire: true, firePressed: true }));
    expect(t.bus.emitted.some((e) => e.type === 'ShotFired' && e.shooter === PLAYER_ID)).toBe(true);
  });

  it('look works in Ready and the countdown but not while paused or after death', () => {
    const t = createTestRound({ botCount: 1 });
    t.round.start(config(t));
    t.round.look({ dx: 100, dy: 0 }, 1);
    const yaw1 = t.round.snapshot()!.player.yaw;
    expect(yaw1).not.toBe(0);
    t.round.setPaused(true);
    t.round.look({ dx: 100, dy: 0 }, 1);
    expect(t.round.snapshot()!.player.yaw).toBe(yaw1);
    t.round.setPaused(false);
    t.round.beginCountdown();
    t.round.look({ dx: 100, dy: 0 }, 1);
    expect(t.round.snapshot()!.player.yaw).not.toBe(yaw1);
  });

  it('beginCountdown is ignored unless Ready and unpaused', () => {
    const t = createTestRound({ botCount: 1 });
    t.round.beginCountdown();
    expect(t.round.state().phase).toBe('loading');
    t.round.start(config(t));
    t.round.setPaused(true);
    t.round.beginCountdown();
    expect(t.round.state().phase).toBe('ready');
  });
});

describe('pause (R4, R5, BR-ML-16, BR-ML-17)', () => {
  it('pausing in the countdown cancels it; the next lock gain restarts a full countdown', () => {
    const t = createTestRound({ botCount: 1 });
    t.round.start(config(t));
    t.round.beginCountdown();
    t.run(100);
    t.round.setPaused(true);
    expect(t.round.state()).toMatchObject({ phase: 'ready', paused: true });
    t.round.setPaused(false);
    t.round.beginCountdown();
    t.run(179);
    expect(t.round.state().phase).toBe('countdown');
    t.run(1);
    expect(t.round.state().phase).toBe('live');
  });

  it('a paused live round freezes the timer, bots and physics; resume continues', () => {
    const t = createTestRound({ botCount: 3 });
    t.goLive();
    t.run(120);
    const left = t.round.state().timeLeftSec;
    const snap = t.round.snapshot();
    const steps = (t.physics() as FakeSimPhysics).counts.step;
    t.round.setPaused(true);
    t.run(300);
    expect(t.round.state()).toMatchObject({ paused: true, timeLeftSec: left });
    expect(t.round.snapshot()).toBe(snap);
    expect((t.physics() as FakeSimPhysics).counts.step).toBe(steps);
    t.round.setPaused(false);
    t.run(60);
    expect(t.round.state().timeLeftSec).toBeCloseTo(left - 1, 9);
  });

  it('setPaused ignores non-boolean input and the loading and ended phases', () => {
    const t = createTestRound({ botCount: 1 });
    t.round.setPaused(true);
    expect(t.round.state().paused).toBe(false);
    t.round.start(config(t));
    t.round.setPaused('yes' as unknown as boolean);
    expect(t.round.state().paused).toBe(false);
  });
});

describe('outcomes (story-round-outcomes, BR-ML-21 to BR-ML-25)', () => {
  it('victory: the last kill ends the round, wins +1, emits RoundEnded once', () => {
    const t = createTestRound({ botCount: 3, seed: 3, placeBots: botsInFront });
    t.goLive();
    expect(fightToVictory(t)).toBeLessThan(1200);
    const s = t.round.state();
    expect(s).toMatchObject({ phase: 'ended', outcome: 'victory' });
    expect(s.summary).toMatchObject({ label: 'Victory', kills: 3, enemiesRemaining: 0 });
    expect(t.round.totals()).toEqual({ roundsWon: 1, roundsLost: 0 });
    const ended = t.bus.emitted.filter((e) => e.type === 'RoundEnded');
    expect(ended).toEqual([
      { type: 'RoundEnded', outcome: 'victory', durationSec: s.summary?.durationSec },
    ]);
    expect(phases(t).at(-1)).toBe('live>ended');
    // BR-ML-24: an outcome is final.
    t.run(100, () => intentOf({ fire: true }));
    expect(t.round.totals()).toEqual({ roundsWon: 1, roundsLost: 0 });
    expect(t.bus.emitted.filter((e) => e.type === 'RoundEnded')).toHaveLength(1);
  });

  it('end-of-round stats: kills, headshots, accuracy and damage come from the same events', () => {
    const t = createTestRound({ botCount: 2, seed: 3, placeBots: botsInFront });
    t.goLive();
    // Two body misses into the sky, then head shots.
    t.round.look({ dx: 0, dy: -400 }, 1);
    t.run(2, (i) => intentOf({ fire: i === 0, firePressed: i === 0 }));
    t.run(10);
    fightToVictory(t);
    const sum = t.round.state().summary!;
    const ev = t.bus.emitted;
    const fired = ev.filter((e) => e.type === 'ShotFired' && e.shooter === PLAYER_ID).length;
    const hits = ev.filter((e) => e.type === 'HitConfirmed' && e.shooter === PLAYER_ID);
    expect(sum.shotsFired).toBe(fired);
    expect(sum.shotsHit).toBe(hits.length);
    expect(sum.headshots).toBe(
      hits.filter((e) => e.type === 'HitConfirmed' && e.zone === 'head').length,
    );
    expect(sum.damageDealt).toBe(
      hits.reduce((n, e) => n + (e.type === 'HitConfirmed' ? e.damage : 0), 0),
    );
    expect(sum.accuracyPct).toBe(Math.round((100 * hits.length) / fired));
    expect(sum.shotsFired).toBeGreaterThan(sum.shotsHit);
  });

  it('defeat: the player dies, lost +1, deaths 1', () => {
    const t = createTestRound({ botCount: 2, seed: 5, difficulty: 'hard', placeBots: botsInFront });
    t.goLive();
    t.run(3000);
    expect(t.round.state()).toMatchObject({ phase: 'ended', outcome: 'defeat' });
    expect(t.round.state().summary).toMatchObject({ label: 'Defeat', deaths: 1, result: 'defeat' });
    expect(t.round.state().summary!.damageReceived).toBeGreaterThan(0);
    expect(t.round.totals()).toEqual({ roundsWon: 0, roundsLost: 1 });
  });

  it('time-expired at exactly duration × 60 live ticks is a defeat labelled Time Expired', () => {
    const t = createTestRound({ botCount: 1, seed: 1 });
    t.goLive();
    (t.physics() as FakeSimPhysics).untouchable.add(PLAYER_ID);
    t.run(7199);
    expect(t.round.state().phase).toBe('live');
    expect(t.round.state().timeLeftSec).toBeCloseTo(1 / 60, 9);
    t.run(1);
    const s = t.round.state();
    expect(s).toMatchObject({ phase: 'ended', outcome: 'time-expired', timeLeftSec: 0 });
    expect(s.summary).toMatchObject({ label: 'Time Expired', result: 'defeat', durationSec: 120 });
    expect(t.round.totals()).toEqual({ roundsWon: 0, roundsLost: 1 });
  }, 60_000);

  it('totals seeded from persistence carry across rounds', () => {
    const t = createTestRound({
      botCount: 1,
      seed: 3,
      placeBots: botsInFront,
      totals: createSessionTotals(4, 2),
    });
    t.goLive();
    fightToVictory(t);
    expect(t.round.totals()).toEqual({ roundsWon: 5, roundsLost: 2 });
    expect(t.round.restart().start.ok).toBe(true);
    expect(t.round.state().totals).toEqual({ roundsWon: 5, roundsLost: 2 });
  });
});

describe('abandon (Q2, BR-ML-27 to BR-ML-29)', () => {
  it('Restart from a live round records a loss and returns a summary; no RoundEnded', () => {
    const t = createTestRound({ botCount: 2 });
    t.goLive();
    t.run(60);
    const r = t.round.restart();
    expect(r.recordedAbandon).toBe(true);
    expect(r.summary).toMatchObject({ outcome: 'abandoned', label: 'Abandoned', result: 'defeat' });
    expect(r.start.ok).toBe(true);
    expect(t.round.totals()).toEqual({ roundsWon: 0, roundsLost: 1 });
    expect(t.bus.emitted.some((e) => e.type === 'RoundEnded')).toBe(false);
    expect(t.round.state()).toMatchObject({ phase: 'ready', started: false });
    expect(t.round.state().summary).toBeUndefined();
  });

  it.each(['ready', 'countdown'] as const)('abandoning in %s records nothing', (phase) => {
    const t = createTestRound({ botCount: 1 });
    t.round.start(config(t));
    if (phase === 'countdown') {
      t.round.beginCountdown();
      t.run(30);
    }
    expect(t.round.restart()).toMatchObject({ recordedAbandon: false });
    expect(t.round.quitToMenu()).toEqual({ recordedAbandon: false });
    expect(t.round.totals()).toEqual({ roundsWon: 0, roundsLost: 0 });
  });

  it('Play Again after the end records nothing and builds a fresh round on the reused world', () => {
    const t = createTestRound({ botCount: 2, seed: 3, placeBots: botsInFront });
    t.goLive();
    fightToVictory(t);
    const r = t.round.restart();
    expect(r.recordedAbandon).toBe(false);
    expect(r.start.ok).toBe(true);
    expect(t.nextSeedCalls).toBe(1);
    expect(t.round.totals()).toEqual({ roundsWon: 1, roundsLost: 0 });
    expect(t.round.snapshot()?.aliveBots).toBe(2);
    expect(t.round.snapshot()?.player.vitals).toEqual({ health: 100, armor: 100 });
  });

  it('Main Menu from a live round records the loss, disposes the sim and goes idle', () => {
    const t = createTestRound({ botCount: 2 });
    t.goLive();
    const sim = t.sim();
    const r = t.round.quitToMenu();
    expect(r.recordedAbandon).toBe(true);
    expect(sim.disposed).toBe(true);
    expect(t.physics().stats().characters).toBe(0);
    expect(t.round.state()).toMatchObject({ phase: 'loading', started: false });
    expect(t.round.snapshot()).toBeUndefined();
    t.round.tick(NEUTRAL_INTENT);
    expect(t.round.totals()).toEqual({ roundsWon: 0, roundsLost: 1 });
  });

  it('restart with no round started returns invalid-config', () => {
    const t = createTestRound();
    expect(t.round.restart()).toEqual({
      recordedAbandon: false,
      start: { ok: false, error: 'invalid-config' },
    });
  });
});

describe('pending duration (BR-ML-30)', () => {
  it('a duration change applies at the next restart; the current timer is unaffected', () => {
    const t = createTestRound({ botCount: 1 });
    t.goLive();
    t.round.setPendingDuration(300);
    t.round.setPendingDuration(7); // invalid: ignored, 300 kept
    expect(t.round.state().durationSec).toBe(120);
    t.round.restart();
    expect(t.round.state().durationSec).toBe(300);
    t.round.restart(600);
    expect(t.round.state().durationSec).toBe(600);
    t.round.restart(5);
    expect(t.round.state().durationSec).toBe(600);
  });
});

describe('reset and leaks (BR-ML-45 to BR-ML-48, REL-ML-2)', () => {
  it('ten consecutive restarts leave the same physics, perception, board and nav state', () => {
    const t = createTestRound({ botCount: 5, seed: 2, placeBots: botsInFront });
    t.goLive();
    const first = {
      physics: t.physics().stats(),
      perception: t.sim().stats().perception,
      board: t.sim().stats().board,
    };
    const physics = t.physics();
    for (let i = 0; i < 10; i++) {
      t.run(120, (k) => intentOf({ fire: k % 10 === 0, move: { forward: 0, right: 1 } }));
      const r = t.round.restart();
      expect(r.start.ok).toBe(true);
      expect(t.physics()).toBe(physics); // the world is reused
      expect(t.physics().stats()).toEqual(first.physics);
      expect(t.sim().stats().bots).toBe(5);
      expect(t.round.snapshot()?.bots.every((b) => b.alive && b.state === 'patrol')).toBe(true);
      t.round.beginCountdown();
      t.run(180);
      expect(t.sim().stats().perception).toEqual(first.perception);
      expect(t.sim().stats().board).toEqual(first.board);
    }
    expect(t.builds).toBe(11);
  }, 60_000);

  it('BR-ML-46: start clears the bus so no event of the old round leaks', () => {
    const t = createTestRound({ botCount: 1 });
    t.goLive();
    t.run(10, () => intentOf({ fire: true }));
    expect(t.bus.pending).toBeGreaterThan(0);
    t.round.restart();
    const pending = t.bus.drain();
    expect(pending.map((e) => e.type)).toEqual(['RoundPhaseChanged', 'RoundPhaseChanged']);
  });
});

describe('stats integrity and view (SD-ML-6, SD-ML-4)', () => {
  it('forged events on the bus never reach the stats', () => {
    const t = createTestRound({ botCount: 1, seed: 3, placeBots: botsInFront });
    t.goLive();
    for (let i = 0; i < 50; i++) {
      t.bus.emit({
        type: 'HitConfirmed',
        shooter: PLAYER_ID,
        target: PLAYER_ID,
        zone: 'head',
        damage: 100,
        killed: true,
      });
    }
    const target = t.round.snapshot()!.bots[0]!;
    aimAt(t.round, headOf(target));
    t.run(1, () => intentOf({ fire: true, firePressed: true }));
    const sum = t.round.state().summary!;
    expect(sum.headshots).toBe(1);
    expect(sum.shotsHit).toBe(1);
  });

  it('RoundView is frozen and memoised until something changes', () => {
    const t = createTestRound({ botCount: 1 });
    const idle = t.round.state();
    expect(t.round.state()).toBe(idle);
    expect(Object.isFrozen(idle)).toBe(true);
    t.round.start(config(t));
    const ready = t.round.state();
    expect(ready).not.toBe(idle);
    expect(t.round.state()).toBe(ready);
    expect(ready.setup).toEqual({ mapId: 'desert-compound', botCount: 1, difficulty: 'normal' });
  });

  it('SEC-ML-04: tick takes exactly one argument', () => {
    const t = createTestRound({ botCount: 1 });
    // @ts-expect-error dt is fixed at STEP_SEC; a caller cannot pass one.
    t.round.tick(NEUTRAL_INTENT, 1 / 30);
    expect(t.round.tick.length).toBe(1);
  });
});
