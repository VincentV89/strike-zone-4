/**
 * Kernel public type surface (domain-entities-kernel-foundation).
 *
 * Units: metres, seconds and radians everywhere (BR-K-14). Value objects are
 * immutable by type, not by Object.freeze (BR-K-07).
 */

// ---- identifiers and enumerations ----
export type Vec3 = Readonly<{ x: number; y: number; z: number }>;
export type ActorId = string & { readonly __brand: 'ActorId' };
export type WeaponId = 'rifle' | 'pistol' | 'sniper';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type MapId = 'desert-compound' | 'industrial-warehouse';
export type BotCount = 1 | 2 | 3 | 5 | 8 | 10 | 15 | 20;
export type HitZone = 'head' | 'body';
export type Stance = 'stand' | 'crouch';
export type BotStateName =
  'patrol' | 'investigate' | 'engage' | 'take-cover' | 'flank' | 'retreat' | 'dead';
export type RoundPhase = 'loading' | 'ready' | 'countdown' | 'live' | 'ended';
export type RoundOutcome = 'victory' | 'defeat' | 'time-expired' | 'abandoned';

export interface MatchSetup {
  readonly mapId: MapId;
  readonly botCount: BotCount;
  readonly difficulty: Difficulty;
}

export type Result<T, E> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

// ---- collision vocabulary shared by ports ----
export type CollisionMask = number & { readonly __brand: 'CollisionMask' };

export type RayHit =
  | {
      readonly kind: 'world';
      readonly point: Vec3;
      readonly normal: Vec3;
      readonly distance: number;
    }
  | {
      readonly kind: 'actor';
      readonly point: Vec3;
      readonly normal: Vec3;
      readonly distance: number;
      readonly actorId: ActorId;
      readonly zone: HitZone;
    };

export interface MoveResult {
  readonly position: Vec3;
  readonly grounded: boolean;
  readonly hitCeiling: boolean;
  readonly collided: boolean;
}

// ---- ports (implemented by physics-adapter in the world-maps unit) ----
export interface PhysicsQuery {
  /** Nearest hit within maxDist among colliders in mask, ignoring `exclude` (BR-K-41, BR-K-42). */
  raycast(
    origin: Vec3,
    dir: Vec3,
    maxDist: number,
    mask: CollisionMask,
    exclude?: ActorId,
  ): RayHit | null;
  /** True when no WORLD collider intersects the open segment a→b (BR-K-43). */
  lineOfSight(a: Vec3, b: Vec3): boolean;
}

export interface CharacterMover {
  /** desiredVelocity is in m/s; the adapter moves by desiredVelocity × dt (BR-K-44). */
  move(id: ActorId, desiredVelocity: Vec3, dt: number): MoveResult;
  /** Returns false and stays crouched when a ceiling blocks standing (BR-K-45). */
  setStance(id: ActorId, stance: Stance): boolean;
  /** Places the character without collision resolution; spawn and reset only (BR-K-46). */
  teleport(id: ActorId, pos: Vec3): void;
}

// ---- domain events (presentation and bookkeeping only, BR-K-20) ----
export type DomainEvent =
  | {
      readonly type: 'ShotFired';
      readonly shooter: ActorId;
      readonly weapon: WeaponId;
      readonly origin: Vec3;
      readonly dir: Vec3;
    }
  | {
      readonly type: 'ShotImpact';
      readonly shooter: ActorId;
      readonly point: Vec3;
      readonly normal: Vec3;
      readonly surface: 'world' | 'actor';
      /** Present only when surface is 'actor'. */
      readonly target?: ActorId;
    }
  | {
      readonly type: 'HitConfirmed';
      readonly shooter: ActorId;
      readonly target: ActorId;
      readonly zone: HitZone;
      readonly damage: number;
      readonly killed: boolean;
    }
  | {
      readonly type: 'DamageTaken';
      readonly victim: ActorId;
      readonly from: ActorId;
      /** Horizontal unit vector from victim toward attacker; ZERO when they share x and z. */
      readonly dir: Vec3;
      readonly amount: number;
      readonly healthAfter: number;
      readonly armorAfter: number;
    }
  | {
      readonly type: 'ActorKilled';
      readonly killer: ActorId;
      readonly victim: ActorId;
      readonly weapon: WeaponId;
      readonly headshot: boolean;
    }
  | {
      readonly type: 'WeaponSwitched';
      readonly actor: ActorId;
      readonly from: WeaponId;
      readonly to: WeaponId;
    }
  | {
      readonly type: 'ReloadStarted';
      readonly actor: ActorId;
      readonly weapon: WeaponId;
      readonly durationSec: number;
    }
  | {
      readonly type: 'ReloadDone';
      readonly actor: ActorId;
      readonly weapon: WeaponId;
      readonly magazine: number;
      readonly reserve: number;
    }
  | { readonly type: 'DryFire'; readonly actor: ActorId; readonly weapon: WeaponId }
  | {
      readonly type: 'Footstep';
      readonly actor: ActorId;
      readonly pos: Vec3;
      readonly gait: 'walk' | 'sprint';
    }
  | {
      readonly type: 'NoiseEmitted';
      readonly source: ActorId;
      readonly pos: Vec3;
      readonly radius: number;
      readonly kind: 'gunfire' | 'footstep';
    }
  | {
      readonly type: 'BotStateChanged';
      readonly bot: ActorId;
      readonly from: BotStateName;
      readonly to: BotStateName;
    }
  | { readonly type: 'RoundPhaseChanged'; readonly from: RoundPhase; readonly to: RoundPhase }
  | { readonly type: 'RoundEnded'; readonly outcome: RoundOutcome; readonly durationSec: number }
  | {
      readonly type: 'PerformanceAdvisory';
      readonly medianFps: number;
      readonly botCount: number;
    };

export type DomainEventType = DomainEvent['type'];

// ---- stateful kernel services ----
export interface FrameSteps {
  readonly steps: number;
  /** Interpolation factor in [0, 1). */
  readonly alpha: number;
  /** Simulation time discarded this frame by the clamp and the step cap. */
  readonly droppedSec: number;
}

export interface FixedClock {
  readonly stepSec: number;
  advance(frameDtSec: number): FrameSteps;
  reset(): void;
}

export type Unsubscribe = () => void;

export interface EventBus<E extends { readonly type: string }> {
  emit(e: E): void;
  drain(): ReadonlyArray<E>;
  subscribe<K extends E['type']>(type: K, fn: (e: Extract<E, { type: K }>) => void): Unsubscribe;
  subscribeAll(fn: (e: E) => void): Unsubscribe;
  clear(): void;
  readonly pending: number;
}

export interface Rng {
  readonly seed: number;
  next(): number;
  range(a: number, b: number): number;
  pick<T>(xs: ReadonlyArray<T>): T | undefined;
}
