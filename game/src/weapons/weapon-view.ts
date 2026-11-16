import { clamp } from '@sz/kernel';
import { equippedSlot, statusOf } from './inventory';
import { currentSpread } from './spread';
import type { WeaponInventory, WeaponStatus, WeaponView } from './types';
import { WEAPON_TABLE, type WeaponStats } from './weapon-table';

function progressOf(
  inv: WeaponInventory,
  stats: WeaponStats,
  status: WeaponStatus,
  now: number,
): number {
  if (status === 'reloading' && inv.reloadEndsAt !== null) {
    return clamp((now - (inv.reloadEndsAt - stats.reloadSec)) / stats.reloadSec, 0, 1);
  }
  if (status === 'drawing') {
    return clamp((now - (inv.drawEndsAt - stats.drawSec)) / stats.drawSec, 0, 1);
  }
  return 1;
}

const EMPTY_VIEW: WeaponView = Object.freeze({
  equipped: 'rifle',
  magazine: 0,
  reserve: 0,
  status: 'ready',
  progress: 1,
  scoped: false,
  spread: 0,
  owned: Object.freeze([]),
});

/**
 * Read model of one inventory (domain-entities-weapons-combat WeaponView). This is the only
 * read path for SimSnapshot weapon fields, the HUD, bot-ai and the viewmodel. Callers never
 * mutate the inventory. A non-finite `now` reads as 0.
 */
export function weaponView(inv: WeaponInventory, now: number, moving: boolean): WeaponView {
  const slot = equippedSlot(inv);
  if (slot === undefined) return EMPTY_VIEW;
  const t = Number.isFinite(now) ? now : 0;
  const stats = WEAPON_TABLE[slot.weapon];
  const status = statusOf(inv, slot, t);
  return {
    equipped: slot.weapon,
    magazine: slot.magazine,
    reserve: slot.reserve,
    status,
    progress: progressOf(inv, stats, status, t),
    scoped: inv.scoped,
    spread: currentSpread(inv, stats, (moving as unknown) === true),
    owned: inv.slots.map((s) => ({ weapon: s.weapon, magazine: s.magazine, reserve: s.reserve })),
  };
}
