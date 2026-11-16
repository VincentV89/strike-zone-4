// Shared helpers for weapons and combat tests: a tick driver at 60 Hz.
import { PLAYER_ID, STEP_SEC, vec3, type ActorId, type Rng, type Vec3 } from '@sz/kernel';
import {
  tickWeapon,
  type TriggerIntent,
  type WeaponInventory,
  type WeaponTickContext,
  type WeaponTickResult,
} from '@sz/weapons';

export const FORWARD: Vec3 = vec3(0, 0, -1);
export const EYE: Vec3 = vec3(0, 1.6, 0);

export const IDLE_INTENT: TriggerIntent = { fire: false, reload: false, scope: false };
export const FIRE: TriggerIntent = { fire: true, reload: false, scope: false };

/** Simulation time of tick k, as match-loop computes it. */
export function at(tick: number): number {
  return tick * STEP_SEC;
}

export function ctxAt(tick: number, over: Partial<WeaponTickContext> = {}): WeaponTickContext {
  return {
    now: at(tick),
    dt: STEP_SEC,
    moving: false,
    locked: false,
    shooter: PLAYER_ID,
    origin: EYE,
    aimDir: FORWARD,
    ...over,
  };
}

export interface TickLog {
  readonly tick: number;
  readonly result: WeaponTickResult;
}

/** Runs ticks [from, to) with an intent chosen per tick and returns every result. */
export function runTicks(
  inv: WeaponInventory,
  rng: Rng,
  from: number,
  to: number,
  intentAt: (tick: number) => TriggerIntent,
  over: (tick: number) => Partial<WeaponTickContext> = () => ({}),
): TickLog[] {
  const log: TickLog[] = [];
  for (let t = from; t < to; t++) {
    log.push({ tick: t, result: tickWeapon(inv, intentAt(t), ctxAt(t, over(t)), rng) });
  }
  return log;
}

export function shotTicks(log: ReadonlyArray<TickLog>): number[] {
  return log.filter((l) => l.result.shots.length > 0).map((l) => l.tick);
}

export function eventsOf(log: ReadonlyArray<TickLog>): Array<{ tick: number; type: string }> {
  return log.flatMap((l) => l.result.events.map((e) => ({ tick: l.tick, type: e.type })));
}

export const BOT_1 = 'bot-1' as ActorId;
export const BOT_2 = 'bot-2' as ActorId;
