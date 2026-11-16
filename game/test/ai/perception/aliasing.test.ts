// No-cheat data flow (SEC-AI-02, SD-AI-3): percepts are copies, frozen, cached, and reset clears all.
import { describe, expect, it } from 'vitest';
import {
  EMPTY_PERCEPTS,
  PERCEPTION_RULES,
  createPerceptionSystem,
  createTargetSample,
} from '@sz/ai/perception';
import { PLAYER_ID, vec3, type ActorId } from '@sz/kernel';
import { createFakePhysics } from '../../support/fakes';

const B1 = 'bot-1' as ActorId;
const VISION = {
  rangeM: 45,
  fovRad: PERCEPTION_RULES.fovRad,
  vFovHalfRad: PERCEPTION_RULES.vFovHalfRad,
};
const open = createFakePhysics();
const sense = (
  p: ReturnType<typeof createPerceptionSystem>,
  feet: { x: number; y: number; z: number },
  now: number,
) =>
  p.sense(
    { id: B1, eye: vec3(0, 1.62, 0), yaw: 0, alive: true },
    createTargetSample(PLAYER_ID, feet, 1.62, true),
    open,
    VISION,
    now,
  );

describe('aliasing (SEC-AI-02)', () => {
  it('mutating the target pose after sense does not change the percepts', () => {
    const p = createPerceptionSystem();
    const feet = { x: 0, y: 0, z: -10 };
    sense(p, feet, 1);
    feet.z = -30;
    feet.x = 99;
    const v = p.perceptsFor(B1, 1);
    expect(v.visibleTarget?.feet).toEqual(vec3(0, 0, -10));
    expect(v.lastKnown?.pos).toEqual(vec3(0, 0, -10));
  });

  it('mutating a noise payload or a damage vector after the call has no effect', () => {
    const p = createPerceptionSystem();
    p.updatePositions([{ id: B1, feet: vec3(0, 0, 0), alive: true }]);
    const pos = { x: 1, y: 0, z: 1 };
    p.emitNoise({ source: PLAYER_ID, pos, radius: 20, kind: 'gunfire' });
    pos.x = 50;
    p.processNoises(1);
    pos.x = 70;
    const dir = { x: 1, y: 0, z: 0 };
    p.recordDamage(B1, dir, 1);
    dir.x = -1;
    const v = p.perceptsFor(B1, 1);
    expect(v.heardNoise?.pos).toEqual(vec3(1, 0, 1));
    expect(v.recentDamageFrom?.dir).toEqual(vec3(1, 0, 0));
  });

  it('percepts are deep-frozen', () => {
    const p = createPerceptionSystem();
    sense(p, vec3(0, 0, -10), 1);
    p.recordDamage(B1, vec3(1, 0, 0), 1);
    const v = p.perceptsFor(B1, 1);
    expect(Object.isFrozen(v)).toBe(true);
    expect(Object.isFrozen(v.visibleTarget)).toBe(true);
    expect(Object.isFrozen(v.visibleTarget?.pos)).toBe(true);
    expect(Object.isFrozen(v.lastKnown?.pos)).toBe(true);
    expect(Object.isFrozen(v.recentDamageFrom?.dir)).toBe(true);
    expect(Object.isFrozen(EMPTY_PERCEPTS)).toBe(true);
  });

  it('returns the cached object while nothing changed, and a new one after a change', () => {
    const p = createPerceptionSystem();
    sense(p, vec3(0, 0, -10), 1);
    const a = p.perceptsFor(B1, 1);
    expect(p.perceptsFor(B1, 1.5)).toBe(a);
    sense(p, vec3(0, 0, -11), 2);
    const b = p.perceptsFor(B1, 2);
    expect(b).not.toBe(a);
    expect(a.visibleTarget?.feet.z).toBe(-10);
  });

  it('a TTL boundary changes the result without a write', () => {
    const p = createPerceptionSystem();
    p.updatePositions([{ id: B1, feet: vec3(0, 0, 0), alive: true }]);
    p.recordDamage(B1, vec3(1, 0, 0), 1);
    expect(p.perceptsFor(B1, 2).recentDamageFrom).toBeDefined();
    expect(p.perceptsFor(B1, 5)).toBe(EMPTY_PERCEPTS);
  });

  it('unknown ids and a non-finite time give the empty percepts', () => {
    const p = createPerceptionSystem();
    expect(p.perceptsFor('bot-9' as ActorId, 1)).toBe(EMPTY_PERCEPTS);
    sense(p, vec3(0, 0, -10), 1);
    expect(p.perceptsFor(B1, NaN)).toBe(EMPTY_PERCEPTS);
  });
});

describe('reset (BR-AI-20, NFR-AI-R4)', () => {
  it('10 reset cycles leave every store empty', () => {
    const p = createPerceptionSystem({ cellSize: 4 });
    for (let cycle = 0; cycle < 10; cycle++) {
      p.updatePositions([
        { id: B1, feet: vec3(0, 0, 0), alive: true },
        { id: 'bot-2' as ActorId, feet: vec3(3, 0, 0), alive: true },
      ]);
      sense(p, vec3(0, 0, -10), 1);
      p.emitNoise({ source: PLAYER_ID, pos: vec3(0, 0, 0), radius: 10, kind: 'gunfire' });
      p.noteShot(B1, 1);
      p.updatePlayerView(
        { eye: vec3(0, 1.6, 10), yaw: 0, hFovRad: 1.7, alive: true },
        [{ id: B1, chest: vec3(0, 1, 0), alive: true }],
        open,
        0,
      );
      expect(p.stats().memories).toBe(2);
      p.reset();
      expect(p.stats()).toEqual({
        memories: 0,
        queuedNoises: 0,
        shots: 0,
        views: 0,
        gridActors: 0,
      });
      expect(p.perceptsFor(B1, 1)).toBe(EMPTY_PERCEPTS);
    }
  });

  it('a bad cell size falls back to the default', () => {
    const p = createPerceptionSystem({ cellSize: -1 });
    p.updatePositions([{ id: B1, feet: vec3(0, 0, 0), alive: true }]);
    p.emitNoise({ source: PLAYER_ID, pos: vec3(5, 0, 0), radius: 6, kind: 'gunfire' });
    p.processNoises(1);
    expect(p.perceptsFor(B1, 1).heardNoise).toBeDefined();
  });

  it('skips non-finite positions in updatePositions', () => {
    const p = createPerceptionSystem();
    p.updatePositions([{ id: B1, feet: vec3(NaN, 0, 0), alive: true }]);
    expect(p.stats().gridActors).toBe(0);
  });
});
