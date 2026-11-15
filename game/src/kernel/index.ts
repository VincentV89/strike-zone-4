// Public surface of the kernel. Other units import only `@sz/kernel` (BR-K-05).
export type * from './types';
export * from './constants';
export { ok, err } from './result';
export {
  BOT_COUNTS,
  BOT_STATES,
  DIFFICULTIES,
  MAP_IDS,
  ROUND_PHASES,
  WEAPON_IDS,
  isBotCount,
  isDifficulty,
  isMapId,
  isWeaponId,
} from './enums';
export { PLAYER_ID, botIds, isBotId, parseActorId } from './ids';
export { DEFAULT_MATCH_SETUP, parseMatchSetup } from './match-setup';
export type { MatchSetupError } from './match-setup';
export {
  UP,
  ZERO,
  add,
  cross,
  distance,
  distanceSq,
  dot,
  horizontal,
  isFiniteVec,
  length,
  lengthSq,
  lerp,
  normalize,
  scale,
  sub,
  vec3,
} from './vec3';
export {
  angleBetween,
  clamp,
  degToRad,
  dirFromYawPitch,
  radToDeg,
  wrapAngle,
  yawOf,
} from './angles';
export { Layer, MASK_SHOT_ALL, MASK_WORLD, includes, mask } from './collision';
export type { LayerBit } from './collision';
export { createFixedClock } from './clock';
export type { FixedClockOptions } from './clock';
export { createEventBus } from './event-bus';
export type { EventBusOptions, SubscriberErrorHandler } from './event-bus';
export { createRng } from './rng';
