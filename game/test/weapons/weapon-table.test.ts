import { describe, expect, it } from 'vitest';
import { STEP_SEC, WEAPON_IDS, degToRad } from '@sz/kernel';
import { WEAPON_TABLE, weaponStats, type WeaponStats } from '@sz/weapons';

const rows: WeaponStats[] = WEAPON_IDS.map((id) => WEAPON_TABLE[id]);
const { rifle, pistol, sniper } = WEAPON_TABLE;

const NUMERIC_FIELDS = [
  'damage',
  'headMultiplier',
  'fireIntervalSec',
  'magazineSize',
  'reserveStart',
  'reloadSec',
  'drawSec',
  'rangeM',
  'spreadBase',
  'spreadMovePenalty',
  'bloomPerShot',
  'bloomMax',
  'spreadMax',
  'recoveryDelaySec',
  'recoveryRate',
  'kickPitch',
  'kickYawMax',
  'noiseRadiusM',
] as const;

function deepFrozen(x: unknown): boolean {
  if (typeof x !== 'object' || x === null) return true;
  if (!Object.isFrozen(x)) return false;
  return Object.values(x).every(deepFrozen);
}

describe('WEAPON_TABLE invariants (BR-W-01..08, req-weapon-loadout)', () => {
  it('BR-W-02: exactly one row per WeaponId, and row.id equals its key', () => {
    expect(Object.keys(WEAPON_TABLE).sort()).toEqual([...WEAPON_IDS].sort());
    for (const id of WEAPON_IDS) expect(WEAPON_TABLE[id].id).toBe(id);
  });

  it.each(rows)('BR-W-03: $id numbers are finite and in range', (row) => {
    for (const f of NUMERIC_FIELDS) expect(Number.isFinite(row[f]), f).toBe(true);
    expect(Number.isInteger(row.damage) && row.damage > 0).toBe(true);
    expect(Number.isInteger(row.magazineSize) && row.magazineSize > 0).toBe(true);
    expect(Number.isInteger(row.reserveStart) && row.reserveStart > 0).toBe(true);
    expect(row.headMultiplier).toBeGreaterThanOrEqual(1);
    for (const f of [
      'fireIntervalSec',
      'reloadSec',
      'drawSec',
      'rangeM',
      'noiseRadiusM',
    ] as const) {
      expect(row[f], f).toBeGreaterThan(0);
    }
    for (const f of ['bloomPerShot', 'bloomMax', 'kickPitch', 'kickYawMax'] as const) {
      expect(row[f], f).toBeGreaterThanOrEqual(0);
    }
  });

  it('BR-W-04: distinct behaviour between the three weapons', () => {
    expect(rows.filter((r) => r.fireMode === 'auto').map((r) => r.id)).toEqual(['rifle']);
    expect(pistol.fireMode).toBe('semi');
    expect(sniper.fireMode).toBe('semi');
    expect(pistol.damage).toBeLessThan(rifle.damage);
    expect(rifle.damage).toBeLessThan(sniper.damage);
    expect(rifle.fireIntervalSec).toBeLessThan(pistol.fireIntervalSec);
    expect(pistol.fireIntervalSec).toBeLessThan(sniper.fireIntervalSec);
    expect(pistol.reloadSec).toBeLessThan(rifle.reloadSec);
    expect(rifle.reloadSec).toBeLessThan(sniper.reloadSec);
    expect(sniper.magazineSize).toBeLessThan(Math.min(rifle.magazineSize, pistol.magazineSize));
  });

  it('BR-W-05: only the sniper has a scope, and scoped spread is tighter', () => {
    expect(rows.filter((r) => r.spreadScoped !== null).map((r) => r.id)).toEqual(['sniper']);
    expect(rows.filter((r) => r.scopedFovDeg !== null).map((r) => r.id)).toEqual(['sniper']);
    expect(sniper.spreadScoped).not.toBeNull();
    expect(sniper.spreadScoped!).toBeLessThan(sniper.spreadBase);
    expect(sniper.scopedFovDeg).toBe(25);
  });

  it('BR-W-06: an auto weapon recovers more slowly than it fires', () => {
    for (const r of rows.filter((x) => x.fireMode === 'auto')) {
      expect(r.recoveryDelaySec).toBeGreaterThan(r.fireIntervalSec);
    }
  });

  it.each(rows)('BR-W-07: $id movement penalty and bloom fit under spreadMax', (r) => {
    expect(r.spreadBase + r.spreadMovePenalty).toBeLessThanOrEqual(r.spreadMax);
    expect(r.bloomMax).toBeLessThanOrEqual(r.spreadMax);
    // Moving is strictly wider than standing even at full bloom (req-recoil-spread AC3).
    expect(r.spreadBase + r.bloomMax).toBeLessThan(r.spreadMax);
  });

  it.each(rows)('BR-W-08: $id head damage is an integer', (r) => {
    expect(Number.isInteger(r.damage * r.headMultiplier)).toBe(true);
  });

  it('Q3 values: rifle 28 / 112, pistol 22 / 88, sniper 90 / 360; magazines 30, 15, 5', () => {
    expect([rifle.damage * rifle.headMultiplier, rifle.damage]).toEqual([112, 28]);
    expect([pistol.damage * pistol.headMultiplier, pistol.damage]).toEqual([88, 22]);
    expect([sniper.damage * sniper.headMultiplier, sniper.damage]).toEqual([360, 90]);
    expect([rifle.magazineSize, pistol.magazineSize, sniper.magazineSize]).toEqual([30, 15, 5]);
    expect([rifle.reserveStart, pistol.reserveStart, sniper.reserveStart]).toEqual([90, 45, 20]);
  });

  it('angular fields are stored in radians', () => {
    expect(rifle.spreadBase).toBeCloseTo(degToRad(0.4), 12);
    expect(sniper.spreadScoped!).toBeCloseTo(degToRad(0.05), 12);
  });

  it.each(rows)('SEC-WC-13: $id has spreadBase > 0, so no shot is perfectly accurate', (r) => {
    expect(r.spreadBase).toBeGreaterThan(0);
  });

  it.each(rows)('PERF-WC-04: $id fires and draws slower than once per 5 ticks', (r) => {
    expect(r.fireIntervalSec).toBeGreaterThan(5 * STEP_SEC);
    expect(r.drawSec).toBeGreaterThan(5 * STEP_SEC);
  });

  it('SEC-WC-31: ids are generic lowercase words', () => {
    for (const r of rows) expect(r.id).toMatch(/^[a-z]+$/);
  });

  it('SEC-WC-20: the table and every row are deep-frozen', () => {
    expect(deepFrozen(WEAPON_TABLE)).toBe(true);
    expect(() => {
      (rifle as { damage: number }).damage = 999;
    }).toThrow(TypeError);
    expect(rifle.damage).toBe(28);
  });
});

describe('weaponStats accessor (SEC-WC-03)', () => {
  it.each(['rifle', 'pistol', 'sniper'] as const)('returns the row for %s', (id) => {
    expect(weaponStats(id)).toBe(WEAPON_TABLE[id]);
  });

  it.each([
    '__proto__',
    'constructor',
    'toString',
    'hasOwnProperty',
    '',
    'RIFLE',
    1,
    null,
    undefined,
    {},
  ])('returns undefined for %j', (id) => {
    expect(weaponStats(id)).toBeUndefined();
  });
});
