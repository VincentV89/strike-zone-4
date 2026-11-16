import { describe, expect, it } from 'vitest';
import type { WeaponId } from '@sz/kernel';
import {
  BOT_LOADOUT,
  PLAYER_LOADOUT,
  WEAPON_TABLE,
  createInventory,
  requestReload,
  setScoped,
  switchWeapon,
  weaponView,
} from '@sz/weapons';

describe('createInventory (BR-W-10, BR-W-11, req-weapon-loadout AC4)', () => {
  it('player: rifle, pistol and sniper, all full, rifle equipped and ready at once', () => {
    const inv = createInventory(PLAYER_LOADOUT);
    expect(inv.loadout).toEqual(['rifle', 'pistol', 'sniper']);
    expect(inv.slots.map((s) => [s.weapon, s.magazine, s.reserve])).toEqual([
      ['rifle', 30, 90],
      ['pistol', 15, 45],
      ['sniper', 5, 20],
    ]);
    const view = weaponView(inv, 0, false);
    expect(view.equipped).toBe('rifle');
    expect(view.status).toBe('ready');
    expect(inv.reloadEndsAt).toBeNull();
    expect(inv.scoped).toBe(false);
    expect(inv.bloom).toBe(0);
    expect(inv.outbox).toEqual([]);
  });

  it('bot: a rifle only', () => {
    const inv = createInventory(BOT_LOADOUT);
    expect(inv.slots.map((s) => s.weapon)).toEqual(['rifle']);
  });

  it('defaults to the player loadout', () => {
    expect(createInventory().loadout).toEqual(PLAYER_LOADOUT);
  });

  it('honours a start weapon that is in the loadout', () => {
    const inv = createInventory(PLAYER_LOADOUT, 'sniper');
    expect(weaponView(inv, 0, false).equipped).toBe('sniper');
  });

  it('falls back to the first weapon when start is not owned', () => {
    const inv = createInventory(['pistol'], 'sniper');
    expect(weaponView(inv, 0, false).equipped).toBe('pistol');
  });

  it('drops duplicates and invalid ids, keeping first-seen order', () => {
    const hostile = ['sniper', 'sniper', '__proto__', 'rifle', 'RIFLE'] as unknown as WeaponId[];
    expect(createInventory(hostile).loadout).toEqual(['sniper', 'rifle']);
  });

  it.each([[[]], [null], ['rifle'], [['nope']]])('falls back to a rifle for %j', (loadout) => {
    const inv = createInventory(loadout as unknown as WeaponId[]);
    expect(inv.loadout).toEqual(['rifle']);
    expect(inv.slots[0]!.magazine).toBe(WEAPON_TABLE.rifle.magazineSize);
  });

  it('BR-W-13: inventories share no state', () => {
    const a = createInventory(BOT_LOADOUT);
    const b = createInventory(BOT_LOADOUT);
    a.slots[0]!.magazine = 3;
    expect(b.slots[0]!.magazine).toBe(30);
    expect(a.outbox).not.toBe(b.outbox);
  });
});

describe('switchWeapon (BR-W-20..22)', () => {
  it('switches by id, starts the draw and queues WeaponSwitched', () => {
    const inv = createInventory();
    expect(switchWeapon(inv, 'pistol', 1)).toBe(true);
    expect(inv.drawEndsAt).toBeCloseTo(1 + WEAPON_TABLE.pistol.drawSec, 12);
    expect(inv.outbox).toEqual([{ type: 'WeaponSwitched', from: 'rifle', to: 'pistol' }]);
    expect(weaponView(inv, 1.1, false).status).toBe('drawing');
  });

  it('next and prev cycle with wrap-around', () => {
    const inv = createInventory();
    expect(switchWeapon(inv, 'prev', 0)).toBe(true);
    expect(weaponView(inv, 5, false).equipped).toBe('sniper');
    expect(switchWeapon(inv, 'next', 0)).toBe(true);
    expect(weaponView(inv, 5, false).equipped).toBe('rifle');
    expect(switchWeapon(inv, 'next', 0)).toBe(true);
    expect(weaponView(inv, 5, false).equipped).toBe('pistol');
  });

  it('BR-W-21: the equipped weapon, an unowned weapon or a one-weapon next/prev does nothing', () => {
    const inv = createInventory();
    expect(switchWeapon(inv, 'rifle', 0)).toBe(false);
    const bot = createInventory(BOT_LOADOUT);
    expect(switchWeapon(bot, 'pistol', 0)).toBe(false);
    expect(switchWeapon(bot, 'next', 0)).toBe(false);
    expect(switchWeapon(bot, 'prev', 0)).toBe(false);
    expect(inv.outbox).toEqual([]);
    expect(bot.outbox).toEqual([]);
  });

  it('BR-W-22: cancels a reload with no ammo moved and resets scope, bloom and latches', () => {
    const inv = createInventory();
    const rifle = inv.slots[0]!;
    rifle.magazine = 20;
    expect(requestReload(inv, 1)).toBe(true);
    inv.bloom = 0.05;
    inv.triggerWasHeld = true;
    inv.dryLatched = true;
    expect(switchWeapon(inv, 'pistol', 2)).toBe(true);
    expect(inv.reloadEndsAt).toBeNull();
    expect([rifle.magazine, rifle.reserve]).toEqual([20, 90]); // req-ammo-reload AC4
    expect(inv.bloom).toBe(0);
    expect(inv.triggerWasHeld).toBe(false);
    expect(inv.dryLatched).toBe(false);
    expect(inv.scoped).toBe(false);
  });

  it.each([NaN, Infinity, -Infinity])('returns false for now = %s', (now) => {
    expect(switchWeapon(createInventory(), 'pistol', now)).toBe(false);
  });

  it.each(['__proto__', 'knife', '', 3, null])('returns false for target %j', (to) => {
    expect(switchWeapon(createInventory(), to as WeaponId, 0)).toBe(false);
  });

  it('returns false for a corrupted inventory', () => {
    const inv = createInventory();
    inv.equipped = 9;
    expect(switchWeapon(inv, 'pistol', 0)).toBe(false);
  });
});

describe('requestReload (BR-W-31, BR-W-32)', () => {
  it('accepts a partial magazine and queues ReloadStarted with the duration', () => {
    const inv = createInventory();
    inv.slots[0]!.magazine = 10;
    expect(requestReload(inv, 2)).toBe(true);
    expect(inv.reloadEndsAt).toBeCloseTo(4.5, 12);
    expect(inv.outbox).toEqual([{ type: 'ReloadStarted', weapon: 'rifle', durationSec: 2.5 }]);
  });

  it('refuses a full magazine, an empty reserve, a draw or a reload in progress', () => {
    const full = createInventory();
    expect(requestReload(full, 0)).toBe(false);

    const dry = createInventory();
    dry.slots[0]!.magazine = 0;
    dry.slots[0]!.reserve = 0;
    expect(requestReload(dry, 0)).toBe(false); // req-ammo-reload AC3

    const drawing = createInventory();
    switchWeapon(drawing, 'pistol', 0);
    drawing.slots[1]!.magazine = 1;
    expect(requestReload(drawing, 0.1)).toBe(false);

    const busy = createInventory();
    busy.slots[0]!.magazine = 1;
    expect(requestReload(busy, 0)).toBe(true);
    expect(requestReload(busy, 0.5)).toBe(false);
    expect(busy.outbox).toHaveLength(1);
  });

  it('turns the scope off', () => {
    const inv = createInventory(PLAYER_LOADOUT, 'sniper');
    setScoped(inv, true);
    inv.slots[2]!.magazine = 1;
    expect(requestReload(inv, 0)).toBe(true);
    expect(inv.scoped).toBe(false);
  });

  it('is total for a non-finite now or a corrupted inventory', () => {
    const inv = createInventory();
    inv.slots[0]!.magazine = 1;
    expect(requestReload(inv, NaN)).toBe(false);
    inv.equipped = -1;
    expect(requestReload(inv, 0)).toBe(false);
  });
});

describe('setScoped (BR-W-50)', () => {
  it('only the sniper scopes', () => {
    const inv = createInventory();
    setScoped(inv, true);
    expect(inv.scoped).toBe(false);
    switchWeapon(inv, 'sniper', 0);
    setScoped(inv, true);
    expect(inv.scoped).toBe(true);
    setScoped(inv, false);
    expect(inv.scoped).toBe(false);
  });

  it('ignores anything but a literal true, and a corrupted inventory', () => {
    const inv = createInventory(PLAYER_LOADOUT, 'sniper');
    setScoped(inv, 1 as unknown as boolean);
    expect(inv.scoped).toBe(false);
    inv.equipped = 7;
    setScoped(inv, true);
    expect(inv.scoped).toBe(false);
  });
});
