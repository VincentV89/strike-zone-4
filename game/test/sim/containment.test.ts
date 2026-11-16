// Narrow per-bot containment (SD-ML-5) and no-cheat wiring (SD-ML-3), with @sz/ai wrapped by
// spies so a bot's AI can be made to throw and every call's arguments can be inspected.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as ai from '@sz/ai';
import { PLAYER_ID, type ActorId } from '@sz/kernel';
import {
  botsInFront,
  createTestRound,
  intentOf,
  type FakeSimPhysics,
} from '../support/round-driver';

vi.mock('@sz/ai', async (importOriginal) => {
  const real = await importOriginal<typeof import('@sz/ai')>();
  return {
    ...real,
    createBotWorldView: vi.fn(real.createBotWorldView),
    decide: vi.fn(real.decide),
    tick: vi.fn(real.tick),
  };
});

const BOT2 = 'bot-2' as ActorId;
const tickSpy = vi.mocked(ai.tick);
const decideSpy = vi.mocked(ai.decide);
const worldSpy = vi.mocked(ai.createBotWorldView);
const realTick = tickSpy.getMockImplementation()!;

afterEach(() => {
  tickSpy.mockImplementation(realTick);
  tickSpy.mockClear();
  decideSpy.mockClear();
  worldSpy.mockClear();
});

/** Records the trajectory of every actor over n live ticks. */
function trajectory(t: ReturnType<typeof createTestRound>, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    t.round.tick(intentOf({ move: { forward: 0, right: i % 120 < 60 ? 1 : -1 } }));
    const s = t.round.snapshot()!;
    out.push(
      [s.player.pos, ...s.bots.filter((b) => b.id !== BOT2).map((b) => b.pos)]
        .map((p) => `${p.x.toFixed(4)},${p.z.toFixed(4)}`)
        .join(';'),
    );
  }
  return out;
}

describe('per-bot containment (BR-ML-34, SD-ML-5)', () => {
  it('a bot whose AI throws is frozen for that tick, reported once, and the round goes on', () => {
    // Control: bot-2's AI returns a still intent instead of throwing.
    tickSpy.mockImplementation((brain, ...rest) =>
      brain.id === BOT2 ? ai.zeroIntent(brain.aim.yaw, 0) : realTick(brain, ...rest),
    );
    const control = createTestRound({ botCount: 3, seed: 21 });
    control.goLive();
    const expected = trajectory(control, 600);
    expect(control.reports).toHaveLength(0);

    tickSpy.mockImplementation((brain, ...rest) => {
      if (brain.id === BOT2) throw new Error('bot-2 AI bug');
      return realTick(brain, ...rest);
    });
    const t = createTestRound({ botCount: 3, seed: 21 });
    t.goLive();
    const bot2Start = t.round.snapshot()!.bots[1]!.pos;
    const got = trajectory(t, 600);
    expect(t.reports).toHaveLength(1);
    expect(t.reports[0]?.bot).toBe(BOT2);
    expect(t.round.state().phase).toBe('live');
    // bot-2 stands still under gravity and never fires.
    const bot2 = t.round.snapshot()!.bots[1]!;
    expect(Math.hypot(bot2.pos.x - bot2Start.x, bot2.pos.z - bot2Start.z)).toBeLessThan(1e-9);
    expect(t.bus.emitted.some((e) => e.type === 'ShotFired' && e.shooter === BOT2)).toBe(false);
    // The player and the other bots are unaffected (bots never share mutable state).
    expect(got).toEqual(expected);
  });

  it('in a normal round the reporter is never called', () => {
    const t = createTestRound({ botCount: 3, seed: 21, placeBots: botsInFront });
    t.goLive();
    t.run(600, (i) => intentOf({ fire: i % 50 === 0 }));
    expect(t.reports).toHaveLength(0);
  });

  it.each(['step', 'move', 'raycast'] as const)(
    'SEC-ML-31: a throwing physics %s propagates out of round.tick',
    (which) => {
      const t = createTestRound({ botCount: 2, seed: 3, placeBots: botsInFront });
      t.goLive();
      (t.physics() as FakeSimPhysics).throwOn[which] = true;
      expect(() => {
        for (let i = 0; i < 30; i++) t.round.tick(intentOf({ fire: true, firePressed: true }));
      }).toThrow(`fake ${which} failure`);
      expect(t.reports).toHaveLength(0);
    },
  );
});

describe('no-cheat wiring (SD-ML-3, BR-ML-03)', () => {
  it('bot-ai receives only the narrow frozen world view, never the snapshot or the physics port', () => {
    const t = createTestRound({ botCount: 3, seed: 8, placeBots: botsInFront });
    t.goLive();
    t.run(300, (i) => intentOf({ fire: i % 60 === 0 }));
    expect(worldSpy).toHaveBeenCalledTimes(1);
    const world = worldSpy.mock.results[0]?.value as ai.BotWorldView;
    expect(Object.isFrozen(world)).toBe(true);
    expect(Object.keys(world.sight)).toEqual(['lineOfSight']);
    expect('raycast' in world.nav).toBe(false);
    expect('clearReservations' in world.nav).toBe(false);
    expect(Object.keys(world.budget)).toEqual(['tryConsume']);
    expect(decideSpy.mock.calls.length).toBeGreaterThan(0);
    expect(tickSpy.mock.calls.length).toBeGreaterThan(0);
    const physics = t.physics();
    const snapshot = t.round.snapshot();
    for (const call of [...decideSpy.mock.calls, ...tickSpy.mock.calls]) {
      const [, percepts, self, w] = call;
      expect(w).toBe(world);
      for (const arg of call) {
        expect(arg).not.toBe(physics);
        expect(arg).not.toBe(snapshot);
      }
      expect(Object.keys(self).sort()).toEqual(['alive', 'eye', 'health', 'id', 'pos', 'weapon']);
      expect(self.id).not.toBe(PLAYER_ID);
      expect(Object.isFrozen(percepts)).toBe(true);
    }
  });

  it('during the countdown no bot decides, ticks or fires', () => {
    const t = createTestRound({ botCount: 3, seed: 8, placeBots: botsInFront });
    expect(t.round.start({ setup: t.setup, durationSec: 120, seed: 8 }).ok).toBe(true);
    t.round.beginCountdown();
    decideSpy.mockClear();
    tickSpy.mockClear();
    t.run(180, () => intentOf({ fire: true, firePressed: true }));
    expect(decideSpy).not.toHaveBeenCalled();
    expect(tickSpy).not.toHaveBeenCalled();
    expect(t.bus.emitted.some((e) => e.type === 'ShotFired')).toBe(false);
  });
});
