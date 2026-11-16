// Entry guards and masks for combat (ADR-WC-6, LC-WC-08). Internal: not re-exported.
import { Layer, mask, type CollisionMask } from '@sz/kernel';
import type { Side } from './types';

/** Non-finite, negative or zero → 0; otherwise a rounded safe integer (SEC-WC-05, BR-C-11). */
export function toCount(x: unknown): number {
  if (typeof x !== 'number' || !Number.isFinite(x) || x <= 0) return 0;
  return Math.min(Math.round(x), Number.MAX_SAFE_INTEGER);
}

const PLAYER_SHOT_MASK = mask(Layer.WORLD, Layer.BOT_HEAD, Layer.BOT_BODY);
const BOT_SHOT_MASK = mask(
  Layer.WORLD,
  Layer.PLAYER_HEAD,
  Layer.PLAYER_BODY,
  Layer.BOT_HEAD,
  Layer.BOT_BODY,
);

/**
 * BR-C-02: the player's shots hit world and bots. A bot's shots also include other bots so
 * that a bot in the line of fire blocks the shot. Derived from the actor record, never the request.
 */
export function shotMaskFor(side: Side): CollisionMask {
  return side === 'player' ? PLAYER_SHOT_MASK : BOT_SHOT_MASK;
}
