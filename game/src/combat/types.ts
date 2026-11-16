import type { ActorId, HitZone, Vec3 } from '@sz/kernel';
import type { ShotRequest } from '@sz/weapons';

export interface Vitals {
  /** Integer, >= 0. 0 means dead. */
  readonly health: number;
  /** Integer, >= 0. */
  readonly armor: number;
}

export interface DamageOutcome {
  readonly vitals: Vitals;
  readonly healthLost: number;
  readonly armorLost: number;
  /** True only on the alive → dead transition (BR-C-13). */
  readonly killed: boolean;
}

export type Side = 'player' | 'bot';

/** Projection of a sim actor. match-loop implements the lookups over its registry. */
export interface CombatActor {
  readonly id: ActorId;
  readonly side: Side;
  readonly vitals: Vitals;
}

/** A ReadonlyMap<ActorId, CombatActor> satisfies this port. */
export interface ActorLookup {
  get(id: ActorId): CombatActor | undefined;
}

export interface MutableActorLookup extends ActorLookup {
  setVitals(id: ActorId, vitals: Vitals): void;
}

export interface Impact {
  readonly point: Vec3;
  readonly normal: Vec3;
  readonly distance: number;
}

/**
 * Exactly one per ShotRequest, naming at most one target (req-single-damage).
 * `rejected` marks a request that failed the entry guards (unknown weapon, non-finite
 * origin, zero direction): applyResolution emits nothing for it.
 */
export type ShotResolution =
  | { readonly kind: 'miss'; readonly shot: ShotRequest; readonly rejected?: true }
  | ({ readonly kind: 'world'; readonly shot: ShotRequest } & Impact)
  | ({ readonly kind: 'blocked'; readonly shot: ShotRequest; readonly target: ActorId } & Impact)
  | ({
      readonly kind: 'hit';
      readonly shot: ShotRequest;
      readonly target: ActorId;
      readonly zone: HitZone;
      readonly rawDamage: number;
    } & Impact);
