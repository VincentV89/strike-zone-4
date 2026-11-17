// Character controller and hitbox behaviour against real Rapier (BR-WM-57 to BR-WM-63).
import { afterEach, describe, expect, it } from 'vitest';
import { MASK_SHOT_ALL, MASK_WORLD, PLAYER_ID, vec3, type ActorId } from '@sz/kernel';
import { box, ramp } from '@sz/maps';
import {
  DEFAULT_CAPSULE,
  DEFAULT_CHARACTER,
  MAX_CHARACTERS,
  createPhysicsWorld,
  type PhysicsWorld,
} from '@sz/physics';
import { floor, sceneMap, wallBox } from '../support/physics-scenes';
import { RAPIER_SKIP_REASON, rapierAvailable } from '../support/rapier-probe';

const DT = 1 / 60;
const BOT = 'bot-1' as ActorId;
let world: PhysicsWorld | undefined;

afterEach(() => {
  world?.dispose();
  world = undefined;
});

function make(...solids: Parameters<typeof sceneMap>[0]): PhysicsWorld {
  world = createPhysicsWorld(sceneMap([floor(), ...solids]));
  return world;
}

function run(w: PhysicsWorld, id: ActorId, v: { x: number; y: number; z: number }, ticks: number) {
  let last = w.move(id, v, DT);
  for (let i = 1; i < ticks; i++) last = w.move(id, v, DT);
  return last;
}

describe.skipIf(!rapierAvailable)(`character controller${RAPIER_SKIP_REASON}`, () => {
  it('BR-WM-61: sprinting into a wall for 300 ticks never passes through it', () => {
    const w = make(wallBox('wall', vec3(-5, 0, -6), vec3(5, 3, -5)));
    w.addCharacter(PLAYER_ID, DEFAULT_CHARACTER, vec3(0, 0, 0));
    let collided = false;
    for (let i = 0; i < 300; i++) {
      const r = w.move(PLAYER_ID, vec3(0, -1, -6.5), DT);
      collided ||= r.collided;
      expect(r.position.z).toBeGreaterThanOrEqual(-5 + DEFAULT_CAPSULE.radius - 0.05);
    }
    expect(collided).toBe(true);
  });

  it('BR-WM-60: grounded on the floor, not in the air', () => {
    const w = make();
    w.addCharacter(PLAYER_ID, DEFAULT_CHARACTER, vec3(0, 0, 0));
    expect(run(w, PLAYER_ID, vec3(0, -1, 0), 5).grounded).toBe(true);
    w.teleport(PLAYER_ID, vec3(0, 3, 0));
    expect(w.move(PLAYER_ID, vec3(0, 0, 0), DT).grounded).toBe(false);
  });

  it('BR-WM-60: rising into a ceiling reports hitCeiling', () => {
    const w = make(box('ceiling', 'roof', vec3(-3, 2.2, -3), vec3(3, 2.5, 3), 'concrete'));
    w.addCharacter(PLAYER_ID, DEFAULT_CHARACTER, vec3(0, 0, 0));
    const r = run(w, PLAYER_ID, vec3(0, 6, 0), 20);
    expect(r.hitCeiling).toBe(true);
    expect(r.position.y + DEFAULT_CAPSULE.standHeight).toBeLessThanOrEqual(2.2 + 0.05);
  });

  it('BR-WM-59: autostep climbs a 0.3 m step but not a 0.6 m block', () => {
    const w = make(
      box('step', 'prop', vec3(-1, 0, -3), vec3(1, 0.3, -2), 'concrete'),
      box('block', 'prop', vec3(4, 0, -3), vec3(6, 0.6, -2), 'concrete'),
    );
    w.addCharacter(PLAYER_ID, DEFAULT_CHARACTER, vec3(0, 0, 0));
    w.addCharacter(BOT, DEFAULT_CHARACTER, vec3(5, 0, 0));
    const up = run(w, PLAYER_ID, vec3(0, -1, -3), 60);
    expect(up.position.y).toBeGreaterThan(0.25);
    expect(up.position.z).toBeLessThan(-2.2);
    const blocked = run(w, BOT, vec3(0, -1, -3), 60);
    expect(blocked.position.y).toBeLessThan(0.1);
    expect(blocked.position.z).toBeGreaterThan(-2);
  });

  it('BR-WM-23: walks up a 26.6° ramp to a 6 m roof', () => {
    const w = make(
      ramp('ramp', vec3(0, 0, 0), vec3(0, 6, -12), 2.5, 'concrete'),
      box('roof', 'roof', vec3(-3, 0, -18), vec3(3, 6, -12), 'concrete'),
    );
    w.addCharacter(PLAYER_ID, DEFAULT_CHARACTER, vec3(0, 0, 2));
    const r = run(w, PLAYER_ID, vec3(0, -1, -5), 4 * 60);
    expect(r.position.y).toBeGreaterThan(5.9);
    expect(r.position.z).toBeLessThan(-12);
  });

  it('BR-WM-62: cannot stand up under a 1.5 m ceiling; can once clear of it', () => {
    const w = make(box('low', 'roof', vec3(-2, 1.5, -6), vec3(2, 2, -2), 'concrete'));
    w.addCharacter(PLAYER_ID, DEFAULT_CHARACTER, vec3(0, 0, 0));
    expect(w.setStance(PLAYER_ID, 'crouch')).toBe(true);
    const under = run(w, PLAYER_ID, vec3(0, -1, -3), 80);
    expect(under.position.z).toBeLessThan(-2.5);
    expect(w.setStance(PLAYER_ID, 'stand')).toBe(false);
    run(w, PLAYER_ID, vec3(0, -1, 4), 120);
    expect(w.setStance(PLAYER_ID, 'stand')).toBe(true);
    expect(w.setStance(PLAYER_ID, 'stand')).toBe(true);
  });

  it('a standing capsule cannot enter a 1.5 m gap; a crouched one can', () => {
    const w = make(box('low', 'roof', vec3(-2, 1.5, -6), vec3(2, 2, -2), 'concrete'));
    w.addCharacter(PLAYER_ID, DEFAULT_CHARACTER, vec3(0, 0, 0));
    expect(run(w, PLAYER_ID, vec3(0, -1, -3), 80).position.z).toBeGreaterThan(-2);
  });

  it('BR-WM-53: characters do not block each other', () => {
    const w = make();
    w.addCharacter(PLAYER_ID, DEFAULT_CHARACTER, vec3(0, 0, 0));
    w.addCharacter(BOT, DEFAULT_CHARACTER, vec3(0, 0, -2));
    expect(run(w, PLAYER_ID, vec3(0, -1, -5), 60).position.z).toBeLessThan(-3);
  });

  it('teleport places the feet without collision resolution', () => {
    const w = make();
    w.addCharacter(PLAYER_ID, DEFAULT_CHARACTER, vec3(0, 0, 0));
    w.teleport(PLAYER_ID, vec3(10, 0, 10));
    expect(w.positionOf(PLAYER_ID)).toEqual(vec3(10, 0, 10));
  });

  it('addCharacter rejects duplicates, invalid specs and more than 21 characters', () => {
    const w = make();
    expect(w.addCharacter(PLAYER_ID, DEFAULT_CHARACTER, vec3(0, 0, 0))).toBe(true);
    expect(w.addCharacter(PLAYER_ID, DEFAULT_CHARACTER, vec3(0, 0, 0))).toBe(false);
    expect(w.addCharacter(BOT, { ...DEFAULT_CHARACTER, radius: Number.NaN }, vec3(0, 0, 0))).toBe(
      false,
    );
    expect(w.addCharacter(BOT, DEFAULT_CHARACTER, vec3(Number.NaN, 0, 0))).toBe(false);
    for (let i = 1; i <= 20; i++) {
      expect(w.addCharacter(`bot-${String(i)}` as ActorId, DEFAULT_CHARACTER, vec3(i, 0, 0))).toBe(
        true,
      );
    }
    expect(w.stats().characters).toBe(MAX_CHARACTERS);
    expect(w.addCharacter('bot-21' as ActorId, DEFAULT_CHARACTER, vec3(0, 0, 5))).toBe(false);
  });
});

describe.skipIf(!rapierAvailable)(`hitboxes${RAPIER_SKIP_REASON}`, () => {
  function botAt(x: number) {
    const w = make(wallBox('backstop', vec3(-1, 0, -21), vec3(1, 3, -20)));
    w.addCharacter(BOT, DEFAULT_CHARACTER, vec3(x, 0, -10));
    w.syncHitboxes(BOT, vec3(x, 0, -10), 0, 'stand');
    w.step(DT);
    return w;
  }
  const shoot = (w: PhysicsWorld, y: number) =>
    w.raycast(vec3(0, y, 0), vec3(0, 0, -1), 100, MASK_SHOT_ALL);

  it('BR-WM-58: body and head zones at standing heights', () => {
    const w = botAt(0);
    expect(shoot(w, 1.0)).toMatchObject({ kind: 'actor', actorId: BOT, zone: 'body' });
    expect(shoot(w, 1.75)).toMatchObject({ kind: 'actor', actorId: BOT, zone: 'head' });
    expect(shoot(w, 2.0)).toMatchObject({ kind: 'world' });
  });

  it('BR-WM-58: crouched hitboxes are lower, and the standing pair is disabled', () => {
    const w = botAt(0);
    w.syncHitboxes(BOT, vec3(0, 0, -10), 0, 'crouch');
    w.step(DT);
    expect(shoot(w, 1.1)).toMatchObject({ kind: 'actor', zone: 'head' });
    expect(shoot(w, 1.75)).toMatchObject({ kind: 'world' });
  });

  it('BR-WM-63: a hitbox moved by syncHitboxes is hit after step, not before', () => {
    const w = botAt(5);
    expect(shoot(w, 1)).toMatchObject({ kind: 'world' });
    w.syncHitboxes(BOT, vec3(0, 0, -10), 0, 'stand');
    expect(shoot(w, 1)).toMatchObject({ kind: 'world' });
    w.step(DT);
    expect(shoot(w, 1)).toMatchObject({ kind: 'actor', actorId: BOT });
  });

  it('BR-WM-58: hitboxes follow yaw', () => {
    const w = make();
    const wide = {
      ...DEFAULT_CHARACTER,
      hitboxes: [
        {
          zone: 'body' as const,
          stance: 'stand' as const,
          offset: vec3(0, 1, 0),
          half: vec3(2, 0.5, 0.1),
        },
      ],
    };
    w.addCharacter(BOT, wide, vec3(0, 0, -10));
    w.syncHitboxes(BOT, vec3(0, 0, -10), 0, 'stand');
    w.step(DT);
    const side = () => w.raycast(vec3(1.5, 1, 0), vec3(0, 0, -1), 100, MASK_SHOT_ALL);
    expect(side()).toMatchObject({ kind: 'actor' });
    w.syncHitboxes(BOT, vec3(0, 0, -10), Math.PI / 2, 'stand');
    w.step(DT);
    expect(side()).toBeNull();
  });

  it('BR-WM-57: disabled hitboxes let shots pass to the wall behind; stays dead through sync', () => {
    const w = botAt(0);
    w.setHitboxesEnabled(BOT, false);
    w.syncHitboxes(BOT, vec3(0, 0, -10), 0, 'stand');
    w.step(DT);
    expect(shoot(w, 1)).toMatchObject({ kind: 'world' });
    expect(shoot(w, 1)?.distance).toBeCloseTo(20, 4);
    w.setHitboxesEnabled(BOT, true);
    w.step(DT);
    expect(shoot(w, 1)).toMatchObject({ kind: 'actor' });
    w.setHitboxesEnabled('bot-9' as ActorId, false);
  });

  it('BR-WM-56: exclude skips every collider of that actor', () => {
    const w = botAt(0);
    const hit = w.raycast(vec3(0, 1, 0), vec3(0, 0, -1), 100, MASK_SHOT_ALL, BOT);
    expect(hit).toMatchObject({ kind: 'world' });
  });

  it('nav-style WORLD queries never see hitboxes', () => {
    const w = botAt(0);
    expect(w.raycast(vec3(0, 1, 0), vec3(0, 0, -1), 100, MASK_WORLD)).toMatchObject({
      kind: 'world',
    });
    expect(w.lineOfSight(vec3(0, 1, 0), vec3(0, 1, -15))).toBe(true);
  });
});
