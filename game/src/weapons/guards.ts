// Entry guards for the weapons module (ADR-WC-6). Internal: not re-exported from index.ts.
// Each exported weapons function normalises its inputs here once and never throws.
import { isFiniteVec, isWeaponId, type ActorId, type Vec3 } from '@sz/kernel';
import type { SwitchTarget, TriggerIntent, WeaponTickContext } from './types';

export interface CleanIntent {
  readonly fire: boolean;
  readonly reload: boolean;
  readonly scope: boolean;
  readonly switchTo: SwitchTarget | undefined;
}

export interface CleanContext {
  readonly now: number;
  readonly dt: number;
  readonly moving: boolean;
  readonly locked: boolean;
  readonly shooter: ActorId;
  readonly origin: Vec3;
  readonly aimDir: Vec3;
  /** False when origin or aimDir is not finite (BR-W-65). */
  readonly aimValid: boolean;
}

type Loose<T> = { readonly [K in keyof T]?: unknown };

const NO_INTENT: CleanIntent = Object.freeze({
  fire: false,
  reload: false,
  scope: false,
  switchTo: undefined,
});

export function isSwitchTarget(x: unknown): x is SwitchTarget {
  return x === 'next' || x === 'prev' || isWeaponId(x);
}

function isObject(x: unknown): x is object {
  return typeof x === 'object' && x !== null;
}

/** Only a literal `true` counts as pressed; anything else is released. */
export function cleanIntent(intent: TriggerIntent): CleanIntent {
  const raw: unknown = intent;
  if (!isObject(raw)) return NO_INTENT;
  const r = raw as Loose<TriggerIntent>;
  return {
    fire: r.fire === true,
    reload: r.reload === true,
    scope: r.scope === true,
    switchTo: isSwitchTarget(r.switchTo) ? r.switchTo : undefined,
  };
}

/** A non-finite or negative dt counts as 0 (BR-W-80). */
export function cleanDt(dt: unknown): number {
  return typeof dt === 'number' && Number.isFinite(dt) && dt > 0 ? dt : 0;
}

export function isFiniteTime(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function isVec(x: unknown): x is Vec3 {
  return isObject(x) && isFiniteVec(x as Vec3);
}

/**
 * Returns null when `now` is not finite: the tick is then a no-op (SEC-WC-01).
 * `locked` defaults to true unless it is literally false, so a malformed context never fires.
 */
export function cleanContext(ctx: WeaponTickContext): CleanContext | null {
  const raw: unknown = ctx;
  if (!isObject(raw)) return null;
  const r = raw as Loose<WeaponTickContext>;
  if (!isFiniteTime(r.now)) return null;
  const originOk = isVec(r.origin);
  const aimOk = isVec(r.aimDir);
  return {
    now: r.now,
    dt: cleanDt(r.dt),
    moving: r.moving === true,
    locked: r.locked !== false,
    shooter: ctx.shooter,
    origin: ctx.origin,
    aimDir: ctx.aimDir,
    aimValid: originOk && aimOk,
  };
}
