/**
 * Cue table and fixed tuning constants (domain-entities-game-audio "Cue table").
 *
 * Every table indexed by outside data is a Map, so '__proto__' or 'constructor'
 * finds nothing (SD-A-3).
 */
import type { WeaponId } from '@sz/kernel';
import type { CueCategory, CueDefinition, SoundCue } from './types';

const NO_LIMIT = Number.POSITIVE_INFINITY;

function cue(
  id: SoundCue,
  category: CueCategory,
  priority: number,
  gainDb: number,
  shape: {
    readonly spatial?: number;
    readonly variants?: number;
    readonly durationSec: number;
    readonly retriggerSec?: number;
    readonly pitchJitter?: number;
  },
): CueDefinition {
  return Object.freeze({
    id,
    category,
    bus: category === 'ui' ? 'ui' : 'sfx',
    priority,
    gainDb,
    spatialAllowed: shape.spatial !== undefined,
    maxRangeM: shape.spatial ?? NO_LIMIT,
    variants: shape.variants ?? 1,
    durationSec: shape.durationSec,
    retriggerSec: shape.retriggerSec ?? 0,
    pitchJitter: shape.pitchJitter ?? 0,
  });
}

/** Fixed order: the bank seed uses the index (BR-A-61), so never reorder existing rows. */
export const CUE_DEFINITIONS: ReadonlyArray<CueDefinition> = Object.freeze([
  cue('fire-rifle', 'gunfire', 4, -6, {
    spatial: 90,
    variants: 3,
    durationSec: 0.35,
    pitchJitter: 0.03,
  }),
  cue('fire-pistol', 'gunfire', 4, -7, {
    spatial: 90,
    variants: 3,
    durationSec: 0.25,
    pitchJitter: 0.03,
  }),
  cue('fire-sniper', 'gunfire', 4, -3, {
    spatial: 90,
    variants: 2,
    durationSec: 0.9,
    pitchJitter: 0.02,
  }),
  cue('dry-fire', 'weapon', 3, -14, { durationSec: 0.06, retriggerSec: 0.08 }),
  cue('reload-start', 'weapon', 3, -12, {
    durationSec: 0.25,
    retriggerSec: 0.05,
    pitchJitter: 0.02,
  }),
  cue('reload-end', 'weapon', 3, -12, { durationSec: 0.2, retriggerSec: 0.05, pitchJitter: 0.02 }),
  cue('hit-body', 'feedback', 4, -10, { durationSec: 0.12, retriggerSec: 0.03 }),
  cue('hit-head', 'feedback', 4, -8, { durationSec: 0.18, retriggerSec: 0.03 }),
  cue('enemy-death', 'feedback', 4, -9, {
    durationSec: 0.4,
    retriggerSec: 0.05,
    pitchJitter: 0.02,
  }),
  cue('player-hurt', 'feedback', 4, -8, {
    variants: 2,
    durationSec: 0.3,
    retriggerSec: 0.08,
    pitchJitter: 0.02,
  }),
  cue('footstep', 'footstep', 2, -16, {
    spatial: 25,
    variants: 4,
    durationSec: 0.12,
    retriggerSec: 0.12,
    pitchJitter: 0.06,
  }),
  cue('victory', 'sting', 5, -6, { durationSec: 1.6, retriggerSec: 0.5 }),
  cue('defeat', 'sting', 5, -6, { durationSec: 1.6, retriggerSec: 0.5 }),
  cue('ui-click', 'ui', 5, -12, { durationSec: 0.05, retriggerSec: 0.03 }),
]);

export const SOUND_CUES: ReadonlyArray<SoundCue> = Object.freeze(CUE_DEFINITIONS.map((d) => d.id));

export const CUE_TABLE: ReadonlyMap<SoundCue, CueDefinition> = new Map(
  CUE_DEFINITIONS.map((d) => [d.id, d] as const),
);

/** Own-key lookup for a caller-supplied cue id (SD-A-3). */
export function cueDefinition(id: unknown): CueDefinition | undefined {
  return typeof id === 'string' ? CUE_TABLE.get(id as SoundCue) : undefined;
}

/** BR-A-31: total and per-category voice limits. */
export const MAX_VOICES = 24;
export const CATEGORY_CAPS: ReadonlyMap<CueCategory, number> = new Map<CueCategory, number>([
  ['gunfire', 10],
  ['weapon', 3],
  ['feedback', 4],
  ['footstep', 6],
  ['sting', 1],
  ['ui', 3],
]);

export const FIRE_CUE_BY_WEAPON: ReadonlyMap<WeaponId, SoundCue> = new Map<WeaponId, SoundCue>([
  ['rifle', 'fire-rifle'],
  ['pistol', 'fire-pistol'],
  ['sniper', 'fire-sniper'],
]);

/** BR-A-28: sprint footsteps are +3 dB. The largest gainScale the router emits. */
export const SPRINT_GAIN_SCALE = 1.41;

/** BR-A-15: fixed PannerNode attributes (plain attributes, set only from these constants). */
export const PANNER_SETTINGS = Object.freeze({
  panningModel: 'equalpower',
  distanceModel: 'inverse',
  refDistance: 2,
  rolloffFactor: 1,
  maxDistance: 90,
} as const);

/** BR-A-46: limiter-style compressor after both buses. */
export const COMPRESSOR_SETTINGS = Object.freeze({
  thresholdDb: -6,
  knee: 6,
  ratio: 12,
  attackSec: 0.003,
  releaseSec: 0.15,
});

/** BR-A-37: presentation Rng seed for pitch jitter and variant starts. */
export const PLAYBACK_SEED = 0x5a17;
