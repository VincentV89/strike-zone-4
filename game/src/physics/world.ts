/**
 * The Rapier-backed PhysicsWorld (LC-WM-13, dec-rapier-single-collision-truth). One fixed
 * cuboid per map solid in the WORLD group; characters from characters.ts. Every method guards
 * its input first (SD-WM-1), checks `disposed` (SD-WM-4) and runs Rapier inside the fault
 * reporter (SD-WM-3).
 */
import type { Ray, World } from '@dimforge/rapier3d-compat';
import {
  ZERO,
  type ActorId,
  type CollisionMask,
  type MoveResult,
  type RayHit,
  type Stance,
  type Vec3,
} from '@sz/kernel';
import { quatFromYawPitch, type MapDefinition } from '@sz/maps';
import {
  applyHitboxState,
  capsuleCenter,
  capsuleHalfSegment,
  capsuleHeight,
  createCharacter,
  destroyCharacter,
  setCapsuleShape,
  setHitboxPose,
  type Character,
  type HitOwner,
} from './characters';
import { CONTROLLER_TUNING, MAX_CHARACTERS, PHYSICS_STEP_SEC } from './constants';
import { createFaultReporter, defaultReport, type Guarded } from './faults';
import { GROUPS, queryGroups } from './groups';
import { clampMask, okDt, okSize, okVec, rayDist, safeVelocity, unitDir } from './guards';
import { rapierOrUndefined, type Rapier } from './rapier';
import type { CharacterSpec, PhysicsStats, PhysicsWorld } from './types';

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
/** Overlap probe is lifted and slimmed slightly so resting on the floor is not an overlap. */
const OVERLAP_LIFT = 0.05;
const OVERLAP_SHRINK = 0.01;
const LOS_EPS = 1e-4;
const MAX_SPEC_SIZE = 4;

function stillAt(feet: Vec3): MoveResult {
  return { position: feet, grounded: false, hitCeiling: false, collided: false };
}

function validSpec(spec: CharacterSpec): boolean {
  const okHitbox = spec.hitboxes.every(
    (h) =>
      okVec(h.offset) &&
      okSize(h.half.x, MAX_SPEC_SIZE) &&
      okSize(h.half.y, MAX_SPEC_SIZE) &&
      okSize(h.half.z, MAX_SPEC_SIZE),
  );
  return (
    okHitbox &&
    okSize(spec.radius, MAX_SPEC_SIZE) &&
    okSize(spec.crouchHeight, MAX_SPEC_SIZE) &&
    okSize(spec.standHeight, MAX_SPEC_SIZE) &&
    spec.crouchHeight <= spec.standHeight &&
    spec.crouchHeight > 2 * spec.radius
  );
}

function addStaticSolids(
  R: Rapier,
  world: World,
  map: MapDefinition,
  owners: Map<number, 'world'>,
) {
  for (const s of map.solids) {
    const body = world.createRigidBody(
      R.RigidBodyDesc.fixed()
        .setTranslation(s.center.x, s.center.y, s.center.z)
        .setRotation(quatFromYawPitch(s.yaw, s.pitch)),
    );
    const collider = world.createCollider(
      R.ColliderDesc.cuboid(s.half.x, s.half.y, s.half.z).setCollisionGroups(GROUPS.world),
      body,
    );
    owners.set(collider.handle, 'world');
  }
}

/** Internal factory with an injectable Rapier module and fault sink (tests use a stub). */
export function createWorldFrom(
  R: Rapier,
  map: MapDefinition,
  report: (line: string) => void = defaultReport,
): PhysicsWorld {
  const world = new R.World({ x: 0, y: 0, z: 0 });
  world.timestep = PHYSICS_STEP_SEC;
  const staticOwners = new Map<number, 'world'>();
  const hitOwners = new Map<number, HitOwner>();
  addStaticSolids(R, world, map, staticOwners);
  world.step(); // build the query structure before the first query
  const ray: Ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 });
  const chars = new Map<ActorId, Character>();
  const guarded: Guarded = createFaultReporter(report);
  let disposed = false;

  function castFor(origin: Vec3, dir: Vec3): Ray {
    ray.origin = { x: origin.x, y: origin.y, z: origin.z };
    ray.dir = { x: dir.x, y: dir.y, z: dir.z };
    return ray;
  }

  function raycast(
    origin: Vec3,
    dir: Vec3,
    maxDist: number,
    mask: CollisionMask,
    exclude?: ActorId,
  ): RayHit | null {
    if (disposed || !okVec(origin)) return null;
    const d = unitDir(dir);
    const dist = rayDist(maxDist);
    const m = clampMask(mask);
    if (!d || dist === null || m === 0) return null;
    const excludeBody = exclude === undefined ? undefined : chars.get(exclude)?.hitBody;
    return guarded('raycast', null, () => {
      const hit = world.castRayAndGetNormal(
        castFor(origin, d),
        dist,
        true,
        undefined,
        queryGroups(m),
        undefined,
        excludeBody,
      );
      if (!hit) return null;
      const t = hit.timeOfImpact;
      const point = { x: origin.x + d.x * t, y: origin.y + d.y * t, z: origin.z + d.z * t };
      const nl = Math.hypot(hit.normal.x, hit.normal.y, hit.normal.z);
      const normal =
        nl > 1e-9
          ? { x: hit.normal.x / nl, y: hit.normal.y / nl, z: hit.normal.z / nl }
          : { x: -d.x, y: -d.y, z: -d.z };
      const owner = hitOwners.get(hit.collider.handle);
      if (owner) return { kind: 'actor', point, normal, distance: t, ...owner };
      return { kind: 'world', point, normal, distance: t };
    });
  }

  function lineOfSight(a: Vec3, b: Vec3): boolean {
    if (disposed || !okVec(a) || !okVec(b)) return false;
    const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (len < 1e-6) return true;
    const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len, z: (b.z - a.z) / len };
    return guarded(
      'lineOfSight',
      false,
      () =>
        world.castRay(castFor(a, d), len - LOS_EPS, true, undefined, GROUPS.worldQuery) === null,
    );
  }

  function overlapsCapsule(pos: Vec3, radius: number, height: number): boolean {
    if (
      disposed ||
      !okVec(pos) ||
      !okSize(radius, MAX_SPEC_SIZE) ||
      !okSize(height, 2 * MAX_SPEC_SIZE)
    ) {
      return false;
    }
    const r = Math.max(0.01, radius - OVERLAP_SHRINK);
    const c = capsuleCenter({ x: pos.x, y: pos.y + OVERLAP_LIFT, z: pos.z }, height);
    return guarded(
      'overlap',
      false,
      () =>
        world.intersectionWithShape(
          c,
          IDENTITY,
          new R.Capsule(capsuleHalfSegment(r, height), r),
          undefined,
          GROUPS.worldQuery,
        ) !== null,
    );
  }

  function move(id: ActorId, desiredVelocity: Vec3, dt: number): MoveResult {
    const ch = disposed ? undefined : chars.get(id);
    if (!ch) return stillAt(ZERO);
    if (!okDt(dt)) return stillAt(ch.feet);
    const v = safeVelocity(desiredVelocity);
    const desired = { x: v.x * dt, y: v.y * dt, z: v.z * dt };
    return guarded('move', stillAt(ch.feet), () => {
      ch.controller.computeColliderMovement(ch.capsule, desired, undefined, GROUPS.controllerQuery);
      const mv = ch.controller.computedMovement();
      const c = ch.capsule.translation();
      const next = { x: c.x + mv.x, y: c.y + mv.y, z: c.z + mv.z };
      ch.capsule.setTranslation(next);
      const n = ch.controller.numComputedCollisions();
      let hitCeiling = false;
      for (let i = 0; i < n; i++) {
        const col = ch.controller.computedCollision(i);
        if (col && col.normal1.y < CONTROLLER_TUNING.ceilingNormalY) hitCeiling = true;
      }
      const h = capsuleHeight(ch.spec, ch.stance);
      ch.feet = { x: next.x, y: next.y - h / 2, z: next.z };
      return {
        position: ch.feet,
        grounded: ch.controller.computedGrounded(),
        hitCeiling,
        collided: n > 0,
      };
    });
  }

  function setStance(id: ActorId, stance: Stance): boolean {
    const ch = disposed ? undefined : chars.get(id);
    if (!ch) return false;
    if (ch.stance === stance) return true;
    if (stance === 'stand' && overlapsCapsule(ch.feet, ch.spec.radius, ch.spec.standHeight)) {
      return false;
    }
    return guarded('setStance', false, () => {
      setCapsuleShape(R, ch, stance);
      return true;
    });
  }

  function teleport(id: ActorId, pos: Vec3): void {
    const ch = disposed ? undefined : chars.get(id);
    if (!ch || !okVec(pos)) return;
    guarded('teleport', undefined, () => {
      ch.feet = { x: pos.x, y: pos.y, z: pos.z };
      ch.capsule.setTranslation(capsuleCenter(ch.feet, capsuleHeight(ch.spec, ch.stance)));
      ch.hitBody.setTranslation(ch.feet, true);
    });
  }

  function addCharacter(id: ActorId, spec: CharacterSpec, pos: Vec3): boolean {
    if (disposed || chars.has(id) || chars.size >= MAX_CHARACTERS) return false;
    if (!okVec(pos) || !validSpec(spec)) return false;
    const ch = guarded('addCharacter', undefined, () =>
      createCharacter(R, world, { id, spec, feet: { x: pos.x, y: pos.y, z: pos.z } }, hitOwners),
    );
    if (!ch) return false;
    chars.set(id, ch);
    return true;
  }

  function removeCharacter(id: ActorId): void {
    const ch = disposed ? undefined : chars.get(id);
    if (!ch) return;
    chars.delete(id);
    guarded('removeCharacter', undefined, () => {
      destroyCharacter(world, ch, hitOwners);
    });
  }

  function syncHitboxes(id: ActorId, pos: Vec3, yaw: number, stance: Stance): void {
    const ch = disposed ? undefined : chars.get(id);
    if (!ch || !okVec(pos)) return;
    if (Number.isFinite(yaw)) ch.yaw = yaw;
    guarded('syncHitboxes', undefined, () => {
      setHitboxPose(ch, pos, ch.yaw);
      ch.hitboxStance = stance;
      applyHitboxState(ch);
    });
  }

  function setHitboxesEnabled(id: ActorId, enabled: boolean): void {
    const ch = disposed ? undefined : chars.get(id);
    if (!ch) return;
    ch.hitboxesEnabled = enabled;
    guarded('setHitboxesEnabled', undefined, () => {
      applyHitboxState(ch);
    });
  }

  function step(dt: number): void {
    if (disposed || !okDt(dt)) return;
    guarded('step', undefined, () => {
      world.timestep = dt;
      world.step();
    });
  }

  function stats(): PhysicsStats {
    if (disposed) return { bodies: 0, colliders: 0, characters: 0 };
    return guarded('step', { bodies: 0, colliders: 0, characters: chars.size }, () => ({
      bodies: world.bodies.len(),
      colliders: world.colliders.len(),
      characters: chars.size,
    }));
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    guarded('dispose', undefined, () => {
      for (const ch of chars.values()) world.removeCharacterController(ch.controller);
    });
    chars.clear();
    guarded('dispose', undefined, () => {
      world.free();
    });
  }

  return {
    mapId: map.id,
    raycast,
    lineOfSight,
    overlapsCapsule,
    move,
    setStance,
    teleport,
    addCharacter,
    removeCharacter,
    removeAllCharacters() {
      for (const id of [...chars.keys()]) removeCharacter(id);
    },
    setHitboxesEnabled,
    syncHitboxes,
    positionOf: (id) => (disposed ? undefined : chars.get(id)?.feet),
    step,
    stats,
    dispose,
    get disposed() {
      return disposed;
    },
  };
}

/** Creates a world for `map`. Throws when initPhysics has not resolved (BR-WM-51). */
export function createPhysicsWorld(map: MapDefinition): PhysicsWorld {
  const R = rapierOrUndefined();
  if (!R) throw new Error('createPhysicsWorld called before initPhysics() resolved');
  return createWorldFrom(R, map);
}
