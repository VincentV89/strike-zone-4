/**
 * Perception types (domain-entities-bot-ai, "Perception entities").
 *
 * Only PerceptionSystem receives the player's true pose (TargetSample, BR-AI-01). Brain code
 * receives BotPercepts, which hold copies of what the bot legitimately sensed.
 */
import type { ActorId, Vec3 } from '@sz/kernel';

declare const targetSampleBrand: unique symbol;

/**
 * The true player state for one tick. Branded so it cannot be passed where brain inputs are
 * expected (SD-AI-3). Build it only with createTargetSample.
 */
export interface TargetSample {
  readonly [targetSampleBrand]: true;
  readonly id: ActorId;
  /** Feet position. */
  readonly feet: Vec3;
  /** 1.62 standing, 1.05 crouched (world-maps character dimensions). */
  readonly eyeHeight: number;
  readonly alive: boolean;
}

export interface BotSenseInput {
  readonly id: ActorId;
  readonly eye: Vec3;
  readonly yaw: number;
  readonly alive: boolean;
}

export interface VisionParams {
  readonly rangeM: number;
  /** Total horizontal field of view. */
  readonly fovRad: number;
  /** Vertical half-angle. */
  readonly vFovHalfRad: number;
}

/** World-collider sight only. The real PhysicsQuery satisfies it; raycast is never used. */
export interface SightPort {
  lineOfSight(a: Vec3, b: Vec3): boolean;
}

export type NoiseKind = 'gunfire' | 'footstep';

/** Payload of a NoiseEmitted event, as match-loop hands it to emitNoise. */
export interface NoiseInput {
  readonly source: ActorId;
  readonly pos: Vec3;
  readonly radius: number;
  readonly kind: NoiseKind;
}

/** One live actor position for the spatial grid (bots only; the player is never stored). */
export interface ActorPosition {
  readonly id: ActorId;
  readonly feet: Vec3;
  readonly alive: boolean;
}

/** The player's camera, used only to answer the radar question playerCanSee (BR-AI-21). */
export interface PlayerView {
  readonly eye: Vec3;
  readonly yaw: number;
  /** Total horizontal camera field of view. */
  readonly hFovRad: number;
  readonly alive: boolean;
}

/** A bot as the player-view check sees it: its chest point. */
export interface ViewedBot {
  readonly id: ActorId;
  readonly chest: Vec3;
  readonly alive: boolean;
}

export interface VisibleTarget {
  /** The sample point that was visible (aim point). */
  readonly pos: Vec3;
  readonly feet: Vec3;
  /** Start of the current sighting; reaction time is measured from here. */
  readonly since: number;
}

/** The only player-derived data a bot receives (dec-perception-gateway). Deep-frozen. */
export interface BotPercepts {
  readonly visibleTarget?: VisibleTarget;
  readonly lastKnown?: { readonly pos: Vec3; readonly at: number };
  readonly heardNoise?: { readonly pos: Vec3; readonly at: number; readonly kind: NoiseKind };
  /** Direction toward the attacker only, never a position. */
  readonly recentDamageFrom?: { readonly dir: Vec3; readonly at: number };
}

export interface PerceptionStats {
  readonly memories: number;
  readonly queuedNoises: number;
  readonly shots: number;
  readonly views: number;
  readonly gridActors: number;
}

export interface PerceptionSystem {
  /** Rebuilds the spatial grid from live bot positions. */
  updatePositions(actors: ReadonlyArray<ActorPosition>): void;
  /** Queues a noise; delivered by the next processNoises call. */
  emitNoise(noise: NoiseInput): void;
  processNoises(now: number): void;
  /** Senses the target for one bot. Returns the number of sight rays cast (0 to 2). */
  sense(
    bot: BotSenseInput,
    target: TargetSample,
    sight: SightPort,
    vision: VisionParams,
    now: number,
  ): number;
  recordDamage(bot: ActorId, dir: Vec3, now: number): void;
  noteShot(bot: ActorId, now: number): void;
  /** Checks the staggered sixth of bots for this tick. Returns the rays cast. */
  updatePlayerView(
    view: PlayerView,
    bots: ReadonlyArray<ViewedBot>,
    sight: SightPort,
    tick: number,
  ): number;
  perceptsFor(bot: ActorId, now: number): BotPercepts;
  playerCanSee(bot: ActorId): boolean;
  recentlyFired(bot: ActorId, now: number): boolean;
  /** Marks a bot dead: its memory is frozen and it no longer senses or hears. */
  markDead(bot: ActorId): void;
  reset(): void;
  stats(): PerceptionStats;
}
