import { describe, expect, it } from 'vitest';
import { Layer, PLAYER_ID, ZERO, length, mask, vec3, type ActorId, type Vec3 } from '@sz/kernel';
import { BOT_START_VITALS, PLAYER_START_VITALS, resolveShot, type CombatActor } from '@sz/combat';
import type { ShotRequest } from '@sz/weapons';
import { createFakePhysics } from '../support/fakes';
import { box, createActorTable, fakeActorAt, fixedQuery, spyQuery } from '../support/combat-scene';

const BOT_1 = 'bot-1' as ActorId;
const BOT_2 = 'bot-2' as ActorId;
const EYE = vec3(0, 1.6, 0);
const BOT_EYE = vec3(0, 1.6, -10);

const players: CombatActor[] = [
  { id: PLAYER_ID, side: 'player', vitals: PLAYER_START_VITALS },
  { id: BOT_1, side: 'bot', vitals: BOT_START_VITALS },
  { id: BOT_2, side: 'bot', vitals: BOT_START_VITALS },
];

function shot(over: Partial<ShotRequest> = {}): ShotRequest {
  return {
    shooter: PLAYER_ID,
    weapon: 'rifle',
    origin: EYE,
    dir: vec3(0, 0, -1),
    rangeM: 200,
    spread: 0,
    ...over,
  };
}

/** Player at the origin, bot-1 10 m ahead, bot-2 between them at 5 m (moved per test). */
function scene(opts: { wall?: boolean; bot2At?: number } = {}) {
  const actors = [fakeActorAt(PLAYER_ID, 'player', 0, 0), fakeActorAt(BOT_1, 'bot', 0, -10)];
  if (opts.bot2At !== undefined) actors.push(fakeActorAt(BOT_2, 'bot', 0, opts.bot2At));
  const boxes = opts.wall === true ? [box(vec3(-2, 0, -5.2), vec3(2, 3, -4.8))] : [];
  return spyQuery(createFakePhysics({ boxes, actors }));
}

describe('story-hitscan-damage: occlusion and single damage', () => {
  it('S1: a wall in front of a bot stops the player shot (req-hitscan-occlusion AC1)', () => {
    const q = scene({ wall: true });
    const res = resolveShot(shot(), q, createActorTable(players));
    expect(res.kind).toBe('world');
    expect(q.calls).toHaveLength(1);
  });

  it('S2: a wall in front of the player stops the bot shot (AC2)', () => {
    const q = scene({ wall: true });
    const res = resolveShot(
      shot({ shooter: BOT_1, origin: BOT_EYE, dir: vec3(0, 0, 1) }),
      q,
      createActorTable(players),
    );
    expect(res.kind).toBe('world');
  });

  it('a clear line to the bot body is a body hit with base damage (req-headshot AC2)', () => {
    const res = resolveShot(shot({ origin: vec3(0, 1, 0) }), scene(), createActorTable(players));
    expect(res).toMatchObject({ kind: 'hit', target: BOT_1, zone: 'body', rawDamage: 28 });
  });

  it('S3: a ray through head and body gets only the nearer collider (req-single-damage AC1)', () => {
    // Straight down from above: the ray crosses the head box, then the body box.
    const q = scene();
    const res = resolveShot(
      shot({ origin: vec3(0, 3, -10), dir: vec3(0, -1, 0) }),
      q,
      createActorTable(players),
    );
    expect(res).toMatchObject({ kind: 'hit', zone: 'head', target: BOT_1 });
    expect(q.calls).toHaveLength(1);
  });

  it('S4: a rifle headshot is 28 × 4 = 112 (req-headshot AC1)', () => {
    const res = resolveShot(shot(), scene(), createActorTable(players));
    expect(res).toMatchObject({ kind: 'hit', zone: 'head', rawDamage: 112 });
  });

  it('sniper body 90 and head 360', () => {
    const body = resolveShot(
      shot({ weapon: 'sniper', origin: vec3(0, 1, 0) }),
      scene(),
      createActorTable(players),
    );
    const head = resolveShot(shot({ weapon: 'sniper' }), scene(), createActorTable(players));
    expect([body.kind === 'hit' && body.rawDamage, head.kind === 'hit' && head.rawDamage]).toEqual([
      90, 360,
    ]);
  });

  it('S5: a dead bot whose collider is still live blocks with no damage (AC2)', () => {
    const table = createActorTable([
      players[0]!,
      { id: BOT_1, side: 'bot', vitals: { health: 0, armor: 0 } },
    ]);
    const res = resolveShot(shot(), scene(), table);
    expect(res).toMatchObject({ kind: 'blocked', target: BOT_1 });
  });

  it('S6: a bot between a bot and the player blocks the shot (FD-WC-A2, no friendly fire)', () => {
    const q = scene({ bot2At: -5 });
    const res = resolveShot(
      shot({ shooter: BOT_1, origin: BOT_EYE, dir: vec3(0, 0, 1) }),
      q,
      createActorTable(players),
    );
    expect(res).toMatchObject({ kind: 'blocked', target: BOT_2 });
  });

  it('a bot with a clear line hits the player', () => {
    const res = resolveShot(
      shot({ shooter: BOT_1, origin: BOT_EYE, dir: vec3(0, 0, 1) }),
      scene(),
      createActorTable(players),
    );
    expect(res).toMatchObject({ kind: 'hit', target: PLAYER_ID, zone: 'head' });
  });

  it('a miss when nothing is in range', () => {
    const res = resolveShot(shot({ dir: vec3(0, 0, 1) }), scene(), createActorTable(players));
    expect(res.kind).toBe('miss');
    expect(res.kind === 'miss' && res.rejected).toBeUndefined();
  });

  it('an actor id unknown to the lookup blocks', () => {
    const q = fixedQuery({
      kind: 'actor',
      point: vec3(0, 1, -3),
      normal: vec3(0, 0, 1),
      distance: 3,
      actorId: 'bot-9' as ActorId,
      zone: 'body',
    });
    expect(resolveShot(shot(), q, createActorTable(players))).toMatchObject({ kind: 'blocked' });
  });

  it('an unexpected zone from the adapter counts as body', () => {
    const q = fixedQuery({
      kind: 'actor',
      point: vec3(0, 1, -3),
      normal: vec3(0, 0, 1),
      distance: 3,
      actorId: BOT_1,
      zone: 'leg' as 'body',
    });
    expect(resolveShot(shot(), q, createActorTable(players))).toMatchObject({
      zone: 'body',
      rawDamage: 28,
    });
  });
});

describe('authoritative checks (BR-C-01, BR-C-02, SEC-WC-03, SEC-WC-04, SEC-WC-10)', () => {
  it('BR-C-02: masks come from the shooter record and the shooter id is excluded', () => {
    const q = scene();
    const table = createActorTable(players);
    resolveShot(shot(), q, table);
    resolveShot(shot({ shooter: BOT_1, origin: BOT_EYE, dir: vec3(0, 0, 1) }), q, table);
    expect(q.calls.map((c) => [c.mask, c.exclude])).toEqual([
      [mask(Layer.WORLD, Layer.BOT_HEAD, Layer.BOT_BODY), PLAYER_ID],
      [
        mask(Layer.WORLD, Layer.PLAYER_HEAD, Layer.PLAYER_BODY, Layer.BOT_HEAD, Layer.BOT_BODY),
        BOT_1,
      ],
    ]);
  });

  it('BR-W-68: the player cannot hit themselves', () => {
    const q = scene();
    const res = resolveShot(
      shot({ origin: vec3(0, 1, 1), dir: vec3(0, 0, -1) }),
      q,
      createActorTable(players),
    );
    expect(res).toMatchObject({ kind: 'hit', target: BOT_1 });
  });

  it.each([
    [Infinity, 200],
    [1e9, 200],
    [NaN, 200],
    [-1, 200],
    [0, 200],
    [50, 50],
  ])('SEC-WC-04: requested range %s casts at %s m', (rangeM, expected) => {
    const q = scene();
    resolveShot(shot({ rangeM }), q, createActorTable(players));
    expect(q.calls[0]!.maxDist).toBe(expected);
  });

  it('a short range ends the ray before the target', () => {
    const res = resolveShot(shot({ rangeM: 5 }), scene(), createActorTable(players));
    expect(res.kind).toBe('miss');
  });

  it('the direction is re-normalised before the cast', () => {
    const q = scene();
    const res = resolveShot(shot({ dir: vec3(0, 0, -7) }), q, createActorTable(players));
    expect(length(q.calls[0]!.dir)).toBeCloseTo(1, 12);
    expect(res.shot.dir).toEqual(vec3(0, 0, -1));
  });

  it.each([
    ['unknown weapon __proto__', { weapon: '__proto__' as 'rifle' }],
    ['unknown weapon constructor', { weapon: 'constructor' as 'rifle' }],
    ['origin NaN', { origin: vec3(NaN, 0, 0) }],
    ['origin missing', { origin: undefined as unknown as Vec3 }],
    ['dir zero', { dir: ZERO }],
    ['dir Infinity', { dir: vec3(Infinity, 0, 0) }],
    ['dir null', { dir: null as unknown as Vec3 }],
  ])('%s: rejected miss with zero raycasts', (_name, over) => {
    const q = scene();
    const res = resolveShot(shot(over), q, createActorTable(players));
    expect(res).toMatchObject({ kind: 'miss', rejected: true });
    expect(q.calls).toHaveLength(0);
  });

  it('SEC-WC-10: a dead or unknown shooter resolves to miss with zero raycasts', () => {
    const q = scene();
    const dead = createActorTable([
      { id: BOT_1, side: 'bot', vitals: { health: 0, armor: 0 } },
      players[0]!,
    ]);
    const deadRes = resolveShot(
      shot({ shooter: BOT_1, origin: BOT_EYE, dir: vec3(0, 0, 1) }),
      q,
      dead,
    );
    const unknown = resolveShot(
      shot({ shooter: 'bot-7' as ActorId }),
      q,
      createActorTable(players),
    );
    expect(deadRes.kind).toBe('miss');
    expect(unknown.kind).toBe('miss');
    expect(deadRes.kind === 'miss' && deadRes.rejected).toBeUndefined();
    expect(q.calls).toHaveLength(0);
  });
});
