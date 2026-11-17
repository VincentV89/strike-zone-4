// Public surface of simulation (`@sz/sim`). Re-exports only.
export { createSim } from './sim';
export type { SimStats, Simulation } from './sim';
export type { SimulationDeps } from './state';
export type { SimGates } from './step';
export type { SimPhysicsPort } from './ports';
export type { BotErrorReporter } from './containment';
export type { SpawnError } from './spawn';
export type { SimSnapshot, SnapshotBot, SnapshotPlayer } from './snapshot';
export { SIM_RULES } from './rules';
export { copyEvent } from './events';
export {
  BOT_WEAPON_SALT,
  PLAYER_WEAPON_SALT,
  SPAWN_SALT,
  botWeaponSeed,
  brainSeed,
  playerWeaponSeed,
  spawnSeed,
} from './seeds';
// round may not import @sz/player; it receives the intent types through sim.
export type { LookDelta, PlayerInputIntent } from '@sz/player';
