// sim building blocks: copy-and-freeze (SD-ML-4), containment (SD-ML-5), trigger, seeds, rules.
import { describe, expect, it } from 'vitest';
import { seedFor } from '@sz/ai';
import { PLAYER_ID, vec3, type ActorId, type DomainEvent } from '@sz/kernel';
import { EYE_HEIGHT } from '@sz/physics';
import { NEUTRAL_INTENT } from '@sz/player';
import {
  BOT_WEAPON_SALT,
  SIM_RULES,
  SPAWN_SALT,
  botWeaponSeed,
  brainSeed,
  copyEvent,
  playerWeaponSeed,
  spawnSeed,
} from '@sz/sim';
import { createContainment } from '@sz/sim/containment';
import { createTickLog } from '@sz/sim/events';
import { playerTrigger } from '@sz/sim/trigger';

const BOT = 'bot-1' as ActorId;
const BOT2 = 'bot-2' as ActorId;

/** One event of every kernel type, each with fresh vectors. */
function everyEvent(): DomainEvent[] {
  const p = () => vec3(1, 2, 3);
  return [
    { type: 'ShotFired', shooter: PLAYER_ID, weapon: 'rifle', origin: p(), dir: p() },
    { type: 'ShotImpact', shooter: PLAYER_ID, point: p(), normal: p(), surface: 'world' },
    {
      type: 'HitConfirmed',
      shooter: PLAYER_ID,
      target: BOT,
      zone: 'head',
      damage: 1,
      killed: false,
    },
    {
      type: 'DamageTaken',
      victim: BOT,
      from: PLAYER_ID,
      dir: p(),
      amount: 1,
      healthAfter: 99,
      armorAfter: 0,
    },
    { type: 'ActorKilled', killer: PLAYER_ID, victim: BOT, weapon: 'rifle', headshot: true },
    { type: 'WeaponSwitched', actor: PLAYER_ID, from: 'rifle', to: 'pistol' },
    { type: 'ReloadStarted', actor: PLAYER_ID, weapon: 'rifle', durationSec: 2 },
    { type: 'ReloadDone', actor: PLAYER_ID, weapon: 'rifle', magazine: 30, reserve: 60 },
    { type: 'DryFire', actor: PLAYER_ID, weapon: 'rifle' },
    { type: 'Footstep', actor: PLAYER_ID, pos: p(), gait: 'walk' },
    { type: 'NoiseEmitted', source: PLAYER_ID, pos: p(), radius: 40, kind: 'gunfire' },
    { type: 'BotStateChanged', bot: BOT, from: 'patrol', to: 'engage' },
    { type: 'RoundPhaseChanged', from: 'ready', to: 'countdown' },
    { type: 'RoundEnded', outcome: 'victory', durationSec: 10 },
    { type: 'PerformanceAdvisory', medianFps: 50, botCount: 5 },
  ];
}

function nestedObjects(x: unknown): object[] {
  if (typeof x !== 'object' || x === null) return [];
  return [x, ...Object.values(x).flatMap(nestedObjects)];
}

describe('copyEvent and the tick log (SD-ML-4)', () => {
  it('covers every kernel event type and copies every vector', () => {
    const events = everyEvent();
    expect(new Set(events.map((e) => e.type)).size).toBe(15);
    for (const e of events) {
      const c = copyEvent(e);
      expect(c).toEqual(e);
      expect(c).not.toBe(e);
      const originals = new Set(nestedObjects(e));
      for (const o of nestedObjects(c)) expect(originals.has(o)).toBe(false);
    }
  });

  it('a forged unknown type is copied shallowly by the exhaustive default', () => {
    const forged = { type: 'Forged', x: 1 } as unknown as DomainEvent;
    expect(copyEvent(forged)).toBe(forged);
  });

  it('logged events are deep-frozen and later mutation of the source has no effect', () => {
    const log = createTickLog();
    const src = { type: 'Footstep', actor: PLAYER_ID, pos: { x: 1, y: 0, z: 2 }, gait: 'walk' };
    const c = log.log(src as DomainEvent);
    src.pos.x = 99;
    expect(c.type === 'Footstep' && c.pos.x).toBe(1);
    for (const o of nestedObjects(c)) expect(Object.isFrozen(o)).toBe(true);
  });

  it('events() is frozen, memoised until the next log, and emptied by clear()', () => {
    const log = createTickLog();
    expect(log.events()).toEqual([]);
    for (const e of everyEvent()) log.log(e);
    const a = log.events();
    expect(a).toBe(log.events());
    expect(Object.isFrozen(a)).toBe(true);
    expect(log.size).toBe(15);
    log.log(everyEvent()[0]!);
    expect(log.events()).not.toBe(a);
    log.clear();
    expect(log.size).toBe(0);
    expect(log.events()).toEqual([]);
  });
});

describe('containment (SD-ML-5)', () => {
  it('a throw freezes the bot for the tick and reports once per round', () => {
    const calls: [ActorId, unknown][] = [];
    const c = createContainment((bot, err) => calls.push([bot, err]));
    const boom = new Error('boom');
    expect(
      c.guard(BOT, (): number => {
        throw boom;
      }),
    ).toBeUndefined();
    expect(c.isFrozen(BOT)).toBe(true);
    expect(c.guard(BOT, () => 1)).toBeUndefined(); // still frozen this tick
    expect(c.guard(BOT2, () => 2)).toBe(2);
    c.beginTick();
    expect(c.guard(BOT, () => 3)).toBe(3);
    c.guard(BOT, () => {
      throw new Error('again');
    });
    expect(calls).toEqual([[BOT, boom]]);
    expect(c.reportedCount).toBe(1);
    c.resetRound();
    c.guard(BOT, () => {
      throw new Error('next round');
    });
    expect(calls).toHaveLength(2);
  });

  it('SEC-ML-30: a throwing reporter propagates', () => {
    const c = createContainment(() => {
      throw new Error('reporter');
    });
    expect(() => {
      c.guard(BOT, () => {
        throw new Error('bot');
      });
    }).toThrow('reporter');
  });
});

describe('playerTrigger', () => {
  it('maps held fire or the press edge, reload, aim and switch', () => {
    expect(playerTrigger(NEUTRAL_INTENT)).toEqual({ fire: false, reload: false, scope: false });
    expect(playerTrigger({ ...NEUTRAL_INTENT, firePressed: true }).fire).toBe(true);
    expect(playerTrigger({ ...NEUTRAL_INTENT, fire: true }).fire).toBe(true);
    expect(
      playerTrigger({ ...NEUTRAL_INTENT, reload: true, aim: true, switchTo: 'sniper' }),
    ).toEqual({ fire: false, reload: true, scope: true, switchTo: 'sniper' });
    expect('switchTo' in playerTrigger(NEUTRAL_INTENT)).toBe(false);
  });
});

describe('seeds and rules', () => {
  it('derives disjoint streams from one round seed', () => {
    const seeds = [
      spawnSeed(7),
      brainSeed(7, 0),
      brainSeed(7, 1),
      playerWeaponSeed(7),
      botWeaponSeed(7, 0),
      botWeaponSeed(7, 1),
    ];
    expect(new Set(seeds).size).toBe(seeds.length);
    for (const s of seeds) expect(s >>> 0).toBe(s);
    expect(spawnSeed(7)).toBe(seedFor(7, SPAWN_SALT));
    // Same bot weapon streams as the bot-ai arena harness.
    expect(botWeaponSeed(7, 3)).toBe(seedFor(7 ^ BOT_WEAPON_SALT, 3));
    expect(spawnSeed(8)).not.toBe(spawnSeed(7));
  });

  it('bot eye heights match the physics adapter', () => {
    expect(SIM_RULES.botEyeStand).toBe(EYE_HEIGHT.stand);
    expect(SIM_RULES.botEyeCrouch).toBe(EYE_HEIGHT.crouch);
    expect(Object.isFrozen(SIM_RULES)).toBe(true);
  });
});
