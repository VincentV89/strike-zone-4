/**
 * The SimSnapshot read model (domain-entities-match-loop "Snapshot", SD-ML-4, BR-ML-60 to 63).
 * Built from copies and deep-frozen, so presentation cannot write into the sim. sim memoises it
 * per tick. It goes to presentation only; no @sz/ai function ever receives it (SD-ML-3).
 */
import type { Vitals } from '@sz/combat';
import {
  STEP_SEC,
  type ActorId,
  type BotCount,
  type BotStateName,
  type DomainEvent,
  type Stance,
  type Vec3,
} from '@sz/kernel';
import { weaponView, type WeaponView } from '@sz/weapons';
import type { BotActor } from './actors';
import { SIM_RULES } from './rules';
import type { SimState } from './state';

export interface SnapshotPlayer {
  readonly pos: Vec3;
  readonly prevPos: Vec3;
  readonly yaw: number;
  readonly pitch: number;
  readonly stance: Stance;
  readonly eyeHeight: number;
  readonly grounded: boolean;
  readonly alive: boolean;
  readonly vitals: Vitals;
  readonly weapon: WeaponView;
  readonly hitFlash: boolean;
}

export interface SnapshotBot {
  readonly id: ActorId;
  readonly pos: Vec3;
  readonly prevPos: Vec3;
  readonly yaw: number;
  readonly pitch: number;
  readonly stance: Stance;
  readonly state: BotStateName;
  readonly alive: boolean;
  readonly hitFlash: boolean;
  /** Radar input: playerCanSee || recentlyFired (BR-ML-61). ui-hud draws only revealed bots. */
  readonly revealed: boolean;
}

export interface SimSnapshot {
  readonly tick: number;
  /** Sim seconds. */
  readonly now: number;
  readonly player: SnapshotPlayer;
  readonly bots: ReadonlyArray<SnapshotBot>;
  readonly aliveBots: number;
  readonly botCount: BotCount;
  /** The last tick's events (the frozen tick log). */
  readonly events: ReadonlyArray<DomainEvent>;
}

/** Recursively freezes plain objects and arrays. Already-frozen nodes are skipped. */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  return Object.freeze(value);
}

const v = (p: Vec3): Vec3 => ({ x: p.x, y: p.y, z: p.z });
const flashing = (tick: number, lastHit: number): boolean =>
  tick - lastHit < SIM_RULES.hitFlashTicks;

function botView(s: SimState, b: BotActor, now: number): SnapshotBot {
  return {
    id: b.id,
    pos: v(b.pos),
    prevPos: v(b.prevPos),
    yaw: b.yaw,
    pitch: b.pitch,
    stance: b.stance,
    state: b.brain.state,
    alive: b.alive,
    hitFlash: flashing(s.tick, b.lastHitTick),
    revealed: s.perception.playerCanSee(b.id) || s.perception.recentlyFired(b.id, now),
  };
}

/** Returns undefined before spawn. */
export function buildSnapshot(s: SimState): SimSnapshot | undefined {
  const p = s.player;
  if (p === undefined) return undefined;
  const now = s.tick * STEP_SEC;
  const m = p.motion;
  const bots = s.bots.map((b) => botView(s, b, now));
  return deepFreeze({
    tick: s.tick,
    now,
    player: {
      pos: v(m.position),
      prevPos: v(m.prevPosition),
      yaw: m.yaw,
      pitch: m.pitch,
      stance: m.stance,
      eyeHeight: m.eyeHeight,
      grounded: m.grounded,
      alive: p.alive,
      vitals: { health: p.vitals.health, armor: p.vitals.armor },
      weapon: weaponView(p.inv, now, p.speed > SIM_RULES.movingSpeed),
      hitFlash: flashing(s.tick, p.lastHitTick),
    },
    bots,
    aliveBots: bots.filter((b) => b.alive).length,
    botCount: s.deps.setup.botCount,
    events: s.log.events(),
  });
}
