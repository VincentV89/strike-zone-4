// Public surface of bot-ai (`@sz/ai`). Re-exports only; input guards stay internal.
export type * from './types';
export { AI_RULES } from './rules';
export { DIFFICULTY_TABLE, difficultyParams } from './difficulty';
export { TRANSITIONS, rowsFrom } from './transitions';
export { GUARD_IDS } from './fsm-guards';
export { createSquadBoard } from './squad-board';
export { createBotSight, createBotWorldView } from './world-view';
export type { BotWorldDeps } from './world-view';
export { createScheduler, seedFor } from './scheduler';
export type { AiScheduler } from './scheduler';
export { IDLE_TRIGGER, ZERO_INTENT, boundIntent, holdDecision, zeroIntent } from './intent-bounds';
export { aimWithError } from './aim';
export { createBrain, entered, markDead, stateOf } from './brain';
export type { BotBrain, BrainOptions, Phase } from './brain';
export { decide } from './decide';
export { tick } from './tick';
