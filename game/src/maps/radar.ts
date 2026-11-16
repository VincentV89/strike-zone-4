/**
 * Radar outline (business-logic-model-world-maps, "Radar segments"). Pure; ui-hud computes it
 * once per map.
 */
import { footprint2d, solidTop } from './geometry';
import type { MapDefinition, RadarSegment, SolidRole } from './types';

const RADAR_ROLES: ReadonlySet<SolidRole> = new Set(['wall', 'prop', 'roof', 'boundary']);
const MIN_TOP = 1.0;

const round2 = (v: number) => Math.round(v * 100) / 100;

function edgeKey(a: { x: number; z: number }, b: { x: number; z: number }): string {
  const p = `${String(round2(a.x))},${String(round2(a.z))}`;
  const q = `${String(round2(b.x))},${String(round2(b.z))}`;
  return p < q ? `${p}|${q}` : `${q}|${p}`;
}

export function collidersToRadarSegments(map: MapDefinition): ReadonlyArray<RadarSegment> {
  const seen = new Set<string>();
  const out: RadarSegment[] = [];
  for (const s of map.solids) {
    if (!RADAR_ROLES.has(s.role) || solidTop(s) < MIN_TOP) continue;
    const fp = footprint2d(s);
    for (let i = 0; i < fp.length; i++) {
      const a = fp[i];
      const b = fp[(i + 1) % fp.length];
      if (!a || !b) continue;
      const key = edgeKey(a, b);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ x1: round2(a.x), z1: round2(a.z), x2: round2(b.x), z2: round2(b.z) });
    }
  }
  return out;
}
