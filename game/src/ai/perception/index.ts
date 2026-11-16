// Public surface of perception (`@sz/ai/perception`). Re-exports only; the guards stay internal.
export type * from './types';
export { PERCEPTION_RULES } from './rules';
export { EMPTY_PERCEPTS } from './percepts';
export { createPerceptionSystem, createTargetSample } from './system';
export type { PerceptionOptions } from './system';
