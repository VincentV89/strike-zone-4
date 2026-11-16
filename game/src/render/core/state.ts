/**
 * The pure presentation state owned by core (LC-R-8). Everything is allocated once in
 * createPresentationState and reused for the page lifetime (PD-R-5): actor slots, effect pools,
 * instance buffers, viewmodel and camera scratch.
 */
import { RIG_PARTS } from '@sz/assets/core/rig-parts';
import { BOT_CAPACITY, createActorSet, type ActorSet } from './actors';
import { createInstanceBuffer, type InstanceBuffer } from './buffers';
import { createCameraPose, type CameraPose } from './camera';
import { createPool, setCap, type EffectPool } from './pool';
import { MAX_CAPS, presetOrMedium, type PresetRow } from './presets';
import { DEFAULT_SETTINGS, type RenderSettings } from './types';
import {
  createViewmodelPose,
  createViewmodelState,
  type ViewmodelPose,
  type ViewmodelState,
} from './viewmodel';

export type EffectKind = 'decal' | 'puff' | 'spark' | 'muzzle';
export const EFFECT_KINDS: ReadonlyArray<EffectKind> = Object.freeze([
  'decal',
  'puff',
  'spark',
  'muzzle',
]);

export interface EffectSet {
  readonly decal: EffectPool;
  readonly puff: EffectPool;
  readonly spark: EffectPool;
  readonly muzzle: EffectPool;
}

export interface EffectBuffers {
  readonly decal: InstanceBuffer;
  readonly puff: InstanceBuffer;
  readonly spark: InstanceBuffer;
  readonly muzzle: InstanceBuffer;
}

export interface PresentationState {
  /** Presentation clock, seconds; advances only when not paused (BR-R-14). */
  t: number;
  settings: RenderSettings;
  preset: PresetRow;
  readonly actors: ActorSet;
  readonly effects: EffectSet;
  readonly effectBuffers: EffectBuffers;
  /** Indexed like RIG_PARTS. */
  readonly botNear: ReadonlyArray<InstanceBuffer>;
  readonly botFar: ReadonlyArray<InstanceBuffer>;
  readonly viewmodel: ViewmodelState;
  readonly vmPose: ViewmodelPose;
  readonly camera: CameraPose;
  /** Presentation time the player died, or -1. */
  playerDeathStart: number;
  /** Frames rendered since the last beginRound. */
  frames: number;
  /** Effect acquisitions since creation (alloc tests read it). */
  acquisitions: number;
}

export function createPresentationState(
  settings: RenderSettings = DEFAULT_SETTINGS,
): PresentationState {
  const botBuffers = (): InstanceBuffer[] =>
    RIG_PARTS.map((p) => createInstanceBuffer(BOT_CAPACITY * p.perBot));
  const preset = presetOrMedium(settings.preset);
  const s: PresentationState = {
    t: 0,
    settings,
    preset,
    actors: createActorSet(),
    effects: {
      decal: createPool(MAX_CAPS.decal),
      puff: createPool(MAX_CAPS.puff),
      spark: createPool(MAX_CAPS.spark),
      muzzle: createPool(MAX_CAPS.muzzle),
    },
    effectBuffers: {
      decal: createInstanceBuffer(MAX_CAPS.decal),
      puff: createInstanceBuffer(MAX_CAPS.puff),
      spark: createInstanceBuffer(MAX_CAPS.spark),
      muzzle: createInstanceBuffer(MAX_CAPS.muzzle),
    },
    botNear: botBuffers(),
    botFar: botBuffers(),
    viewmodel: createViewmodelState(),
    vmPose: createViewmodelPose(),
    camera: createCameraPose(),
    playerDeathStart: -1,
    frames: 0,
    acquisitions: 0,
  };
  applyCaps(s);
  return s;
}

/** Pool caps follow the preset; lowering retires the oldest, raising allocates nothing. */
export function applyCaps(s: PresentationState): void {
  setCap(s.effects.decal, s.preset.caps.decal);
  setCap(s.effects.puff, s.preset.caps.puff);
  setCap(s.effects.spark, s.preset.caps.spark);
  setCap(s.effects.muzzle, s.preset.caps.muzzle);
}
