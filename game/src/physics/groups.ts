/**
 * Rapier interaction groups (business-logic-model-world-maps, "Collision groups"): a u32 of
 * (membership << 16) | filter. Two colliders interact when each one's membership matches the
 * other's filter.
 */
import { Layer } from '@sz/kernel';

/** Every kernel layer bit. Query masks are clamped to this (SD-WM-8). */
export const LAYER_ALL = 0x001f;
/** Adapter-only bit for character capsules; no kernel mask can select it (BR-WM-53). */
export const CHARACTER = 0x0020;
const ALL = 0xffff;

export function groups(membership: number, filter: number): number {
  return (((membership & ALL) << 16) | (filter & ALL)) >>> 0;
}

export const GROUPS = Object.freeze({
  world: groups(Layer.WORLD, ALL),
  capsule: groups(CHARACTER, Layer.WORLD),
  /** Controller movement query: as a character, against WORLD only. */
  controllerQuery: groups(CHARACTER, Layer.WORLD),
  /** Sight and overlap queries: WORLD only. */
  worldQuery: groups(ALL, Layer.WORLD),
});

export function hitboxGroups(layer: number): number {
  return groups(layer, ALL);
}

/** Query groups for a kernel collision mask, already clamped to LAYER_ALL. */
export function queryGroups(clampedMask: number): number {
  return groups(ALL, clampedMask);
}
