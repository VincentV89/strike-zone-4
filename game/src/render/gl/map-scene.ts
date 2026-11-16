/**
 * Map layer and light rig (LC-G-5, PD-R-1, PD-R-9). Built once per map id from the pure groups:
 * ≤ 14 static meshes, one sun with a shadow camera fitted to the map bounds, one hemisphere
 * light and fog. Map switch disposes only map-owned geometry; shared materials stay.
 */
import type { AssetFactory } from '@sz/assets';
import type { MapDefinition } from '@sz/maps';
import { buildMapGeometry, fitShadowFrustum, sunEye } from '@sz/render/core/map-geometry';
import type { PresetRow } from '@sz/render/core/presets';
import {
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  StaticDrawUsage,
  type BufferAttribute,
} from 'three';
import { geometryFromArrays } from './geometry';

export interface MapScene {
  readonly mapId: string;
  readonly group: Group;
  readonly sun: DirectionalLight;
  readonly fog: Fog;
  readonly fogFar: number;
  readonly meshes: number;
  readonly skippedSolids: number;
  dispose(): void;
}

const SUN_DISTANCE_M = 120;

export function buildMapScene(
  map: MapDefinition,
  assets: AssetFactory,
  preset: PresetRow,
): MapScene {
  const group = new Group();
  const { groups, skipped } = buildMapGeometry(map);
  const owned: Mesh[] = [];
  for (const g of groups) {
    const material = assets.material(g.material);
    if (material === undefined) continue;
    const geometry = geometryFromArrays(g.mesh);
    for (const name of ['position', 'normal', 'uv'] as const) {
      (geometry.getAttribute(name) as BufferAttribute).setUsage(StaticDrawUsage);
    }
    const mesh = new Mesh(geometry, material);
    mesh.castShadow = g.castShadow;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
    owned.push(mesh);
  }

  const l = map.lights;
  const sun = new DirectionalLight(new Color(l.sun.color), l.sun.intensity);
  const eye = sunEye(map.bounds, l.sun.direction, SUN_DISTANCE_M);
  sun.position.set(eye.x, eye.y, eye.z);
  sun.target.position.set(eye.cx, eye.cy, eye.cz);
  const f = fitShadowFrustum(map.bounds, l.sun.direction, eye);
  const cam = sun.shadow.camera;
  cam.left = f.left;
  cam.right = f.right;
  cam.top = f.top;
  cam.bottom = f.bottom;
  cam.near = Math.max(0.1, f.near);
  cam.far = f.far;
  cam.updateProjectionMatrix();
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  sun.castShadow = preset.sunShadows;
  group.add(sun, sun.target);
  group.add(
    new HemisphereLight(
      new Color(l.hemisphere.sky),
      new Color(l.hemisphere.ground),
      l.hemisphere.intensity,
    ),
  );
  const fog = new Fog(
    new Color(l.fog.color),
    l.fog.near,
    Math.min(l.fog.far, preset.drawDistanceM),
  );

  return {
    mapId: map.id,
    group,
    sun,
    fog,
    fogFar: l.fog.far,
    meshes: owned.length,
    skippedSolids: skipped,
    dispose() {
      for (const m of owned) m.geometry.dispose();
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
      group.clear();
    },
  };
}
