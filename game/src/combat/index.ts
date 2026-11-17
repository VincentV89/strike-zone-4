// Public surface of combat (LC-WC-12). Other units import only `@sz/combat`.
// bot-ai may never import it (req-bot-no-cheat). The guards in ./guards stay internal.
export type * from './types';
export {
  ARMOR_ABSORB_RATIO,
  BOT_START_VITALS,
  PLAYER_START_VITALS,
  applyDamage,
  createVitals,
} from './damage';
export { resolveShot } from './resolve-shot';
export { applyResolution } from './apply-resolution';
export type { EventSink } from './apply-resolution';
