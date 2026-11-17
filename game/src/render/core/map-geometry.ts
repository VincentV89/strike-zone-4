/**
 * Map solids → static merged geometry groups (PD-R-1, BR-R-17). One group per
 * (material, castShadow), so a map costs at most 7 × 2 = 14 draw calls at any solid count.
 * 'invisible' boundary solids and unknown materials are not drawn (unknown ones are counted).
 * UVs tile once per 2 m so textures do not stretch.
 */
import { buildBoxes, type MeshArrays } from '@sz/assets/core/box-mesh';
import { paletteRow, type VisibleMaterialId } from '@sz/assets/core/palette';
import type { MapDefinition, Solid } from '@sz/maps';
import { listOr } from './guards';

export const UV_TILE_M = 2;

export interface SolidGroup {
  readonly key: string;
  readonly material: VisibleMaterialId;
  readonly castShadow: boolean;
  readonly solids: ReadonlyArray<Solid>;
}

export interface GroupedSolids {
  readonly groups: ReadonlyArray<SolidGroup>;
  /** Solids with an unknown material id (D4: skipped and counted). */
  readonly skipped: number;
}

export function groupSolids(map: MapDefinition): GroupedSolids {
  const byKey = new Map<
    string,
    { material: VisibleMaterialId; castShadow: boolean; solids: Solid[] }
  >();
  let skipped = 0;
  const solids = listOr(map.solids);
  for (const s of solids) {
    if (s.material === 'invisible') continue;
    const row = paletteRow(s.material);
    if (row === undefined) {
      skipped += 1;
      continue;
    }
    const castShadow = s.castShadow;
    const key = `${row.id}:${castShadow ? 'caster' : 'receiver'}`;
    let g = byKey.get(key);
    if (g === undefined) {
      g = { material: row.id, castShadow, solids: [] };
      byKey.set(key, g);
    }
    g.solids.push(s);
  }
  const groups = [...byKey.entries()].map(([key, g]) => Object.freeze({ key, ...g }));
  return { groups, skipped };
}

export interface MapGeometryGroup extends SolidGroup {
  readonly mesh: MeshArrays;
}

/** A point `distM` back along the light direction from the bounds centre (the sun's position). */
export function sunEye(
  bounds: MapDefinition['bounds'],
  dir: { readonly x: number; readonly y: number; readonly z: number },
  distM: number,
): { x: number; y: number; z: number; cx: number; cy: number; cz: number } {
  const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z) || 1;
  const cx = (bounds.min.x + bounds.max.x) / 2;
  const cy = (bounds.min.y + bounds.max.y) / 2;
  const cz = (bounds.min.z + bounds.max.z) / 2;
  return {
    x: cx - (dir.x / len) * distM,
    y: cy - (dir.y / len) * distM,
    z: cz - (dir.z / len) * distM,
    cx,
    cy,
    cz,
  };
}

/** Builds the merged mesh per group (done once per map id in loadMap). */
export function buildMapGeometry(map: MapDefinition): {
  readonly groups: ReadonlyArray<MapGeometryGroup>;
  readonly skipped: number;
} {
  const { groups, skipped } = groupSolids(map);
  return {
    groups: groups.map((g) => ({ ...g, mesh: buildBoxes(g.solids, { uvTileM: UV_TILE_M }) })),
    skipped,
  };
}

export interface ShadowBox {
  readonly min: { readonly x: number; readonly y: number; readonly z: number };
  readonly max: { readonly x: number; readonly y: number; readonly z: number };
}

/**
 * Orthographic shadow frustum for the sun, fitted to the map bounds (PD-R-9): all 8 corners in
 * light space, padded by 2 m. Light space looks along `dir` from `eye` with +Y world as the up
 * hint, matching Object3D.lookAt for the shadow camera (x = f × up, y = x × f).
 */
export function fitShadowFrustum(
  bounds: MapDefinition['bounds'],
  dir: { readonly x: number; readonly y: number; readonly z: number },
  eye: { readonly x: number; readonly y: number; readonly z: number },
  padM = 2,
): { left: number; right: number; top: number; bottom: number; near: number; far: number } {
  const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z) || 1;
  const fx = dir.x / len;
  const fy = dir.y / len;
  const fz = dir.z / len;
  // right = f × up(0,1,0), normalised; fall back to +X when looking straight down.
  let rx = -fz;
  let rz = fx;
  const rl = Math.sqrt(rx * rx + rz * rz);
  if (rl < 1e-6) {
    rx = 1;
    rz = 0;
  } else {
    rx /= rl;
    rz /= rl;
  }
  // up = right × f
  const ux = -rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy;
  let minR = Infinity;
  let maxR = -Infinity;
  let minU = Infinity;
  let maxU = -Infinity;
  let minF = Infinity;
  let maxF = -Infinity;
  for (let i = 0; i < 8; i++) {
    const x = (i & 1 ? bounds.max.x : bounds.min.x) - eye.x;
    const y = (i & 2 ? bounds.max.y : bounds.min.y) - eye.y;
    const z = (i & 4 ? bounds.max.z : bounds.min.z) - eye.z;
    const r = x * rx + z * rz;
    const u = x * ux + y * uy + z * uz;
    const f = x * fx + y * fy + z * fz;
    minR = Math.min(minR, r);
    maxR = Math.max(maxR, r);
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minF = Math.min(minF, f);
    maxF = Math.max(maxF, f);
  }
  return {
    left: minR - padM,
    right: maxR + padM,
    bottom: minU - padM,
    top: maxU + padM,
    near: minF - padM,
    far: maxF + padM,
  };
}
