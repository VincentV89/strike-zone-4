/**
 * Pure play-request planning (business-logic-model-game-audio W7, first half).
 *
 * Validates every caller value before the adapter touches Web Audio (SD-A-2):
 * unknown cue, non-finite `at` or non-finite gainScale → null (BR-A-10).
 */
import { vec3, type Vec3 } from '@sz/kernel';
import { cueDefinition } from './cues';
import { inRange, isFinitePosition } from './listener';
import { voiceGain } from './mixer';
import type { CueDefinition, ListenerPose } from './types';

export interface PlayPlan {
  readonly def: CueDefinition;
  /** Present only for spatial voices (BR-A-13). */
  readonly at?: Vec3;
  readonly gain: number;
  readonly key: string;
  readonly priority: number;
}

const MAX_KEY_LENGTH = 32;

function readOptions(opts: unknown): { readonly gainScale: unknown; readonly key: unknown } {
  if (typeof opts !== 'object' || opts === null) return { gainScale: 1, key: undefined };
  const o = opts as { readonly gainScale?: unknown; readonly key?: unknown };
  return { gainScale: o.gainScale === undefined ? 1 : o.gainScale, key: o.key };
}

function readKey(key: unknown, fallback: string): string {
  return typeof key === 'string' && key.length > 0 && key.length <= MAX_KEY_LENGTH ? key : fallback;
}

export function planPlay(
  cue: unknown,
  at: unknown,
  opts: unknown,
  listener: ListenerPose,
): PlayPlan | null {
  const def = cueDefinition(cue);
  if (def === undefined) return null;
  const o = readOptions(opts);
  const gain = voiceGain(def.gainDb, o.gainScale);
  if (gain === null) return null;
  let pos: Vec3 | undefined;
  if (at !== undefined) {
    if (!isFinitePosition(at)) return null;
    pos = at;
  }
  const base = { def, gain, key: readKey(o.key, def.id) };
  // BR-A-13: `at` is ignored for cues that are not spatial.
  if (pos === undefined || !def.spatialAllowed) return { ...base, priority: def.priority };
  if (!inRange(listener, pos, def.maxRangeM)) return null; // BR-A-14
  return { ...base, at: vec3(pos.x, pos.y, pos.z), priority: def.priority - 1 }; // BR-A-32
}
