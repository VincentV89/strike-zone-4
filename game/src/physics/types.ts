/** Physics adapter types (domain-entities-world-maps, "Physics adapter entities"). */
import type { ActorId, CharacterMover, HitZone, PhysicsQuery, Stance, Vec3 } from '@sz/kernel';
import type { MapDefinition } from '@sz/maps';

export interface CapsuleSpec {
  readonly radius: number;
  /** Total capsule height standing, feet to top. */
  readonly standHeight: number;
  /** Total capsule height crouched. */
  readonly crouchHeight: number;
}

export interface HitboxSpec {
  readonly zone: HitZone;
  readonly stance: Stance;
  /** Box centre relative to the feet position, before yaw. */
  readonly offset: Vec3;
  readonly half: Vec3;
}

export type CharacterSpec = CapsuleSpec & { readonly hitboxes: ReadonlyArray<HitboxSpec> };

export interface PhysicsStats {
  readonly bodies: number;
  readonly colliders: number;
  readonly characters: number;
}

export interface PhysicsWorld extends PhysicsQuery, CharacterMover {
  readonly mapId: string;
  /** False (and nothing created) for a duplicate id, invalid input or past 21 characters. */
  addCharacter(id: ActorId, spec: CharacterSpec, pos: Vec3): boolean;
  removeCharacter(id: ActorId): void;
  removeAllCharacters(): void;
  setHitboxesEnabled(id: ActorId, enabled: boolean): void;
  /** Places the stance's hitbox pair at the feet position rotated by yaw; applies at step(). */
  syncHitboxes(id: ActorId, pos: Vec3, yaw: number, stance: Stance): void;
  /** True when a capsule at feet position pos would overlap WORLD geometry. */
  overlapsCapsule(pos: Vec3, radius: number, height: number): boolean;
  /** Feet position of a character, or undefined for an unknown id. */
  positionOf(id: ActorId): Vec3 | undefined;
  step(dt: number): void;
  stats(): PhysicsStats;
  dispose(): void;
  readonly disposed: boolean;
}

export interface PhysicsHost {
  /** Disposes the current world (if any), then creates and returns one for `map`. */
  load(map: MapDefinition): PhysicsWorld;
  current(): PhysicsWorld | undefined;
  /** Stable facade that always forwards to current(); safe results when none is loaded. */
  readonly query: PhysicsQuery;
  /** 0 or 1. Test seam for BR-WM-65. */
  liveWorlds(): number;
  dispose(): void;
}

/** A failed loading step (services BootService). Retryable means the user may press Retry. */
export class BootError extends Error {
  readonly step: string;
  readonly retryable: boolean;
  override readonly cause: unknown;

  constructor(step: string, cause: unknown, retryable: boolean) {
    super(`boot step '${step}' failed`);
    this.name = 'BootError';
    this.step = step;
    this.retryable = retryable;
    this.cause = cause;
  }
}
