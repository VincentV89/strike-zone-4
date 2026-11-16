// Lifecycle, guards at the WASM boundary and fault containment against real Rapier
// (BR-WM-64, BR-WM-65, SD-WM-1, SD-WM-3, SD-WM-4, SD-WM-5, NFR-WM-R4).
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MASK_SHOT_ALL,
  MASK_WORLD,
  PLAYER_ID,
  ZERO,
  botIds,
  vec3,
  type ActorId,
  type CollisionMask,
} from '@sz/kernel';
import { desertCompound } from '@sz/maps';
import {
  DEFAULT_CHARACTER,
  createPhysicsHost,
  createPhysicsWorld,
  type PhysicsWorld,
} from '@sz/physics';
import { createWorldFrom } from '@sz/physics/world';
import { floor, sceneMap, wallBox } from '../support/physics-scenes';
import { RAPIER_SKIP_REASON, rapierAvailable } from '../support/rapier-probe';

const DT = 1 / 60;
const BOT = 'bot-1' as ActorId;
const NAN = Number.NaN;
const created: PhysicsWorld[] = [];

afterEach(() => {
  for (const w of created.splice(0)) w.dispose();
});

function scene(): PhysicsWorld {
  const w = createPhysicsWorld(
    sceneMap([floor(), wallBox('w', vec3(-1, 0, -21), vec3(1, 3, -20))]),
  );
  created.push(w);
  w.addCharacter(BOT, DEFAULT_CHARACTER, vec3(0, 0, -10));
  w.syncHitboxes(BOT, vec3(0, 0, -10), 0, 'stand');
  w.step(DT);
  return w;
}

describe.skipIf(!rapierAvailable)(`physics guards${RAPIER_SKIP_REASON}`, () => {
  const bad = [vec3(NAN, 1, 0), vec3(Infinity, 1, 0), vec3(0, 1e300, 0), vec3(0, -Infinity, 0)];

  it('raycast returns null for hostile origin, direction, distance and mask', () => {
    const w = scene();
    const d = vec3(0, 0, -1);
    for (const o of bad) expect(w.raycast(o, d, 100, MASK_SHOT_ALL)).toBeNull();
    for (const dir of [ZERO, vec3(NAN, 0, -1), vec3(1e-12, 0, 0)]) {
      expect(w.raycast(vec3(0, 1, 0), dir, 100, MASK_SHOT_ALL)).toBeNull();
    }
    for (const dist of [0, -1, NAN, -Infinity]) {
      expect(w.raycast(vec3(0, 1, 0), d, dist, MASK_SHOT_ALL)).toBeNull();
    }
    expect(w.raycast(vec3(0, 1, 0), d, 100, 0 as CollisionMask)).toBeNull();
    expect(w.raycast(vec3(0, 1, 0), d, 100, 1.5 as CollisionMask)).toBeNull();
    // Non-finite distance is rejected; a huge finite one is clamped to 512 m.
    expect(w.raycast(vec3(0, 1, 0), d, Infinity, MASK_WORLD)).toBeNull();
    expect(w.raycast(vec3(0, 1, 0), d, 1e6, MASK_WORLD)).toMatchObject({ kind: 'world' });
    expect(w.raycast(vec3(0, 1, 600), d, 1e6, MASK_WORLD)).toBeNull();
    expect(w.raycast(vec3(0, 1, 400), d, 1e6, MASK_WORLD)).toMatchObject({ kind: 'world' });
  });

  it('lineOfSight is false for hostile points', () => {
    const w = scene();
    for (const p of bad) {
      expect(w.lineOfSight(p, vec3(0, 1, 0))).toBe(false);
      expect(w.lineOfSight(vec3(0, 1, 0), p)).toBe(false);
    }
  });

  it('move, teleport, sync and overlap ignore hostile numbers', () => {
    const w = scene();
    const before = w.positionOf(BOT)!;
    expect(w.move(BOT, vec3(1, 0, 0), 0).position).toEqual(before);
    expect(w.move(BOT, vec3(1, 0, 0), 1).position).toEqual(before);
    expect(w.move(BOT, vec3(1, 0, 0), NAN).position).toEqual(before);
    const r = w.move(BOT, vec3(NAN, -1, Infinity), DT);
    expect(Number.isFinite(r.position.x) && Number.isFinite(r.position.z)).toBe(true);
    expect(Math.abs(r.position.x - before.x)).toBeLessThan(0.01);
    for (const p of bad) {
      w.teleport(BOT, p);
      expect(Number.isFinite(w.positionOf(BOT)!.x)).toBe(true);
      expect(w.overlapsCapsule(p, 0.35, 1.8)).toBe(false);
    }
    expect(w.overlapsCapsule(vec3(0, 0, -10), NAN, 1.8)).toBe(false);
    expect(w.move('bot-7' as ActorId, vec3(1, 0, 0), DT).position).toEqual(ZERO);
    expect(w.setStance('bot-7' as ActorId, 'crouch')).toBe(false);
  });

  it('SEC-WM-03 regression: a NaN sync does not make the bot unhittable', () => {
    const w = scene();
    w.syncHitboxes(BOT, vec3(NAN, 0, -10), NAN, 'stand');
    w.step(DT);
    expect(w.raycast(vec3(0, 1, 0), vec3(0, 0, -1), 100, MASK_SHOT_ALL)).toMatchObject({
      kind: 'actor',
      actorId: BOT,
    });
    w.syncHitboxes(BOT, vec3(0, 0, -10), NAN, 'stand');
    w.step(DT);
    expect(w.raycast(vec3(0, 1, 0), vec3(0, 0, -1), 100, MASK_SHOT_ALL)).toMatchObject({
      kind: 'actor',
    });
  });

  it('step ignores invalid dt', () => {
    const w = scene();
    for (const dt of [0, -1, NAN, 1]) w.step(dt);
    expect(w.stats().characters).toBe(1);
  });
});

describe.skipIf(!rapierAvailable)(`lifecycle${RAPIER_SKIP_REASON}`, () => {
  it('BR-WM-64: every method is safe after dispose, and dispose is idempotent', () => {
    const w = scene();
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    w.dispose();
    w.dispose();
    expect(w.disposed).toBe(true);
    expect(w.raycast(vec3(0, 1, 0), vec3(0, 0, -1), 100, MASK_SHOT_ALL)).toBeNull();
    expect(w.lineOfSight(vec3(0, 1, 0), vec3(0, 1, -5))).toBe(false);
    expect(w.overlapsCapsule(vec3(0, 0, 0), 0.35, 1.8)).toBe(false);
    expect(w.move(BOT, vec3(1, 0, 0), DT).position).toEqual(ZERO);
    expect(w.setStance(BOT, 'crouch')).toBe(false);
    expect(w.addCharacter(PLAYER_ID, DEFAULT_CHARACTER, ZERO)).toBe(false);
    expect(w.positionOf(BOT)).toBeUndefined();
    w.teleport(BOT, ZERO);
    w.syncHitboxes(BOT, ZERO, 0, 'stand');
    w.setHitboxesEnabled(BOT, false);
    w.removeCharacter(BOT);
    w.removeAllCharacters();
    w.step(DT);
    expect(w.stats()).toEqual({ bodies: 0, colliders: 0, characters: 0 });
    expect(report).not.toHaveBeenCalled();
    report.mockRestore();
  });

  it('BR-WM-65 / NFR-WM-R4: 10 round resets leave the body and collider counts unchanged', () => {
    const w = createPhysicsWorld(desertCompound);
    created.push(w);
    const spawnRound = () => {
      w.removeAllCharacters();
      w.addCharacter(PLAYER_ID, DEFAULT_CHARACTER, desertCompound.playerSpawns[0]!.pos);
      botIds(20).forEach((id, i) => {
        w.addCharacter(id, DEFAULT_CHARACTER, desertCompound.botSpawns[i]!.pos);
      });
      w.step(DT);
    };
    const empty = w.stats();
    spawnRound();
    const first = w.stats();
    expect(first.characters).toBe(21);
    expect(first.bodies).toBe(empty.bodies + 21);
    expect(first.colliders).toBe(empty.colliders + 21 * 5);
    for (let i = 0; i < 10; i++) spawnRound();
    expect(w.stats()).toEqual(first);
    w.removeAllCharacters();
    expect(w.stats()).toEqual(empty);
  });

  it('SD-WM-5: the host keeps one live world and its query follows the current map', () => {
    const host = createPhysicsHost();
    expect(host.liveWorlds()).toBe(0);
    expect(host.query.lineOfSight(vec3(0, 1, 0), vec3(0, 1, -5))).toBe(false);
    expect(host.query.raycast(vec3(0, 1, 0), vec3(0, 0, -1), 10, MASK_WORLD)).toBeNull();
    const open = sceneMap([floor()]);
    const walled = sceneMap([floor(), wallBox('w', vec3(-1, 0, -3), vec3(1, 3, -2))]);
    const first = host.load(open);
    expect(host.query.lineOfSight(vec3(0, 1, 0), vec3(0, 1, -5))).toBe(true);
    const second = host.load(walled);
    expect(first.disposed).toBe(true);
    expect(host.current()).toBe(second);
    expect(host.liveWorlds()).toBe(1);
    expect(host.query.lineOfSight(vec3(0, 1, 0), vec3(0, 1, -5))).toBe(false);
    expect(host.query.raycast(vec3(0, 1, 0), vec3(0, 0, -1), 10, MASK_WORLD)).toMatchObject({
      kind: 'world',
    });
    host.dispose();
    expect(host.liveWorlds()).toBe(0);
  });
});

describe.skipIf(!rapierAvailable)(`fault containment${RAPIER_SKIP_REASON}`, () => {
  it('SD-WM-3: a throwing engine call returns the safe result and is reported once', async () => {
    const R = await import('@dimforge/rapier3d-compat');
    class ThrowingWorld extends R.World {
      override castRayAndGetNormal(): never {
        throw new Error('engine fault at 1,2,3 '.repeat(30));
      }
      override castRay(): never {
        throw new Error('sight fault');
      }
    }
    const stub = { ...R, World: ThrowingWorld } as unknown as typeof R;
    const lines: string[] = [];
    const w = createWorldFrom(stub, sceneMap([floor()]), (l) => lines.push(l));
    created.push(w);
    for (let i = 0; i < 100; i++) {
      expect(w.raycast(vec3(0, 1, 0), vec3(0, -1, 0), 10, MASK_WORLD)).toBeNull();
      expect(w.lineOfSight(vec3(0, 1, 0), vec3(0, 1, -5))).toBe(false);
    }
    expect(lines).toHaveLength(2);
    expect(lines[0]!.startsWith('physics: raycast failed: ')).toBe(true);
    expect(lines[0]!.length).toBeLessThanOrEqual('physics: raycast failed: '.length + 200);
    expect(lines[1]).toBe('physics: lineOfSight failed: sight fault');
  });
});
