import { isFiniteTime, isSwitchTarget } from './guards';
import { equippedSlot, statusOf } from './inventory';
import type { SwitchTarget, WeaponInventory } from './types';
import { WEAPON_TABLE } from './weapon-table';

/*
 * Commands may be called directly or through tickWeapon. Events go to inv.outbox and are
 * returned by the next tickWeapon, so a direct call never loses an event (BR-W-16).
 * All three are total: hostile input returns false or changes nothing.
 */

function targetIndex(inv: WeaponInventory, to: SwitchTarget): number {
  const n = inv.loadout.length;
  if (to === 'next') return (inv.equipped + 1) % n;
  if (to === 'prev') return (inv.equipped - 1 + n) % n;
  return inv.loadout.indexOf(to);
}

/**
 * BR-W-20 to BR-W-22. Returns false when the target is equipped or not owned. A valid switch
 * cancels any reload with no ammo moved, clears scope, bloom and trigger latches, and starts
 * the new weapon's draw.
 */
export function switchWeapon(inv: WeaponInventory, to: SwitchTarget, now: number): boolean {
  if (!isFiniteTime(now) || !isSwitchTarget(to)) return false;
  const from = equippedSlot(inv);
  if (from === undefined) return false;
  const index = targetIndex(inv, to);
  const target = inv.slots[index];
  if (target === undefined || index === inv.equipped) return false;
  inv.reloadEndsAt = null;
  inv.scoped = false;
  inv.bloom = 0;
  inv.triggerWasHeld = false;
  inv.dryLatched = false;
  inv.equipped = index;
  inv.drawEndsAt = now + WEAPON_TABLE[target.weapon].drawSec;
  inv.outbox.push({ type: 'WeaponSwitched', from: from.weapon, to: target.weapon });
  return true;
}

/**
 * BR-W-31, BR-W-32. Accepted only when not drawing, not already reloading, the magazine is
 * below capacity and the reserve is above 0. tickWeapon never calls it on a locked tick.
 */
export function requestReload(inv: WeaponInventory, now: number): boolean {
  if (!isFiniteTime(now)) return false;
  const slot = equippedSlot(inv);
  if (slot === undefined) return false;
  const status = statusOf(inv, slot, now);
  if (status === 'reloading' || status === 'drawing') return false;
  const stats = WEAPON_TABLE[slot.weapon];
  if (slot.magazine >= stats.magazineSize || slot.reserve <= 0) return false;
  inv.reloadEndsAt = now + stats.reloadSec;
  inv.scoped = false;
  inv.outbox.push({ type: 'ReloadStarted', weapon: slot.weapon, durationSec: stats.reloadSec });
  return true;
}

/** BR-W-50: scope only for a weapon that has one. tickWeapon passes false while not allowed. */
export function setScoped(inv: WeaponInventory, scoped: boolean): void {
  const slot = equippedSlot(inv);
  const hasScope = slot !== undefined && WEAPON_TABLE[slot.weapon].spreadScoped !== null;
  inv.scoped = (scoped as unknown) === true && hasScope;
}
