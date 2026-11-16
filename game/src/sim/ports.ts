/**
 * Structural physics port (domain-entities-match-loop "Ports consumed", BR-ML-02). The shared
 * PhysicsWorld satisfies it with no wrapper; sim imports @sz/physics for types only.
 */
import type { ActorId, CharacterMover, PhysicsQuery, Stance, Vec3 } from '@sz/kernel';
import type { CharacterSpec, PhysicsStats } from '@sz/physics';

export interface SimPhysicsPort extends PhysicsQuery, CharacterMover {
  addCharacter(id: ActorId, spec: CharacterSpec, pos: Vec3): boolean;
  removeCharacter(id: ActorId): void;
  removeAllCharacters(): void;
  setHitboxesEnabled(id: ActorId, enabled: boolean): void;
  syncHitboxes(id: ActorId, pos: Vec3, yaw: number, stance: Stance): void;
  step(dt: number): void;
  stats(): PhysicsStats;
  readonly disposed: boolean;
}
