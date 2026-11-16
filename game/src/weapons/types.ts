import type { ActorId, DomainEvent, Vec3, WeaponId } from '@sz/kernel';

/** Events produced by the weapons module (domain-entities-weapons-combat). */
export type WeaponEvent = Extract<
  DomainEvent,
  { type: 'WeaponSwitched' | 'ReloadStarted' | 'ReloadDone' | 'DryFire' }
>;

type WithoutActor<E> = E extends unknown ? Omit<E, 'actor'> : never;

/**
 * A command event waiting in the outbox. The inventory does not know its holder,
 * so tickWeapon stamps `actor` from ctx.shooter when it returns the event.
 */
export type PendingWeaponEvent = WithoutActor<WeaponEvent>;

export interface WeaponSlot {
  readonly weapon: WeaponId;
  magazine: number;
  reserve: number;
  /** Simulation time from which this slot may fire again (kept per slot, BR-W-12). */
  nextFireAt: number;
}

/** Aggregate root, one per holder. Mutated only through the weapons functions. */
export interface WeaponInventory {
  readonly loadout: ReadonlyArray<WeaponId>;
  readonly slots: ReadonlyArray<WeaponSlot>;
  /** Index into slots of the equipped weapon. */
  equipped: number;
  /** Drawing while now < drawEndsAt. */
  drawEndsAt: number;
  /** Reload finishes at this time; null when not reloading. */
  reloadEndsAt: number | null;
  scoped: boolean;
  /** Current bloom on the equipped weapon, radians. Reset to 0 on switch. */
  bloom: number;
  /** Time of the last shot, or -Infinity. */
  lastShotAt: number;
  /** Trigger state from the previous tick, for semi-auto edge detection. */
  triggerWasHeld: boolean;
  /** Set when DryFire was emitted for the current press; cleared on release. */
  dryLatched: boolean;
  /** Events raised by commands, returned and cleared by the next tickWeapon (BR-W-16). */
  readonly outbox: PendingWeaponEvent[];
}

export type SwitchTarget = WeaponId | 'next' | 'prev';

/** Every weapon command for one tick. Name kept from component-methods. */
export interface TriggerIntent {
  readonly fire: boolean;
  readonly reload: boolean;
  /** Right mouse held. Ignored for weapons without a scope. */
  readonly scope: boolean;
  readonly switchTo?: SwitchTarget;
}

export interface WeaponTickContext {
  readonly now: number;
  readonly dt: number;
  readonly moving: boolean;
  /** True during countdown, while dead, or whenever the holder may not act. */
  readonly locked: boolean;
  readonly shooter: ActorId;
  /** Eye position, the ray origin. */
  readonly origin: Vec3;
  /** Aim direction before spread. */
  readonly aimDir: Vec3;
}

export interface ShotRequest {
  readonly shooter: ActorId;
  readonly weapon: WeaponId;
  readonly origin: Vec3;
  /** Unit vector with spread applied. */
  readonly dir: Vec3;
  readonly rangeM: number;
  /** Spread half-angle used for this shot, radians. */
  readonly spread: number;
}

export interface ViewKick {
  readonly pitch: number;
  readonly yaw: number;
}

export interface WeaponTickResult {
  readonly shots: ReadonlyArray<ShotRequest>;
  readonly events: ReadonlyArray<WeaponEvent>;
  /** Total view kick this tick, radians. player-controller applies it; bots ignore it. */
  readonly viewKick: ViewKick;
}

export type WeaponStatus = 'ready' | 'cooldown' | 'drawing' | 'reloading';

export interface OwnedWeaponView {
  readonly weapon: WeaponId;
  readonly magazine: number;
  readonly reserve: number;
}

/** Read model for SimSnapshot, HUD, bot-ai and the viewmodel. */
export interface WeaponView {
  readonly equipped: WeaponId;
  readonly magazine: number;
  readonly reserve: number;
  readonly status: WeaponStatus;
  /** 0..1 progress of the current draw or reload; 1 when neither is running. */
  readonly progress: number;
  readonly scoped: boolean;
  /** Current spread half-angle, radians. */
  readonly spread: number;
  readonly owned: ReadonlyArray<OwnedWeaponView>;
}
