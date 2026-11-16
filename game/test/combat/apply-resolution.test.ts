import { describe, expect, it } from 'vitest';
import { PLAYER_ID, ZERO, vec3, type ActorId, type DomainEvent } from '@sz/kernel';
import {
  BOT_START_VITALS,
  PLAYER_START_VITALS,
  applyResolution,
  resolveShot,
  type CombatActor,
  type ShotResolution,
} from '@sz/combat';
import type { ShotRequest } from '@sz/weapons';
import { createFakePhysics } from '../support/fakes';
import { createActorTable, fakeActorAt } from '../support/combat-scene';
import { createRecordingBus } from '../support/recording-bus';

const BOT_1 = 'bot-1' as ActorId;
const SHOT: ShotRequest = {
  shooter: PLAYER_ID,
  weapon: 'rifle',
  origin: vec3(0, 1.6, 0),
  dir: vec3(0, 0, -1),
  rangeM: 200,
  spread: 0,
};
const IMPACT = { point: vec3(0, 1.6, -9.8), normal: vec3(0, 0, 1), distance: 9.8 };

function setup(botVitals = BOT_START_VITALS) {
  const actors: CombatActor[] = [
    { id: PLAYER_ID, side: 'player', vitals: PLAYER_START_VITALS },
    { id: BOT_1, side: 'bot', vitals: botVitals },
  ];
  return { table: createActorTable(actors), bus: createRecordingBus() };
}

const types = (events: ReadonlyArray<DomainEvent>) => events.map((e) => e.type);

describe('applyResolution event order (BR-C-20..24)', () => {
  it('miss: ShotFired only', () => {
    const { table, bus } = setup();
    applyResolution({ kind: 'miss', shot: SHOT }, table, bus);
    expect(bus.emitted).toEqual([
      {
        type: 'ShotFired',
        shooter: PLAYER_ID,
        weapon: 'rifle',
        origin: SHOT.origin,
        dir: SHOT.dir,
      },
    ]);
  });

  it('a rejected request emits nothing', () => {
    const { table, bus } = setup();
    applyResolution({ kind: 'miss', shot: SHOT, rejected: true }, table, bus);
    expect(bus.emitted).toEqual([]);
  });

  it('world: ShotFired, then ShotImpact on the world (no hit marker, req-hit-feedback AC2)', () => {
    const { table, bus } = setup();
    applyResolution({ kind: 'world', shot: SHOT, ...IMPACT }, table, bus);
    expect(types(bus.emitted)).toEqual(['ShotFired', 'ShotImpact']);
    expect(bus.emitted[1]).toEqual({
      type: 'ShotImpact',
      shooter: PLAYER_ID,
      point: IMPACT.point,
      normal: IMPACT.normal,
      surface: 'world',
    });
    expect(table.writes).toEqual([]);
  });

  it('blocked: an actor impact and nothing else (BR-C-06)', () => {
    const { table, bus } = setup();
    applyResolution({ kind: 'blocked', shot: SHOT, target: BOT_1, ...IMPACT }, table, bus);
    expect(types(bus.emitted)).toEqual(['ShotFired', 'ShotImpact']);
    expect(bus.emitted[1]).toMatchObject({ surface: 'actor', target: BOT_1 });
    expect(table.writes).toEqual([]);
  });

  it('hit that does not kill: impact, HitConfirmed, DamageTaken with applied damage', () => {
    const { table, bus } = setup();
    const res: ShotResolution = {
      kind: 'hit',
      shot: SHOT,
      target: BOT_1,
      zone: 'body',
      rawDamage: 28,
      ...IMPACT,
    };
    applyResolution(res, table, bus);
    expect(types(bus.emitted)).toEqual(['ShotFired', 'ShotImpact', 'HitConfirmed', 'DamageTaken']);
    expect(bus.emitted[2]).toEqual({
      type: 'HitConfirmed',
      shooter: PLAYER_ID,
      target: BOT_1,
      zone: 'body',
      damage: 28,
      killed: false,
    });
    expect(bus.emitted[3]).toEqual({
      type: 'DamageTaken',
      victim: BOT_1,
      from: PLAYER_ID,
      dir: vec3(0, 0, 1),
      amount: 28,
      healthAfter: 72,
      armorAfter: 0,
    });
    expect(table.vitalsOf(BOT_1)).toEqual({ health: 72, armor: 0 });
  });

  it('S4: a killing headshot adds ActorKilled with headshot true; damage is what was applied', () => {
    const { table, bus } = setup();
    const res: ShotResolution = {
      kind: 'hit',
      shot: SHOT,
      target: BOT_1,
      zone: 'head',
      rawDamage: 112,
      ...IMPACT,
    };
    applyResolution(res, table, bus);
    expect(types(bus.emitted)).toEqual([
      'ShotFired',
      'ShotImpact',
      'HitConfirmed',
      'DamageTaken',
      'ActorKilled',
    ]);
    expect(bus.emitted[2]).toMatchObject({ damage: 100, killed: true, zone: 'head' });
    expect(bus.emitted[4]).toEqual({
      type: 'ActorKilled',
      killer: PLAYER_ID,
      victim: BOT_1,
      weapon: 'rifle',
      headshot: true,
    });
  });

  it('armor counts toward the applied damage (BR-C-23)', () => {
    const { table, bus } = setup();
    const res: ShotResolution = {
      kind: 'hit',
      shot: { ...SHOT, shooter: BOT_1, origin: vec3(0, 1.6, -10), dir: vec3(0, 0, 1) },
      target: PLAYER_ID,
      zone: 'body',
      rawDamage: 28,
      point: vec3(0.5, 1, -0.3),
      normal: vec3(0, 0, -1),
      distance: 9.7,
    };
    applyResolution(res, table, bus);
    expect(bus.emitted[2]).toMatchObject({ damage: 28 });
    expect(bus.emitted[3]).toMatchObject({ amount: 28, healthAfter: 86, armorAfter: 86 });
    const dir = (bus.emitted[3] as Extract<DomainEvent, { type: 'DamageTaken' }>).dir;
    expect(dir.y).toBe(0);
    expect(Math.hypot(dir.x, dir.z)).toBeCloseTo(1, 12);
    expect(dir.z).toBeLessThan(0); // toward the attacker at -Z
  });

  it('BR-C-24: DamageTaken.dir is ZERO when attacker and victim share x and z', () => {
    const { table, bus } = setup();
    const res: ShotResolution = {
      kind: 'hit',
      shot: { ...SHOT, origin: vec3(0, 3, -10), dir: vec3(0, -1, 0) },
      target: BOT_1,
      zone: 'head',
      rawDamage: 112,
      point: vec3(0, 1.8, -10),
      normal: vec3(0, 1, 0),
      distance: 1.2,
    };
    applyResolution(res, table, bus);
    expect(bus.emitted[3]).toMatchObject({ type: 'DamageTaken', dir: ZERO });
  });

  it('SEC-WC-06: a target that is dead or gone at apply time takes nothing', () => {
    for (const vitals of [{ health: 0, armor: 0 }, undefined]) {
      const actors: CombatActor[] = [
        { id: PLAYER_ID, side: 'player', vitals: PLAYER_START_VITALS },
      ];
      if (vitals !== undefined) actors.push({ id: BOT_1, side: 'bot', vitals });
      const table = createActorTable(actors);
      const bus = createRecordingBus();
      const res: ShotResolution = {
        kind: 'hit',
        shot: SHOT,
        target: BOT_1,
        zone: 'head',
        rawDamage: 112,
        ...IMPACT,
      };
      applyResolution(res, table, bus);
      expect(types(bus.emitted)).toEqual(['ShotFired', 'ShotImpact']);
      expect(table.writes).toEqual([]);
    }
  });
});

describe('BR-C-09: shots in one tick resolve and apply one at a time', () => {
  it('the second shot at a target killed by the first is blocked, with no second kill', () => {
    const physics = createFakePhysics({
      actors: [fakeActorAt(PLAYER_ID, 'player', 0, 0), fakeActorAt(BOT_1, 'bot', 0, -10)],
    });
    const { table, bus } = setup();
    const head = { ...SHOT };
    for (let i = 0; i < 2; i++) applyResolution(resolveShot(head, physics, table), table, bus);
    expect(types(bus.emitted)).toEqual([
      'ShotFired',
      'ShotImpact',
      'HitConfirmed',
      'DamageTaken',
      'ActorKilled',
      'ShotFired',
      'ShotImpact',
    ]);
    expect(bus.emitted.filter((e) => e.type === 'ActorKilled')).toHaveLength(1);
  });

  it('S11 order: a bot killed by the player earlier in the tick deals no damage', () => {
    const physics = createFakePhysics({
      actors: [fakeActorAt(PLAYER_ID, 'player', 0, 0), fakeActorAt(BOT_1, 'bot', 0, -10)],
    });
    const { table, bus } = setup();
    applyResolution(resolveShot(SHOT, physics, table), table, bus);
    const botShot = { ...SHOT, shooter: BOT_1, origin: vec3(0, 1.6, -10), dir: vec3(0, 0, 1) };
    const res = resolveShot(botShot, physics, table);
    applyResolution(res, table, bus);
    expect(res.kind).toBe('miss');
    expect(table.vitalsOf(PLAYER_ID)).toEqual(PLAYER_START_VITALS);
  });
});
