// Frozen SimSnapshot / RenderFrame fixtures for presentation-3d core tests (SD-R-2).
import { PLAYER_ID, botIds, vec3, type ActorId, type DomainEvent, type Vec3 } from '@sz/kernel';
import type { RenderFrame } from '@sz/render/core/types';
import type { SimSnapshot, SnapshotBot, SnapshotPlayer } from '@sz/sim';
import type { WeaponView } from '@sz/weapons';

export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  return Object.freeze(value);
}

export const RIFLE_VIEW: WeaponView = {
  equipped: 'rifle',
  magazine: 30,
  reserve: 90,
  status: 'ready',
  progress: 1,
  scoped: false,
  spread: 0.01,
  owned: [],
};

export function player(over: Partial<SnapshotPlayer> = {}): SnapshotPlayer {
  return {
    pos: vec3(0, 0, 0),
    prevPos: vec3(0, 0, 0),
    yaw: 0,
    pitch: 0,
    stance: 'stand',
    eyeHeight: 1.62,
    grounded: true,
    alive: true,
    vitals: { health: 100, armor: 100 },
    weapon: RIFLE_VIEW,
    hitFlash: false,
    ...over,
  };
}

export function bot(id: ActorId, pos: Vec3, over: Partial<SnapshotBot> = {}): SnapshotBot {
  return {
    id,
    pos,
    prevPos: pos,
    yaw: 0,
    pitch: 0,
    stance: 'stand',
    state: 'patrol',
    alive: true,
    hitFlash: false,
    revealed: false,
    ...over,
  };
}

/** `count` bots in a row 10 m ahead (−Z) of the player, 2 m apart. */
export function botsAhead(count: number, distM = 10): SnapshotBot[] {
  const ids = botIds(20);
  const out: SnapshotBot[] = [];
  for (let i = 0; i < count; i++) {
    const id = ids[i] ?? (`bot-${String(i + 1)}` as ActorId);
    out.push(bot(id, vec3((i - count / 2) * 2, 0, -distM)));
  }
  return out;
}

export function snapshot(over: Partial<SimSnapshot> = {}): SimSnapshot {
  const bots = over.bots ?? botsAhead(5);
  return deepFreeze({
    tick: 1,
    now: 1 / 60,
    player: player(),
    bots,
    aliveBots: bots.filter((b) => b.alive).length,
    botCount: 5,
    events: [],
    ...over,
  });
}

export function frame(curr: SimSnapshot | undefined, over: Partial<RenderFrame> = {}): RenderFrame {
  return deepFreeze({
    prev: curr,
    curr,
    alpha: 0.5,
    events: [],
    dtSec: 1 / 60,
    paused: false,
    ...over,
  });
}

export const PLAYER = PLAYER_ID;

export function shot(shooter: ActorId, origin: Vec3, dir: Vec3): DomainEvent {
  return { type: 'ShotFired', shooter, weapon: 'rifle', origin, dir };
}

export function impactWorld(point: Vec3, normal: Vec3): DomainEvent {
  return { type: 'ShotImpact', shooter: PLAYER_ID, point, normal, surface: 'world' };
}

export function impactBot(target: ActorId, point: Vec3): DomainEvent {
  return {
    type: 'ShotImpact',
    shooter: PLAYER_ID,
    point,
    normal: vec3(0, 0, 1),
    surface: 'actor',
    target,
  };
}
