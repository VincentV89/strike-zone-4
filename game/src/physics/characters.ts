/**
 * Character bodies inside a PhysicsWorld (LC-WM-14). Each character is a parentless capsule
 * collider driven by a KinematicCharacterController, plus one kinematic hitbox body carrying
 * four query-only hitbox colliders (two stances × head/body). The capsule is in the
 * adapter-only CHARACTER group, so rays never see it (BR-WM-53).
 */
import type {
  Collider,
  KinematicCharacterController,
  RigidBody,
  World,
} from '@dimforge/rapier3d-compat';
import {
  Layer,
  PLAYER_ID,
  degToRad,
  type ActorId,
  type HitZone,
  type Stance,
  type Vec3,
} from '@sz/kernel';
import { quatFromYawPitch } from '@sz/maps';
import { CONTROLLER_TUNING } from './constants';
import { GROUPS, hitboxGroups } from './groups';
import type { Rapier } from './rapier';
import type { CharacterSpec } from './types';

export interface HitOwner {
  readonly actorId: ActorId;
  readonly zone: HitZone;
}

export interface Character {
  readonly id: ActorId;
  readonly spec: CharacterSpec;
  readonly capsule: Collider;
  readonly controller: KinematicCharacterController;
  readonly hitBody: RigidBody;
  readonly hitboxes: ReadonlyArray<{ readonly collider: Collider; readonly stance: Stance }>;
  stance: Stance;
  hitboxStance: Stance;
  hitboxesEnabled: boolean;
  yaw: number;
  feet: Vec3;
}

export function capsuleHeight(spec: CharacterSpec, stance: Stance): number {
  return stance === 'stand' ? spec.standHeight : spec.crouchHeight;
}

/** Rapier capsule half-height of the cylinder part for a total height. */
export function capsuleHalfSegment(radius: number, height: number): number {
  return Math.max(0.01, height / 2 - radius);
}

export function capsuleCenter(feet: Vec3, height: number): Vec3 {
  return { x: feet.x, y: feet.y + height / 2, z: feet.z };
}

function hitLayer(id: ActorId, zone: HitZone): number {
  const player = id === PLAYER_ID;
  if (zone === 'head') return player ? Layer.PLAYER_HEAD : Layer.BOT_HEAD;
  return player ? Layer.PLAYER_BODY : Layer.BOT_BODY;
}

function configureController(c: KinematicCharacterController): void {
  const t = CONTROLLER_TUNING;
  c.enableAutostep(t.autostepMaxHeight, t.autostepMinWidth, false);
  c.enableSnapToGround(t.snapToGround);
  c.setMaxSlopeClimbAngle(degToRad(t.maxSlopeClimbDeg));
  c.setMinSlopeSlideAngle(degToRad(t.minSlopeSlideDeg));
  c.setApplyImpulsesToDynamicBodies(false);
}

export function createCharacter(
  R: Rapier,
  world: World,
  args: { readonly id: ActorId; readonly spec: CharacterSpec; readonly feet: Vec3 },
  owners: Map<number, HitOwner>,
): Character {
  const { id, spec, feet } = args;
  const h = spec.standHeight;
  const c = capsuleCenter(feet, h);
  const capsule = world.createCollider(
    R.ColliderDesc.capsule(capsuleHalfSegment(spec.radius, h), spec.radius)
      .setTranslation(c.x, c.y, c.z)
      .setCollisionGroups(GROUPS.capsule)
      .setSolverGroups(GROUPS.capsule),
  );
  const controller = world.createCharacterController(CONTROLLER_TUNING.offset);
  configureController(controller);
  const hitBody = world.createRigidBody(
    R.RigidBodyDesc.kinematicPositionBased().setTranslation(feet.x, feet.y, feet.z),
  );
  const hitboxes = spec.hitboxes.map((hb) => {
    const layer = hitLayer(id, hb.zone);
    const collider = world.createCollider(
      R.ColliderDesc.cuboid(hb.half.x, hb.half.y, hb.half.z)
        .setTranslation(hb.offset.x, hb.offset.y, hb.offset.z)
        .setCollisionGroups(hitboxGroups(layer))
        .setSolverGroups(0)
        .setEnabled(hb.stance === 'stand'),
      hitBody,
    );
    owners.set(collider.handle, { actorId: id, zone: hb.zone });
    return { collider, stance: hb.stance };
  });
  return {
    id,
    spec,
    capsule,
    controller,
    hitBody,
    hitboxes,
    stance: 'stand',
    hitboxStance: 'stand',
    hitboxesEnabled: true,
    yaw: 0,
    feet,
  };
}

export function applyHitboxState(ch: Character): void {
  for (const hb of ch.hitboxes) {
    hb.collider.setEnabled(ch.hitboxesEnabled && hb.stance === ch.hitboxStance);
  }
}

export function setHitboxPose(ch: Character, feet: Vec3, yaw: number): void {
  const q = quatFromYawPitch(yaw, 0);
  ch.hitBody.setNextKinematicTranslation(feet);
  ch.hitBody.setNextKinematicRotation(q);
}

export function setCapsuleShape(R: Rapier, ch: Character, stance: Stance): void {
  const h = capsuleHeight(ch.spec, stance);
  ch.capsule.setShape(new R.Capsule(capsuleHalfSegment(ch.spec.radius, h), ch.spec.radius));
  ch.capsule.setTranslation(capsuleCenter(ch.feet, h));
  ch.stance = stance;
}

export function destroyCharacter(world: World, ch: Character, owners: Map<number, HitOwner>): void {
  for (const hb of ch.hitboxes) owners.delete(hb.collider.handle);
  world.removeCharacterController(ch.controller);
  world.removeCollider(ch.capsule, false);
  world.removeRigidBody(ch.hitBody);
}
