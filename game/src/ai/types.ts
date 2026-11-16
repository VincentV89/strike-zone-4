/**
 * Bot-ai types (domain-entities-bot-ai, "Bot AI entities"). None of the brain inputs has a
 * player field (BR-AI-01): the player reaches brain code only as BotPercepts.
 */
import type { ActorId, BotStateName, Stance, Vec3 } from '@sz/kernel';
import type { CoverPoint, PatrolPoint } from '@sz/maps';
import type { FlankPath, NavEdge, NavNode, NodeId, Path, RouteId } from '@sz/nav';
import type { TriggerIntent, WeaponView } from '@sz/weapons';

export interface DifficultyParams {
  readonly reactionMinSec: number;
  readonly reactionMaxSec: number;
  /** Aim error cone half-angle. */
  readonly aimErrorRad: number;
  readonly burstPauseSec: number;
  readonly coverChance: number;
  readonly flankChance: number;
  readonly visionRangeM: number;
  readonly burstShots: readonly [number, number];
  /** Facing turn rate, radians per second. */
  readonly turnRateRad: number;
}

/** The bot's own state, assembled by match-loop. Holds nothing about the player. */
export interface BotSelfView {
  readonly id: ActorId;
  /** Feet position. */
  readonly pos: Vec3;
  readonly eye: Vec3;
  readonly alive: boolean;
  readonly health: number;
  readonly weapon: Pick<WeaponView, 'equipped' | 'magazine' | 'reserve' | 'status'>;
}

/** World sight: WORLD colliders only. raycast is never reachable (BR-AI-04). */
export interface BotSight {
  lineOfSight(a: Vec3, b: Vec3): boolean;
}

/** The nav members bot-ai may call. clearReservations, reservations and routes are left out. */
export interface BotNav {
  readonly nodeCount: number;
  node(id: NodeId): NavNode;
  edges(id: NodeId): ReadonlyArray<NavEdge>;
  nearestNode(p: Vec3): NodeId;
  findPath(from: Vec3, to: Vec3): Path | null;
  findFlankPath(from: Vec3, target: Vec3, avoidRoute?: RouteId): FlankPath | null;
  reserveRoute(bot: ActorId, route: RouteId): void;
  releaseRoute(bot: ActorId): void;
}

/** Only tryConsume is visible; resetTick stays with match-loop. */
export interface BotBudget {
  tryConsume(): boolean;
}

export interface SquadBoard {
  /** True when the point is free or already held by this bot. */
  claimCover(bot: ActorId, coverId: string): boolean;
  coverClaimant(coverId: string): ActorId | undefined;
  claimPatrol(bot: ActorId, pointId: string): void;
  /** Number of other bots heading to the point. */
  patrolClaims(pointId: string, except?: ActorId): number;
  releaseCover(bot: ActorId): void;
  releasePatrol(bot: ActorId): void;
  releaseAll(bot: ActorId): void;
  clear(): void;
  size(): { readonly cover: number; readonly patrol: number };
}

export interface BotWorldView {
  readonly sight: BotSight;
  readonly nav: BotNav;
  readonly budget: BotBudget;
  readonly coverPoints: ReadonlyArray<CoverPoint>;
  readonly patrolPoints: ReadonlyArray<PatrolPoint>;
  readonly board: SquadBoard;
}

export type GuardId =
  | 'died'
  | 'target-seen'
  | 'damaged-seek-cover'
  | 'stimulus'
  | 'search-timeout'
  | 'disadvantaged'
  | 'reload-under-fire'
  | 'target-lost-flank'
  | 'target-lost'
  | 'cover-exit-engage'
  | 'cover-exit-flank'
  | 'cover-exit-investigate'
  | 'flank-ended'
  | 'retreat-done-seen'
  | 'retreat-done-known'
  | 'retreat-done-idle';

export interface TransitionRow {
  readonly id: string;
  readonly from: BotStateName;
  readonly to: BotStateName;
  readonly guard: GuardId;
  readonly urgent: boolean;
}

export interface BotTransition {
  readonly from: BotStateName;
  readonly to: BotStateName;
  readonly guard: GuardId;
  readonly at: number;
}

export interface BotDecision {
  readonly state: BotStateName;
  readonly goal?: Vec3;
  readonly aimAt?: Vec3;
  readonly wantFire: boolean;
  readonly wantReload: boolean;
  /** Present when this decide changed state; match-loop emits BotStateChanged from it. */
  readonly transition?: BotTransition;
}

export interface BotMoveIntent {
  /** Horizontal desired velocity, m/s. match-loop adds gravity. */
  readonly velocity: Vec3;
  readonly stance: Stance;
}

export interface BotIntent {
  readonly move: BotMoveIntent;
  readonly yaw: number;
  readonly pitch: number;
  /** Unit vector the weapon fires along (facing including aim error). */
  readonly aimDir: Vec3;
  readonly trigger: TriggerIntent;
}

export type BotGoal =
  | { readonly kind: 'patrol'; readonly pointId: string; readonly pos: Vec3 }
  | { readonly kind: 'point'; readonly pos: Vec3 }
  | {
      readonly kind: 'cover';
      readonly coverId: string;
      readonly pos: Vec3;
      readonly crouch: boolean;
    }
  | { readonly kind: 'route'; readonly routeId: RouteId | null; readonly pos: Vec3 }
  | { readonly kind: 'retreat'; readonly pos: Vec3; readonly coverId: string | null };
