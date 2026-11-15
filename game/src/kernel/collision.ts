import type { CollisionMask } from './types';

/**
 * Collision layers over 16 bits (Rapier interaction groups use 16-bit membership
 * and filter halves). 5 of 16 bits are used (SCAL-K-03).
 */
export const Layer = {
  WORLD: 0x0001,
  PLAYER_HEAD: 0x0002,
  PLAYER_BODY: 0x0004,
  BOT_HEAD: 0x0008,
  BOT_BODY: 0x0010,
} as const;

export type LayerBit = (typeof Layer)[keyof typeof Layer];

export function mask(...layers: ReadonlyArray<LayerBit>): CollisionMask {
  let bits = 0;
  for (const layer of layers) bits |= layer;
  return bits as CollisionMask;
}

/** Sight, nav clearance and movement. */
export const MASK_WORLD: CollisionMask = mask(Layer.WORLD);

/** Hitscan against the world and every hitbox. Combat narrows it per shooter. */
export const MASK_SHOT_ALL: CollisionMask = mask(
  Layer.WORLD,
  Layer.PLAYER_HEAD,
  Layer.PLAYER_BODY,
  Layer.BOT_HEAD,
  Layer.BOT_BODY,
);

export function includes(m: CollisionMask, layer: LayerBit): boolean {
  return (m & layer) !== 0;
}
