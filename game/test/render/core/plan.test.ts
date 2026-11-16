// PD-R-1, NFR-R-P6 to P12, BR-R-17: scene budgets gated on the pure plan.
import {
  buildMapGeometry,
  fitShadowFrustum,
  groupSolids,
  sunEye,
} from '@sz/render/core/map-geometry';
import { buildScenePlan, planCounts } from '@sz/render/core/plan';
import { PRESETS, PRESET_IDS } from '@sz/render/core/presets';
import { vec3 } from '@sz/kernel';
import type { MapDefinition } from '@sz/maps';
import { describe, expect, it } from 'vitest';
import { SHIPPED_MAPS } from '../../maps/shipped-maps';

const cases = SHIPPED_MAPS.flatMap((m) => PRESET_IDS.map((p) => [m.id, p, m] as const));

describe.each(cases)('scene plan %s / %s', (_id, presetId, map) => {
  const preset = PRESETS.get(presetId);
  if (preset === undefined) throw new Error('preset');
  const plan = buildScenePlan(map, preset);
  const c = planCounts(plan);

  it('map ≤ 14 meshes, bots 16, effects 4, main ≤ 40 draw calls', () => {
    expect(c.mapMeshes).toBeLessThanOrEqual(14);
    expect(c.botMeshes).toBe(16);
    expect(c.effectMeshes).toBe(4);
    expect(c.mainDrawCalls).toBeLessThanOrEqual(40);
    expect(c.viewmodelDrawCalls).toBeLessThanOrEqual(6);
  });

  it('shadow pass ≤ 31 calls; Low casts nothing', () => {
    expect(c.shadowDrawCalls).toBeLessThanOrEqual(31);
    if (presetId === 'low') expect(c.shadowDrawCalls).toBe(0);
    else expect(c.shadowDrawCalls).toBeGreaterThan(8);
  });

  it('≤ 60,000 triangles worst case and exactly one directional + one hemisphere light', () => {
    expect(c.triangles).toBeLessThanOrEqual(60_000);
    expect(c.lights).toBe(2);
    expect(plan.lights).toEqual({ directional: 1, hemisphere: 1 });
  });

  it('is frozen and draws every visible solid', () => {
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.rows)).toBe(true);
    const drawn = groupSolids(map).groups.reduce((n, g) => n + g.solids.length, 0);
    const visible = map.solids.filter((s) => s.material !== 'invisible').length;
    expect(drawn).toBe(visible);
    expect(plan.skippedSolids).toBe(0);
  });
});

describe('plan independence from bot count (SC1)', () => {
  it('the mesh list is fixed: it never depends on how many bots are alive', () => {
    const map = SHIPPED_MAPS[0];
    const medium = PRESETS.get('medium');
    if (map === undefined || medium === undefined) throw new Error('fixture');
    const ids = buildScenePlan(map, medium).rows.map((r) => r.id);
    expect(ids.filter((id) => id.startsWith('bot:'))).toHaveLength(16);
    // Capacity is 20 bots for every part type (limbs × 2).
    for (const r of buildScenePlan(map, medium).rows.filter((x) => x.kind === 'bot')) {
      expect([20, 40]).toContain(r.capacity);
    }
  });
});

describe('map geometry', () => {
  const map = SHIPPED_MAPS[0] as MapDefinition;

  it('builds one merged mesh per group with 12 triangles per solid', () => {
    const g = buildMapGeometry(map);
    for (const group of g.groups) expect(group.mesh.triangles).toBe(group.solids.length * 12);
    expect(g.groups.every((x) => x.mesh.positions.every(Number.isFinite))).toBe(true);
  });

  it('skips and counts solids with an unknown material (D4)', () => {
    const first = map.solids[0];
    if (first === undefined) throw new Error('fixture');
    const bad = {
      ...map,
      solids: [...map.solids, { ...first, id: 'bad', material: 'gold' as never }],
    };
    expect(groupSolids(bad).skipped).toBe(1);
  });

  it('fits the shadow frustum around all 8 bound corners plus 2 m (PD-R-9)', () => {
    const dir = map.lights.sun.direction;
    const eye = sunEye(map.bounds, dir, 120);
    const f = fitShadowFrustum(map.bounds, dir, eye);
    expect(f.right - f.left).toBeGreaterThan(map.bounds.max.x - map.bounds.min.x);
    expect(f.near).toBeGreaterThan(0);
    expect(f.far).toBeGreaterThan(f.near);
    const down = fitShadowFrustum(
      map.bounds,
      vec3(0, -1, 0),
      sunEye(map.bounds, vec3(0, -1, 0), 50),
    );
    expect(down.right - down.left).toBeCloseTo(map.bounds.max.x - map.bounds.min.x + 4, 6);
  });
});
