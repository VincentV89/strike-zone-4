/**
 * BotBrain aggregate (domain-entities-bot-ai). One per bot, created in Patrol with its own Rng.
 * Mutated only by decide, tick and markDead; holds no reference to any other brain
 * (req-bot-independence).
 */
import {
  BOT_STATES,
  vec3,
  type ActorId,
  type BotStateName,
  type Rng,
  type Stance,
  type Vec3,
} from '@sz/kernel';
import type { RouteId } from '@sz/nav';
import { difficultyParams } from './difficulty';
import { finiteNum } from './input-guards';
import { holdDecision } from './intent-bounds';
import type { BotDecision, BotGoal, BotTransition, BotWorldView, DifficultyParams } from './types';

export type Phase = 'choose' | 'moving' | 'waiting' | 'travel' | 'search' | 'fighting' | 'holding';

export interface StateContext {
  phase: Phase;
  waitUntil: number;
  /** Time of the stimulus being investigated. */
  targetAt: number;
  searchEndsAt: number;
  strafeSign: 1 | -1;
  strafeSwitchAt: number;
  holdEndsAt: number;
  relocations: number;
  compromised: boolean;
  /** Yaw the investigate search sweeps around. */
  sweepYaw: number;
}

export interface PathFollower {
  points: ReadonlyArray<Vec3>;
  /** Next point to reach. */
  index: number;
  /** A re-plan to the goal waits for budget. */
  pendingPlan: boolean;
  /** The goal was abandoned (null path or stuck twice). */
  failed: boolean;
  /** The final point was reached. */
  done: boolean;
  /** Travel speed along this path, m/s. */
  speed: number;
}

export interface StuckMonitor {
  windowStart: number;
  remainingAtStart: number;
  strikes: number;
  nudgeUntil: number;
  nudgeDir: Vec3;
}

export interface BotBrain {
  readonly id: ActorId;
  readonly params: DifficultyParams;
  readonly rng: Rng;
  state: BotStateName;
  stateSince: number;
  ctx: StateContext;
  goal: BotGoal | undefined;
  follower: PathFollower;
  stuck: StuckMonitor;
  burst: { firingUntil: number; pauseUntil: number };
  aim: { yaw: number; pitch: number; aimAt: Vec3 | undefined; errYaw: number; errPitch: number };
  reaction: { forSince: number; sec: number };
  rolls: { coverKey: number; cover: boolean; flankKey: number; flank: boolean };
  handled: { noiseAt: number; damageAt: number };
  retreatedLowHealth: boolean;
  lastFlankRoute: RouteId | null;
  recentPatrol: string[];
  /** Travel direction of the last goal that failed by getting stuck; patrol avoids it a while. */
  avoid: { dir: Vec3; until: number };
  readonly enteredCounts: Record<BotStateName, number>;
  /** The latest decision; tick() reads wantFire and wantReload from it. */
  decision: BotDecision;
  stance: Stance;
}

export function freshContext(): StateContext {
  return {
    phase: 'choose',
    waitUntil: 0,
    targetAt: -Infinity,
    searchEndsAt: Infinity,
    strafeSign: 1,
    strafeSwitchAt: -Infinity,
    holdEndsAt: Infinity,
    relocations: 0,
    compromised: false,
    sweepYaw: 0,
  };
}

export function emptyFollower(): PathFollower {
  return { points: [], index: 0, pendingPlan: false, failed: false, done: false, speed: 0 };
}

/** Starts following a new path; resets the stuck monitor (a goal change resets strikes). */
export function followPath(
  brain: BotBrain,
  points: ReadonlyArray<Vec3>,
  speed: number,
  now: number,
): void {
  brain.follower = { points, index: 0, pendingPlan: false, failed: false, done: false, speed };
  brain.stuck = freshStuck(now);
}

/** Marks the current goal unreachable. */
export function failPath(brain: BotBrain): void {
  brain.follower = { ...emptyFollower(), failed: true };
}

export function freshStuck(now: number): StuckMonitor {
  return {
    windowStart: now,
    remainingAtStart: Infinity,
    strikes: 0,
    nudgeUntil: -Infinity,
    nudgeDir: vec3(0, 0, 0),
  };
}

export interface BrainOptions {
  /** Round time at creation (default 0). */
  readonly now?: number;
  /** Initial facing. */
  readonly yaw?: number;
}

export function createBrain(
  id: ActorId,
  difficulty: unknown,
  rng: Rng,
  opts: BrainOptions = {},
): BotBrain {
  const now = finiteNum(opts.now) ? opts.now : 0;
  const counts = Object.fromEntries(BOT_STATES.map((s) => [s, 0])) as Record<BotStateName, number>;
  counts.patrol = 1;
  return {
    id,
    params: difficultyParams(difficulty),
    rng,
    state: 'patrol',
    stateSince: now,
    ctx: freshContext(),
    goal: undefined,
    follower: emptyFollower(),
    stuck: freshStuck(now),
    burst: { firingUntil: -Infinity, pauseUntil: -Infinity },
    aim: {
      yaw: finiteNum(opts.yaw) ? opts.yaw : 0,
      pitch: 0,
      aimAt: undefined,
      errYaw: 0,
      errPitch: 0,
    },
    reaction: { forSince: NaN, sec: Infinity },
    rolls: { coverKey: NaN, cover: false, flankKey: NaN, flank: false },
    handled: { noiseAt: -Infinity, damageAt: -Infinity },
    retreatedLowHealth: false,
    lastFlankRoute: null,
    recentPatrol: [],
    avoid: { dir: vec3(0, 0, 0), until: -Infinity },
    enteredCounts: counts,
    decision: holdDecision('patrol'),
    stance: 'stand',
  };
}

export function stateOf(brain: BotBrain): BotStateName {
  return brain.state;
}

/** Per-state entry counts, evidence for req-bot-fsm AC2. */
export function entered(brain: BotBrain): Readonly<Record<BotStateName, number>> {
  return Object.freeze({ ...brain.enteredCounts });
}

/** Releases every shared claim the bot holds: flank route, cover and patrol points. */
export function releaseClaims(brain: BotBrain, world: BotWorldView): void {
  world.nav.releaseRoute(brain.id);
  world.board.releaseAll(brain.id);
}

/**
 * Moves any live state to Dead in the kill tick (BR-AI-44) and releases the bot's claims.
 * Returns null when already dead or when `now` is not finite.
 */
export function markDead(brain: BotBrain, world: BotWorldView, now: number): BotTransition | null {
  if (brain.state === 'dead' || !finiteNum(now)) return null;
  const from = brain.state;
  releaseClaims(brain, world);
  brain.state = 'dead';
  brain.stateSince = now;
  brain.enteredCounts.dead++;
  brain.goal = undefined;
  brain.follower = emptyFollower();
  brain.decision = holdDecision('dead');
  return Object.freeze({ from, to: 'dead', guard: 'died', at: now });
}
