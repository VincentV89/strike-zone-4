// Radar outline and original-content checks (SEC-WM-12, BR-WM-72, BR-WM-25, BR-WM-26).
import { describe, expect, it } from 'vitest';
import { vec3 } from '@sz/kernel';
import { box, collidersToRadarSegments, solidTop } from '@sz/maps';
import { fixtureMap } from './fixture-map';
import { SHIPPED_MAPS } from './shipped-maps';

describe('collidersToRadarSegments', () => {
  it('emits 4 edges per tall wall, removes shared edges and skips low or ground solids', () => {
    const map = fixtureMap({
      solids: [
        box('ground', 'ground', vec3(-50, -1, -50), vec3(50, 0, 50), 'sand'),
        box('a', 'wall', vec3(0, 0, 0), vec3(2, 3, 1), 'plaster'),
        box('b', 'wall', vec3(0, 0, 0), vec3(2, 3, 1), 'plaster'),
        box('low', 'prop', vec3(5, 0, 5), vec3(6, 0.5, 6), 'metal'),
        box('ramp', 'ramp', vec3(8, 0, 8), vec3(9, 3, 9), 'concrete'),
      ],
    });
    const segs = collidersToRadarSegments(map);
    expect(segs).toHaveLength(4);
    expect(segs[0]).toEqual({ x1: 0, z1: 0, x2: 2, z2: 0 });
  });

  it('is stable for shipped maps and covers the boundary', () => {
    for (const m of SHIPPED_MAPS) {
      const segs = collidersToRadarSegments(m);
      expect(segs.length).toBeGreaterThan(40);
      expect(collidersToRadarSegments(m)).toEqual(segs);
      expect(segs.every((s) => [s.x1, s.z1, s.x2, s.z2].every(Number.isFinite))).toBe(true);
    }
  });
});

// Names and callouts from commercial games must not appear (SEC-WM-12).
const DENY = [
  'dust',
  'mirage',
  'inferno',
  'nuke',
  'overpass',
  'vertigo',
  'ancient',
  'anubis',
  'longa',
  'shorta',
  'bsite',
  'asite',
  'catwalk',
  'ctspawn',
  'tspawn',
  'banana',
  'middoors',
  'tunnels',
];
const ASSET_REFS = ['://', '.png', '.jpg', '.glb', '.gltf', '.wav', '.mp3'];

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value && typeof value === 'object')
    for (const v of Object.values(value)) strings(v, out);
  return out;
}

describe.each(SHIPPED_MAPS.map((m) => [m.id, m] as const))('content of %s', (_id, map) => {
  const all = strings(map);

  it('SEC-WM-12: uses no names or callouts from the deny-list', () => {
    const offenders = all.filter((s) => {
      const flat = s.toLowerCase().replace(/[-_\s]/g, '');
      return DENY.some((d) => flat.includes(d));
    });
    expect(offenders).toEqual([]);
  });

  it('BR-WM-72: contains no URLs or asset file references', () => {
    expect(all.filter((s) => ASSET_REFS.some((r) => s.toLowerCase().includes(r)))).toEqual([]);
  });

  it('BR-WM-25: shadow casters are walls, roofs, props and ramps only', () => {
    for (const s of map.solids) {
      expect(s.castShadow, s.id).toBe(s.role !== 'ground' && s.role !== 'boundary');
    }
  });

  it('crates are 0.9 to 1.5 m and boundary walls are at least 6 m tall (BR-WM-19)', () => {
    const crates = map.solids.filter((x) => /crate|stack/.test(x.id));
    expect(crates.length).toBeGreaterThan(0);
    for (const s of crates) {
      for (const h of [s.half.x, s.half.y, s.half.z]) {
        expect(h * 2, s.id).toBeGreaterThanOrEqual(0.9);
        expect(h * 2, s.id).toBeLessThanOrEqual(1.5);
      }
    }
    for (const s of map.solids.filter((x) => x.role === 'boundary')) {
      expect(solidTop(s)).toBeGreaterThanOrEqual(6);
    }
  });
});
