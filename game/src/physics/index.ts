// Public surface of physics-adapter (`@sz/physics`). Guards and the fault reporter are internal.
export type * from './types';
export { BootError } from './types';
export {
  CONTROLLER_TUNING,
  DEFAULT_CAPSULE,
  DEFAULT_CHARACTER,
  DEFAULT_HITBOXES,
  EYE_HEIGHT,
  MAX_CHARACTERS,
  PHYSICS_STEP_SEC,
} from './constants';
export { initPhysics } from './rapier';
export { createPhysicsWorld } from './world';
export { createPhysicsHost } from './host';
