import { isWeaponId, type WeaponId } from '@sz/kernel';
import type { WeaponInventory, WeaponSlot, WeaponStatus } from './types';
import { TIME_EPS, WEAPON_TABLE } from './weapon-table';

/** BR-W-10: the player carries all three weapons and starts with the rifle. */
export const PLAYER_LOADOUT: ReadonlyArray<WeaponId> = Object.freeze(['rifle', 'pistol', 'sniper']);
/** BR-W-10: every bot carries a rifle only (Q3, req-bot-independence). */
export const BOT_LOADOUT: ReadonlyArray<WeaponId> = Object.freeze(['rifle']);

const FALLBACK_LOADOUT: ReadonlyArray<WeaponId> = BOT_LOADOUT;

/** Valid ids in first-seen order, duplicates dropped; `['rifle']` if nothing valid remains. */
function cleanLoadout(loadout: unknown): ReadonlyArray<WeaponId> {
  if (!Array.isArray(loadout)) return FALLBACK_LOADOUT;
  const seen: WeaponId[] = [];
  for (const id of loadout as ReadonlyArray<unknown>) {
    if (isWeaponId(id) && !seen.includes(id)) seen.push(id);
  }
  return seen.length > 0 ? Object.freeze(seen) : FALLBACK_LOADOUT;
}

function fullSlot(weapon: WeaponId): WeaponSlot {
  const stats = WEAPON_TABLE[weapon];
  return { weapon, magazine: stats.magazineSize, reserve: stats.reserveStart, nextFireAt: 0 };
}

/**
 * New inventory with every slot full, ready at once, not reloading or scoped (BR-W-11).
 * A `start` that is not in the loadout falls back to the first weapon (BR-W-30 fallback).
 */
export function createInventory(
  loadout: ReadonlyArray<WeaponId> = PLAYER_LOADOUT,
  start?: WeaponId,
): WeaponInventory {
  const ids = cleanLoadout(loadout);
  const startIndex = Math.max(0, ids.indexOf(start as WeaponId));
  return {
    loadout: ids,
    slots: ids.map(fullSlot),
    equipped: startIndex,
    drawEndsAt: 0,
    reloadEndsAt: null,
    scoped: false,
    bloom: 0,
    lastShotAt: -Infinity,
    triggerWasHeld: false,
    dryLatched: false,
    outbox: [],
  };
}

/** The equipped slot, or undefined for a corrupted inventory (callers then no-op). */
export function equippedSlot(inv: WeaponInventory): WeaponSlot | undefined {
  return inv.slots[inv.equipped];
}

/** Derived status, checked in order: reloading, drawing, cooldown, ready. */
export function statusOf(inv: WeaponInventory, slot: WeaponSlot, now: number): WeaponStatus {
  if (inv.reloadEndsAt !== null) return 'reloading';
  if (now < inv.drawEndsAt - TIME_EPS) return 'drawing';
  if (now < slot.nextFireAt - TIME_EPS) return 'cooldown';
  return 'ready';
}
