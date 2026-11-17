// Shared PhysicsQuery contract (BR-K-40 to BR-K-43). The kernel runs it against the fake;
// world-maps runs the same suite against the Rapier adapter.
import { describe, expect, it } from 'vitest';
import {
  Layer,
  MASK_SHOT_ALL,
  MASK_WORLD,
  length,
  mask,
  vec3,
  type ActorId,
  type PhysicsQuery,
} from '@sz/kernel';

/**
 * The factory must build this scene (units in metres):
 * - a WORLD wall: min (-1, 0, -6), max (1, 3, -5), i.e. 5 m in front of the origin along -Z;
 * - a bot 'bot-1' standing at x = 5: body min (4.7, 0, -0.3) max (5.3, 1.5, 0.3),
 *   head min (4.8, 1.5, -0.2) max (5.2, 1.9, 0.2);
 * - the player 'player' at x = -5: body min (-5.3, 0, -0.3) max (-4.7, 1.5, 0.3),
 *   head min (-5.2, 1.5, -0.2) max (-4.8, 1.9, 0.2).
 */
export type ContractSceneFactory = () => PhysicsQuery;

const BOT = 'bot-1' as ActorId;
const PLAYER = 'player' as ActorId;
const ORIGIN = vec3(0, 1, 0);
const NAN = Number.NaN;

export function describePhysicsQueryContract(name: string, factory: ContractSceneFactory): void {
  describe(`PhysicsQuery contract: ${name}`, () => {
    it('BR-K-41: returns null for invalid direction, origin or distance', () => {
      const q = factory();
      expect(q.raycast(ORIGIN, vec3(0, 0, 0), 100, MASK_SHOT_ALL)).toBeNull();
      expect(q.raycast(ORIGIN, vec3(NAN, 0, -1), 100, MASK_SHOT_ALL)).toBeNull();
      expect(q.raycast(vec3(Infinity, 1, 0), vec3(0, 0, -1), 100, MASK_SHOT_ALL)).toBeNull();
      expect(q.raycast(ORIGIN, vec3(0, 0, -1), 0, MASK_SHOT_ALL)).toBeNull();
      expect(q.raycast(ORIGIN, vec3(0, 0, -1), -5, MASK_SHOT_ALL)).toBeNull();
      expect(q.raycast(ORIGIN, vec3(0, 0, -1), NAN, MASK_SHOT_ALL)).toBeNull();
    });

    it('BR-K-41: normalises dir, so a scaled direction hits at the same distance', () => {
      const q = factory();
      const unit = q.raycast(ORIGIN, vec3(0, 0, -1), 100, MASK_WORLD);
      const scaled = q.raycast(ORIGIN, vec3(0, 0, -7), 100, MASK_WORLD);
      expect(unit?.distance).toBeCloseTo(5, 6);
      expect(scaled?.distance).toBeCloseTo(5, 6);
    });

    it('BR-K-42: hits the wall with a unit normal facing the ray and distance <= maxDist', () => {
      const hit = factory().raycast(ORIGIN, vec3(0, 0, -1), 100, MASK_WORLD);
      expect(hit?.kind).toBe('world');
      expect(hit?.distance).toBeLessThanOrEqual(100);
      expect(hit?.point.z).toBeCloseTo(-5, 6);
      expect(hit && length(hit.normal)).toBeCloseTo(1, 9);
      expect(hit?.normal.z).toBeCloseTo(1, 9);
    });

    it('BR-K-42: misses beyond maxDist', () => {
      expect(factory().raycast(ORIGIN, vec3(0, 0, -1), 4.9, MASK_WORLD)).toBeNull();
    });

    it('BR-K-42: reports actor id and hit zone, head versus body', () => {
      const q = factory();
      const body = q.raycast(vec3(0, 1, 0), vec3(1, 0, 0), 100, MASK_SHOT_ALL);
      const head = q.raycast(vec3(0, 1.7, 0), vec3(1, 0, 0), 100, MASK_SHOT_ALL);
      expect(body).toMatchObject({ kind: 'actor', actorId: BOT, zone: 'body' });
      expect(head).toMatchObject({ kind: 'actor', actorId: BOT, zone: 'head' });
      expect(body?.distance).toBeCloseTo(4.7, 6);
    });

    it('BR-K-42: ignores colliders whose layer is not in the mask', () => {
      const q = factory();
      expect(q.raycast(vec3(0, 1, 0), vec3(1, 0, 0), 100, MASK_WORLD)).toBeNull();
      const headOnly = q.raycast(vec3(0, 1, 0), vec3(1, 0, 0), 100, mask(Layer.BOT_HEAD));
      expect(headOnly).toBeNull();
    });

    it('BR-K-42: ignores every collider owned by exclude', () => {
      const q = factory();
      const fromPlayer = vec3(-5, 1.7, 0);
      const hit = q.raycast(fromPlayer, vec3(1, 0, 0), 100, MASK_SHOT_ALL, PLAYER);
      expect(hit).toMatchObject({ kind: 'actor', actorId: BOT, zone: 'head' });
      expect(q.raycast(vec3(0, 1, 0), vec3(1, 0, 0), 100, MASK_SHOT_ALL, BOT)).toBeNull();
    });

    it('BR-K-42: returns the nearest of several candidates', () => {
      const q = factory();
      const hit = q.raycast(vec3(10, 1, 0), vec3(-1, 0, 0), 100, MASK_SHOT_ALL);
      expect(hit).toMatchObject({ kind: 'actor', actorId: BOT });
      expect(hit?.distance).toBeCloseTo(4.7, 6);
    });

    it('BR-K-43: world geometry blocks sight; actors do not', () => {
      const q = factory();
      expect(q.lineOfSight(vec3(0, 1, 0), vec3(0, 1, -10))).toBe(false);
      expect(q.lineOfSight(vec3(-5, 1.7, 0), vec3(10, 1.7, 0))).toBe(true);
      expect(q.lineOfSight(vec3(0, 1, 0), vec3(0, 1, -4))).toBe(true);
    });

    it('BR-K-43: identical points see each other; invalid points never do', () => {
      const q = factory();
      expect(q.lineOfSight(ORIGIN, ORIGIN)).toBe(true);
      expect(q.lineOfSight(vec3(NAN, 0, 0), ORIGIN)).toBe(false);
    });
  });
}
