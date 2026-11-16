import type { PlayerInputIntent } from '@sz/player';
import type { TriggerIntent } from '@sz/weapons';

/**
 * Player intent → weapon trigger (business-logic-model §3, LC-ML-09). Builds a fresh object.
 * `fire` is held fire or a press edge: weapons does the semi-auto edge detection itself from
 * its triggerWasHeld state, and the edge keeps a click that pressed and released within one
 * frame from being lost. weapons validates switchTo with Object.hasOwn (ADR-WC-6).
 */
export function playerTrigger(intent: PlayerInputIntent): TriggerIntent {
  const base = {
    fire: intent.fire || intent.firePressed,
    reload: intent.reload,
    scope: intent.aim,
  };
  return intent.switchTo === null ? base : { ...base, switchTo: intent.switchTo };
}
