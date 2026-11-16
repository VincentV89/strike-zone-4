// Public surface of weapons (LC-WC-12). Other units import only `@sz/weapons`.
// The entry guards in ./guards stay internal (ADR-WC-6).
export type * from './types';
export { TIME_EPS, WEAPON_TABLE, weaponStats } from './weapon-table';
export type { FireMode, WeaponStats } from './weapon-table';
export { BOT_LOADOUT, PLAYER_LOADOUT, createInventory } from './inventory';
export { requestReload, setScoped, switchWeapon } from './commands';
export { currentSpread, sampleCone } from './spread';
export { tickWeapon } from './tick-weapon';
export { weaponView } from './weapon-view';
