import { describe, expect, it } from 'vitest';
import {
  PLAYER_LOADOUT,
  WEAPON_TABLE,
  createInventory,
  requestReload,
  switchWeapon,
  weaponView,
} from '@sz/weapons';

describe('weaponView (domain-entities WeaponView)', () => {
  it('lists every owned slot and the equipped weapon status', () => {
    const inv = createInventory();
    inv.slots[1]!.magazine = 4;
    const view = weaponView(inv, 0, false);
    expect(view.owned).toEqual([
      { weapon: 'rifle', magazine: 30, reserve: 90 },
      { weapon: 'pistol', magazine: 4, reserve: 45 },
      { weapon: 'sniper', magazine: 5, reserve: 20 },
    ]);
    expect([view.status, view.progress, view.scoped]).toEqual(['ready', 1, false]);
    expect(view.spread).toBe(WEAPON_TABLE.rifle.spreadBase);
  });

  it('reports reload progress from 0 to 1', () => {
    const inv = createInventory();
    inv.slots[0]!.magazine = 1;
    requestReload(inv, 10);
    expect(weaponView(inv, 10, false).progress).toBe(0);
    expect(weaponView(inv, 11.25, false).progress).toBeCloseTo(0.5, 12);
    const late = weaponView(inv, 99, false);
    expect([late.status, late.progress]).toEqual(['reloading', 1]);
  });

  it('reports draw progress and the cooldown status', () => {
    const inv = createInventory();
    switchWeapon(inv, 'sniper', 0);
    expect(weaponView(inv, 0.45, false)).toMatchObject({ status: 'drawing', equipped: 'sniper' });
    expect(weaponView(inv, 0.45, false).progress).toBeCloseTo(0.5, 12);
    inv.slots[2]!.nextFireAt = 5;
    expect(weaponView(inv, 2, false)).toMatchObject({ status: 'cooldown', progress: 1 });
  });

  it('the moving flag widens the reported spread', () => {
    const inv = createInventory(PLAYER_LOADOUT, 'pistol');
    expect(weaponView(inv, 0, true).spread).toBeGreaterThan(weaponView(inv, 0, false).spread);
    expect(weaponView(inv, 0, 'yes' as unknown as boolean).spread).toBe(
      WEAPON_TABLE.pistol.spreadBase,
    );
  });

  it('is total: non-finite now reads as 0, a corrupted inventory gives an empty view', () => {
    const inv = createInventory();
    expect(weaponView(inv, NaN, false).status).toBe('ready');
    inv.equipped = 5;
    expect(weaponView(inv, 0, false)).toMatchObject({ magazine: 0, reserve: 0, owned: [] });
  });

  it('does not mutate the inventory', () => {
    const inv = createInventory();
    const before = JSON.stringify(inv);
    weaponView(inv, 3, true);
    expect(JSON.stringify(inv)).toBe(before);
  });
});
