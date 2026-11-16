/**
 * Render input and settings types (FD-R-3, FD-R-4). Every input is readonly: render only reads
 * frozen snapshots and drained events (BR-R-01, SD-R-2).
 */
import type { DomainEvent } from '@sz/kernel';
import type { SimSnapshot } from '@sz/sim';

export type PresetId = 'low' | 'medium' | 'high';

export interface RenderSettings {
  readonly preset: PresetId;
  /** Horizontal FOV in degrees, clamped to [60, 110] (FD-R-1). */
  readonly fovDeg: number;
  readonly reducedMotion: boolean;
}

export interface RenderFrame {
  readonly prev: SimSnapshot | undefined;
  readonly curr: SimSnapshot | undefined;
  /** FixedClock alpha in [0, 1). */
  readonly alpha: number;
  /** Everything drained from the bus this frame, not curr.events (BR-R-15). */
  readonly events: ReadonlyArray<DomainEvent>;
  /** Wall frame time; clamped to [0, 0.1]. */
  readonly dtSec: number;
  /** Pause or context loss. The end-of-round hold passes false (BR-R-14). */
  readonly paused: boolean;
}

export const DEFAULT_SETTINGS: RenderSettings = Object.freeze({
  preset: 'medium',
  fovDeg: 90,
  reducedMotion: false,
});
