// Port fakes shared by unit tests in player-movement, weapons-combat and bot-ai.
// Test-only: outside src/, so never bundled and never in the coverage denominator.
import {
  Layer,
  ZERO,
  includes,
  isFiniteVec,
  normalize,
  vec3,
  type ActorId,
  type CharacterMover,
  type CollisionMask,
  type HitZone,
  type LayerBit,
  type MoveResult,
  type PhysicsQuery,
  type RayHit,
  type Stance,
  type Vec3,
} from '@sz/kernel';

export interface Aabb {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface FakeActor {
  readonly id: ActorId;
  readonly head: Aabb;
  readonly body: Aabb;
  /** 'player' uses PLAYER_* layers, 'bot' uses BOT_* layers. */
  readonly side: 'player' | 'bot';
}

interface Collider {
  readonly box: Aabb;
  readonly layer: LayerBit;
  readonly owner?: { readonly id: ActorId; readonly zone: HitZone };
}

interface SlabHit {
  readonly t: number;
  readonly normal: Vec3;
}

const AXES = ['x', 'y', 'z'] as const;

function axisNormal(axis: (typeof AXES)[number], sign: number): Vec3 {
  if (axis === 'x') return vec3(sign, 0, 0);
  if (axis === 'y') return vec3(0, sign, 0);
  return vec3(0, 0, sign);
}

/**
 * Ray-versus-AABB slab test. Returns the entry distance along the unit ray, or null.
 * A ray that starts inside the box hits at t = 0 with the normal opposing the ray.
 */
export function raySlab(origin: Vec3, dir: Vec3, box: Aabb): SlabHit | null {
  let tMin = -Infinity;
  let tMax = Infinity;
  let normal: Vec3 = ZERO;
  for (const axis of AXES) {
    const o = origin[axis];
    const d = dir[axis];
    const lo = box.min[axis];
    const hi = box.max[axis];
    if (Math.abs(d) < 1e-12) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    let sign = -1;
    if (t1 > t2) {
      [t1, t2] = [t2, t1];
      sign = 1;
    }
    if (t1 > tMin) {
      tMin = t1;
      normal = axisNormal(axis, sign);
    }
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  if (tMax < 0) return null;
  if (tMin < 0) return { t: 0, normal: normalize(vec3(-dir.x, -dir.y, -dir.z)) };
  return { t: tMin, normal };
}

function actorColliders(a: FakeActor): Collider[] {
  const head = a.side === 'player' ? Layer.PLAYER_HEAD : Layer.BOT_HEAD;
  const body = a.side === 'player' ? Layer.PLAYER_BODY : Layer.BOT_BODY;
  return [
    { box: a.head, layer: head, owner: { id: a.id, zone: 'head' } },
    { box: a.body, layer: body, owner: { id: a.id, zone: 'body' } },
  ];
}

function along(origin: Vec3, dir: Vec3, t: number): Vec3 {
  return vec3(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t);
}

export interface FakePhysicsOptions {
  /** Static WORLD geometry. */
  readonly boxes?: ReadonlyArray<Aabb>;
  readonly actors?: ReadonlyArray<FakeActor>;
}

/** PhysicsQuery over axis-aligned boxes, following BR-K-40 to BR-K-43. */
export function createFakePhysics(opts: FakePhysicsOptions = {}): PhysicsQuery {
  const world: Collider[] = (opts.boxes ?? []).map((box) => ({ box, layer: Layer.WORLD }));
  const colliders: Collider[] = [...world, ...(opts.actors ?? []).flatMap(actorColliders)];

  function raycast(
    origin: Vec3,
    dir: Vec3,
    maxDist: number,
    m: CollisionMask,
    exclude?: ActorId,
  ): RayHit | null {
    if (!isFiniteVec(origin) || !(maxDist > 0)) return null;
    const unit = normalize(dir);
    if (unit === ZERO) return null;
    let best: { c: Collider; hit: SlabHit } | null = null;
    for (const c of colliders) {
      if (!includes(m, c.layer)) continue;
      if (exclude !== undefined && c.owner?.id === exclude) continue;
      const hit = raySlab(origin, unit, c.box);
      if (hit === null || hit.t > maxDist) continue;
      if (best === null || hit.t < best.hit.t) best = { c, hit };
    }
    if (best === null) return null;
    const point = along(origin, unit, best.hit.t);
    const base = { point, normal: best.hit.normal, distance: best.hit.t };
    const owner = best.c.owner;
    if (owner === undefined) return { kind: 'world', ...base };
    return { kind: 'actor', ...base, actorId: owner.id, zone: owner.zone };
  }

  function lineOfSight(a: Vec3, b: Vec3): boolean {
    if (!isFiniteVec(a) || !isFiniteVec(b)) return false;
    const d = vec3(b.x - a.x, b.y - a.y, b.z - a.z);
    const len = Math.hypot(d.x, d.y, d.z);
    if (len < 1e-9) return true;
    const unit = vec3(d.x / len, d.y / len, d.z / len);
    for (const c of world) {
      const hit = raySlab(a, unit, c.box);
      // Open segment: a box that starts at or beyond b does not block.
      if (hit !== null && hit.t < len) return false;
    }
    return true;
  }

  return { raycast, lineOfSight };
}

export interface FakeMoverOptions {
  readonly floorY?: number;
  /** Areas where standing is blocked: a box whose min.y is below the standing head height. */
  readonly ceilings?: ReadonlyArray<Aabb>;
  readonly standHeight?: number;
}

interface MoverState {
  pos: Vec3;
  stance: Stance;
}

const NOT_FOUND: MoveResult = {
  position: ZERO,
  grounded: false,
  hitCeiling: false,
  collided: false,
};

/** CharacterMover that integrates velocity over a flat floor (BR-K-44 to BR-K-46). */
export function createFakeMover(opts: FakeMoverOptions = {}): CharacterMover & {
  readonly add: (id: ActorId, pos: Vec3) => void;
  stanceOf(id: ActorId): Stance | undefined;
} {
  const floorY = opts.floorY ?? 0;
  const standHeight = opts.standHeight ?? 1.8;
  const ceilings = opts.ceilings ?? [];
  const actors = new Map<ActorId, MoverState>();

  function underCeiling(p: Vec3): boolean {
    return ceilings.some(
      (c) =>
        p.x >= c.min.x &&
        p.x <= c.max.x &&
        p.z >= c.min.z &&
        p.z <= c.max.z &&
        c.min.y < p.y + standHeight,
    );
  }

  return {
    add(id, pos) {
      actors.set(id, { pos, stance: 'stand' });
    },
    stanceOf(id) {
      return actors.get(id)?.stance;
    },
    move(id, desiredVelocity, dt) {
      const s = actors.get(id);
      if (s === undefined) return NOT_FOUND;
      const v = isFiniteVec(desiredVelocity) ? desiredVelocity : ZERO;
      const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
      let y = s.pos.y + v.y * step;
      const grounded = y <= floorY;
      if (grounded) y = floorY;
      s.pos = vec3(s.pos.x + v.x * step, y, s.pos.z + v.z * step);
      return { position: s.pos, grounded, hitCeiling: false, collided: grounded && v.y < 0 };
    },
    setStance(id, stance) {
      const s = actors.get(id);
      if (s === undefined) return false;
      if (stance === 'stand' && underCeiling(s.pos)) return false;
      s.stance = stance;
      return true;
    },
    teleport(id, pos) {
      const s = actors.get(id);
      if (s === undefined) actors.set(id, { pos, stance: 'stand' });
      else s.pos = pos;
    },
  };
}
