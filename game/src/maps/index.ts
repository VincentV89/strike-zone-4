// Public surface of map-catalog (`@sz/maps`).
export type * from './types';
export { createMapCatalog } from './catalog';
export { MAP_LIMITS, validateMap } from './validate';
export { SPAWN_RULES, selectSpawns } from './spawns';
export { collidersToRadarSegments } from './radar';
export {
  RAMP_THICKNESS,
  box,
  boundaryRing,
  chain,
  coverBeside,
  crate,
  crateStack,
  linkChain,
  node,
  ramp,
  wall,
} from './build';
export { footprint2d, quatFromYawPitch, rotateYawPitch, solidCorners, solidTop } from './geometry';
export type { Quat } from './geometry';
export { desertCompound } from './desert-compound';
export { industrialWarehouse } from './industrial-warehouse';
