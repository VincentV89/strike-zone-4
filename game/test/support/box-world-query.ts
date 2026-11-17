// Pure TypeScript ray-versus-oriented-box PhysicsQuery over a map's solids. Test-only fallback
// from dec-rapier-single-collision-truth (BR-WM-66); never bundled. World geometry only.
import {
  Layer,
  includes,
  isFiniteVec,
  normalize,
  vec3,
  type CollisionMask,
  type PhysicsQuery,
  type RayHit,
  type Vec3,
} from '@sz/kernel';
import { rotateYawPitch, type MapDefinition, type Solid } from '@sz/maps';
import { raySlab } from './fakes';

/** World → solid-local: the inverse of Ry(yaw) · Rx(pitch). */
function toLocal(v: Vec3, s: Solid): Vec3 {
  const cy = Math.cos(-s.yaw);
  const sy = Math.sin(-s.yaw);
  const x1 = v.x * cy + v.z * sy;
  const z1 = -v.x * sy + v.z * cy;
  const cp = Math.cos(-s.pitch);
  const sp = Math.sin(-s.pitch);
  return vec3(x1, v.y * cp - z1 * sp, v.y * sp + z1 * cp);
}

function hitSolid(origin: Vec3, dir: Vec3, s: Solid): { t: number; normal: Vec3 } | null {
  const o = toLocal(vec3(origin.x - s.center.x, origin.y - s.center.y, origin.z - s.center.z), s);
  const d = toLocal(dir, s);
  const box = { min: vec3(-s.half.x, -s.half.y, -s.half.z), max: s.half };
  const hit = raySlab(o, d, box);
  if (!hit) return null;
  return { t: hit.t, normal: rotateYawPitch(hit.normal, s.yaw, s.pitch) };
}

export interface BoxWorldQuery extends PhysicsQuery {
  readonly calls: { raycast: number; lineOfSight: number };
}

export function createBoxWorldQuery(map: Pick<MapDefinition, 'solids'>): BoxWorldQuery {
  const calls = { raycast: 0, lineOfSight: 0 };

  function nearest(origin: Vec3, dir: Vec3, maxDist: number): { t: number; normal: Vec3 } | null {
    let best: { t: number; normal: Vec3 } | null = null;
    for (const s of map.solids) {
      const h = hitSolid(origin, dir, s);
      if (h && h.t <= maxDist && (!best || h.t < best.t)) best = h;
    }
    return best;
  }

  return {
    calls,
    raycast(origin: Vec3, dir: Vec3, maxDist: number, mask: CollisionMask): RayHit | null {
      calls.raycast++;
      const d = normalize(dir);
      if (!isFiniteVec(origin) || !(maxDist > 0) || (d.x === 0 && d.y === 0 && d.z === 0)) {
        return null;
      }
      if (!includes(mask, Layer.WORLD)) return null;
      const h = nearest(origin, d, maxDist);
      if (!h) return null;
      const point = vec3(origin.x + d.x * h.t, origin.y + d.y * h.t, origin.z + d.z * h.t);
      return { kind: 'world', point, normal: h.normal, distance: h.t };
    },
    lineOfSight(a: Vec3, b: Vec3): boolean {
      calls.lineOfSight++;
      if (!isFiniteVec(a) || !isFiniteVec(b)) return false;
      const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      if (len < 1e-6) return true;
      const d = vec3((b.x - a.x) / len, (b.y - a.y) / len, (b.z - a.z) / len);
      return nearest(a, d, len - 1e-4) === null;
    },
  };
}
