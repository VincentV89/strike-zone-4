// Scene helpers for combat tests: fake actors, a Map-backed actor lookup and a raycast spy.
import {
  vec3,
  type ActorId,
  type CollisionMask,
  type PhysicsQuery,
  type RayHit,
  type Vec3,
} from '@sz/kernel';
import type { CombatActor, MutableActorLookup, Side, Vitals } from '@sz/combat';
import type { Aabb, FakeActor } from './fakes';

/** A standing actor at (x, z): body y 0..1.4, head y 1.4..1.8, 0.6 m wide. */
export function fakeActorAt(id: ActorId, side: Side, x: number, z: number): FakeActor {
  return {
    id,
    side,
    body: { min: vec3(x - 0.3, 0, z - 0.3), max: vec3(x + 0.3, 1.4, z + 0.3) },
    head: { min: vec3(x - 0.2, 1.4, z - 0.2), max: vec3(x + 0.2, 1.8, z + 0.2) },
  };
}

export function box(min: Vec3, max: Vec3): Aabb {
  return { min, max };
}

export interface ActorTable extends MutableActorLookup {
  readonly writes: ReadonlyArray<{ readonly id: ActorId; readonly vitals: Vitals }>;
  vitalsOf(id: ActorId): Vitals | undefined;
}

/** Map-backed lookup, as match-loop will provide over its registry. */
export function createActorTable(actors: ReadonlyArray<CombatActor>): ActorTable {
  const map = new Map<ActorId, CombatActor>(actors.map((a) => [a.id, a]));
  const writes: Array<{ id: ActorId; vitals: Vitals }> = [];
  return {
    writes,
    get: (id) => map.get(id),
    setVitals(id, vitals) {
      const a = map.get(id);
      writes.push({ id, vitals });
      if (a !== undefined) map.set(id, { ...a, vitals });
    },
    vitalsOf: (id) => map.get(id)?.vitals,
  };
}

export interface RaycastCall {
  readonly origin: Vec3;
  readonly dir: Vec3;
  readonly maxDist: number;
  readonly mask: CollisionMask;
  readonly exclude: ActorId | undefined;
}

export interface SpyQuery extends PhysicsQuery {
  readonly calls: ReadonlyArray<RaycastCall>;
}

/** Records every raycast and forwards to the wrapped query. */
export function spyQuery(inner: PhysicsQuery): SpyQuery {
  const calls: RaycastCall[] = [];
  return {
    calls,
    raycast(origin, dir, maxDist, mask, exclude): RayHit | null {
      calls.push({ origin, dir, maxDist, mask, exclude });
      return inner.raycast(origin, dir, maxDist, mask, exclude);
    },
    lineOfSight: (a, b) => inner.lineOfSight(a, b),
  };
}

/** A query that always returns the given hit, for classification tests. */
export function fixedQuery(hit: RayHit | null): SpyQuery {
  return spyQuery({ raycast: () => hit, lineOfSight: () => true });
}
