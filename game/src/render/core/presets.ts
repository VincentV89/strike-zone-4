/**
 * Graphics presets (business-logic-model preset table, PD-R-2, LC-R-1). Frozen Map, so an
 * unknown or hostile id returns undefined (SD-R-3). Medium and High both use PCFShadowMap
 * (ADR-R-6); High's "soft" look is a larger shadow radius.
 */
import type { PresetId } from './types';

export interface EffectCaps {
  readonly decal: number;
  readonly puff: number;
  readonly spark: number;
  readonly muzzle: number;
}

export interface PresetRow {
  readonly id: PresetId;
  readonly renderScale: number;
  readonly pixelRatioCap: number;
  readonly sunShadows: boolean;
  /** 0 when shadows are off. */
  readonly shadowMapSize: number;
  readonly shadowRadius: number;
  /** Bots closer than this cast shadows (Low 0, Medium 30, High Infinity). */
  readonly botShadowNearM: number;
  readonly drawDistanceM: number;
  /** Walk cycles freeze beyond this distance. */
  readonly animLodM: number;
  readonly anisotropy: number;
  readonly caps: EffectCaps;
}

const row = (r: PresetRow): PresetRow =>
  Object.freeze({ ...r, caps: Object.freeze({ ...r.caps }) });

export const PRESET_IDS: ReadonlyArray<PresetId> = Object.freeze(['low', 'medium', 'high']);

export const PRESETS: ReadonlyMap<PresetId, PresetRow> = new Map<PresetId, PresetRow>([
  [
    'low',
    row({
      id: 'low',
      renderScale: 0.75,
      pixelRatioCap: 1,
      sunShadows: false,
      shadowMapSize: 0,
      shadowRadius: 0,
      botShadowNearM: 0,
      drawDistanceM: 60,
      animLodM: 15,
      anisotropy: 1,
      caps: { decal: 24, puff: 24, spark: 48, muzzle: 8 },
    }),
  ],
  [
    'medium',
    row({
      id: 'medium',
      renderScale: 1,
      pixelRatioCap: 1,
      sunShadows: true,
      shadowMapSize: 1024,
      shadowRadius: 1,
      botShadowNearM: 30,
      drawDistanceM: 90,
      animLodM: 30,
      anisotropy: 4,
      caps: { decal: 48, puff: 48, spark: 96, muzzle: 16 },
    }),
  ],
  [
    'high',
    row({
      id: 'high',
      renderScale: 1,
      pixelRatioCap: 1.5,
      sunShadows: true,
      shadowMapSize: 2048,
      shadowRadius: 3,
      botShadowNearM: Number.POSITIVE_INFINITY,
      drawDistanceM: 140,
      animLodM: 60,
      anisotropy: 8,
      caps: { decal: 96, puff: 64, spark: 128, muzzle: 21 },
    }),
  ],
]);

/** Pools are allocated once at the largest cap (PD-R-5). */
export const MAX_CAPS: EffectCaps = Object.freeze({ decal: 96, puff: 64, spark: 128, muzzle: 21 });

/** Map lookup; non-string or unknown ids return undefined. */
export function presetRow(id: unknown): PresetRow | undefined {
  return typeof id === 'string' ? PRESETS.get(id as PresetId) : undefined;
}

/** Medium is the first-run default (ui-hud) and the fallback for a broken settings object. */
export function presetOrMedium(id: unknown): PresetRow {
  return presetRow(id) ?? (PRESETS.get('medium') as PresetRow);
}
