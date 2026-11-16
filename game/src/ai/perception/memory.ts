/**
 * Per-bot perception memory (LC-AI-C04). Every vector is an owned slot written component by
 * component (copy-in, SD-AI-3), so later mutation of a caller's object has no effect.
 */
import type { Vec3 } from '@sz/kernel';
import type { BotPercepts, NoiseKind } from './types';

export interface Slot {
  x: number;
  y: number;
  z: number;
}

export interface Memory {
  visibleNow: boolean;
  /** Start of the current sighting; -Infinity when there is none. */
  visibleSince: number;
  lastSeenAt: number;
  readonly lastSeenPoint: Slot;
  readonly lastSeenFeet: Slot;
  heardAt: number;
  heardKind: NoiseKind;
  readonly heardPos: Slot;
  damageAt: number;
  readonly damageDir: Slot;
  dead: boolean;
  /** Incremented on every write; drives the percepts cache. */
  version: number;
  cacheVersion: number;
  cacheMask: number;
  cache: BotPercepts | undefined;
}

export function slot(): Slot {
  return { x: 0, y: 0, z: 0 };
}

export function copyInto(dst: Slot, src: Vec3): void {
  dst.x = src.x;
  dst.y = src.y;
  dst.z = src.z;
}

/** A fresh frozen copy, for percepts handed to brain code. */
export function frozenCopy(src: Slot): Vec3 {
  return Object.freeze({ x: src.x, y: src.y, z: src.z });
}

export function createMemory(): Memory {
  return {
    visibleNow: false,
    visibleSince: -Infinity,
    lastSeenAt: -Infinity,
    lastSeenPoint: slot(),
    lastSeenFeet: slot(),
    heardAt: -Infinity,
    heardKind: 'gunfire',
    heardPos: slot(),
    damageAt: -Infinity,
    damageDir: slot(),
    dead: false,
    version: 0,
    cacheVersion: -1,
    cacheMask: -1,
    cache: undefined,
  };
}
