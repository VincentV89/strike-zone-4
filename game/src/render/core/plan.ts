/**
 * The pure scene plan (PD-R-1, LC-R-8). One row per mesh; gl creates exactly one Three object per
 * row. Vitest gates draw-call, triangle and light budgets on the plan in Node (NFR-R-P6 to P12),
 * and Playwright can compare renderer.info against planCounts.
 */
import { BOX_TRIANGLES } from '@sz/assets/core/box-mesh';
import { PARTS_PER_BOT, RIG_PARTS } from '@sz/assets/core/rig-parts';
import { VIEWMODELS } from '@sz/assets/core/viewmodel-parts';
import type { MapDefinition } from '@sz/maps';
import { BOT_CAPACITY } from './actors';
import { groupSolids } from './map-geometry';
import { MAX_CAPS, type PresetRow } from './presets';

export type PlanPass = 'main' | 'viewmodel';
export type PlanKind = 'map' | 'bot' | 'effect' | 'viewmodel';

export interface PlanRow {
  readonly id: string;
  readonly kind: PlanKind;
  readonly pass: PlanPass;
  readonly materialKey: string;
  readonly capacity: number;
  readonly castShadow: boolean;
  readonly trianglesPerInstance: number;
}

export interface ScenePlan {
  readonly mapId: string;
  readonly preset: string;
  readonly rows: ReadonlyArray<PlanRow>;
  readonly skippedSolids: number;
  readonly lights: { readonly directional: number; readonly hemisphere: number };
}

export const QUAD_TRIANGLES = 2;

export function buildScenePlan(map: MapDefinition, preset: PresetRow): ScenePlan {
  const rows: PlanRow[] = [];
  const grouped = groupSolids(map);
  for (const g of grouped.groups) {
    rows.push({
      id: `map:${g.key}`,
      kind: 'map',
      pass: 'main',
      materialKey: g.material,
      capacity: 1,
      castShadow: g.castShadow && preset.sunShadows,
      trianglesPerInstance: g.solids.length * BOX_TRIANGLES,
    });
  }
  for (const side of ['near', 'far'] as const) {
    for (const p of RIG_PARTS) {
      rows.push({
        id: `bot:${p.part}:${side}`,
        kind: 'bot',
        pass: 'main',
        materialKey: `bot-${p.part}`,
        capacity: BOT_CAPACITY * p.perBot,
        castShadow: side === 'near' && preset.sunShadows,
        trianglesPerInstance: BOX_TRIANGLES,
      });
    }
  }
  for (const kind of ['decal', 'puff', 'spark', 'muzzle'] as const) {
    rows.push({
      id: `effect:${kind}`,
      kind: 'effect',
      pass: 'main',
      materialKey: `effect-${kind}`,
      capacity: MAX_CAPS[kind],
      castShadow: false,
      trianglesPerInstance: QUAD_TRIANGLES,
    });
  }
  for (const [weapon, spec] of VIEWMODELS) {
    rows.push({
      id: `viewmodel:${weapon}`,
      kind: 'viewmodel',
      pass: 'viewmodel',
      materialKey: 'viewmodel',
      capacity: 1,
      castShadow: false,
      trianglesPerInstance: spec.boxes.length * BOX_TRIANGLES,
    });
  }
  rows.push({
    id: 'viewmodel:flash',
    kind: 'viewmodel',
    pass: 'viewmodel',
    materialKey: 'effect-muzzle',
    capacity: 1,
    castShadow: false,
    trianglesPerInstance: QUAD_TRIANGLES,
  });
  return Object.freeze({
    mapId: map.id,
    preset: preset.id,
    rows: Object.freeze(rows.map((r) => Object.freeze(r))),
    skippedSolids: grouped.skipped,
    lights: Object.freeze({ directional: 1, hemisphere: 1 }),
  });
}

export interface PlanCounts {
  readonly mapMeshes: number;
  readonly botMeshes: number;
  readonly effectMeshes: number;
  readonly viewmodelMeshes: number;
  /** Upper bound on main-pass draw calls (every main mesh drawn). */
  readonly mainDrawCalls: number;
  /** Upper bound on shadow-pass draw calls (casting meshes). */
  readonly shadowDrawCalls: number;
  /** One weapon plus its flash are visible at a time. */
  readonly viewmodelDrawCalls: number;
  /** Worst-case triangles at 20 bots and full effect pools. */
  readonly triangles: number;
  readonly lights: number;
}

export function planCounts(plan: ScenePlan): PlanCounts {
  const of = (k: PlanKind): ReadonlyArray<PlanRow> => plan.rows.filter((r) => r.kind === k);
  const map = of('map');
  const bots = of('bot');
  const effects = of('effect');
  const vm = of('viewmodel');
  const mapTris = map.reduce((n, r) => n + r.trianglesPerInstance, 0);
  const botTris = BOT_CAPACITY * PARTS_PER_BOT * BOX_TRIANGLES;
  const effectTris = effects.reduce((n, r) => n + r.capacity * r.trianglesPerInstance, 0);
  const weaponTris = vm
    .filter((r) => r.id !== 'viewmodel:flash')
    .map((r) => r.trianglesPerInstance);
  const vmTris = Math.max(0, ...weaponTris) + QUAD_TRIANGLES;
  return {
    mapMeshes: map.length,
    botMeshes: bots.length,
    effectMeshes: effects.length,
    viewmodelMeshes: vm.length,
    mainDrawCalls: map.length + bots.length + effects.length,
    shadowDrawCalls: plan.rows.filter((r) => r.castShadow).length,
    viewmodelDrawCalls: 2,
    triangles: mapTris + botTris + effectTris + vmTris,
    lights: plan.lights.directional + plan.lights.hemisphere,
  };
}
