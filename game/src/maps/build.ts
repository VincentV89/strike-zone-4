/**
 * Authoring helpers (business-logic-model-world-maps, "Authoring helpers"). Pure functions
 * that keep map data short and correct by construction. warehouse-map reuses them.
 */
import { add, scale, sub, vec3, yawOf, type Vec3 } from '@sz/kernel';
import { rotateYawPitch } from './geometry';
import type {
  CoverPoint,
  MapBounds,
  MaterialId,
  NavLinkDef,
  NavLinkKind,
  NavNodeDef,
  NavNodeTag,
  Solid,
  SolidRole,
} from './types';

/** Ramp slabs are 0.3 m thick; the top surface passes through both endpoints. */
export const RAMP_THICKNESS = 0.3;

/** Roles whose solids cast shadows (BR-WM-25). */
const SHADOW_ROLES: ReadonlySet<SolidRole> = new Set(['wall', 'prop', 'roof', 'ramp']);

function solid(
  id: string,
  role: SolidRole,
  center: Vec3,
  half: Vec3,
  material: MaterialId,
  rot: { readonly yaw: number; readonly pitch: number } = { yaw: 0, pitch: 0 },
): Solid {
  return {
    id,
    role,
    center,
    half,
    yaw: rot.yaw,
    pitch: rot.pitch,
    material,
    castShadow: SHADOW_ROLES.has(role),
  };
}

/** Axis-aligned solid from two opposite corners (any order). */
export function box(id: string, role: SolidRole, a: Vec3, b: Vec3, material: MaterialId): Solid {
  const min = vec3(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z));
  const max = vec3(Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z));
  return solid(id, role, scale(add(min, max), 0.5), scale(sub(max, min), 0.5), material);
}

/**
 * Wall standing on y = 0 along the 2D segment from → to (x, z; y is ignored), yaw-rotated
 * to follow the segment.
 */
export function wall(
  id: string,
  from: Vec3,
  to: Vec3,
  dims: { readonly height: number; readonly thickness: number },
  material: MaterialId,
): Solid {
  const d = vec3(to.x - from.x, 0, to.z - from.z);
  const len = Math.hypot(d.x, d.z);
  const center = vec3((from.x + to.x) / 2, dims.height / 2, (from.z + to.z) / 2);
  return solid(id, 'wall', center, vec3(dims.thickness / 2, dims.height / 2, len / 2), material, {
    yaw: yawOf(d),
    pitch: 0,
  });
}

/**
 * Ramp slab whose top surface passes exactly through `from` and `to`. Local -Z points from
 * `from` toward `to`; pitch is the climb angle (positive when `to` is higher).
 */
export function ramp(id: string, from: Vec3, to: Vec3, width: number, material: MaterialId): Solid {
  const d = sub(to, from);
  const horizontalLen = Math.hypot(d.x, d.z);
  const yaw = yawOf(vec3(d.x, 0, d.z));
  const pitch = Math.atan2(d.y, horizontalLen);
  const len = Math.hypot(horizontalLen, d.y);
  const up = rotateYawPitch(vec3(0, 1, 0), yaw, pitch);
  const mid = scale(add(from, to), 0.5);
  const center = sub(mid, scale(up, RAMP_THICKNESS / 2));
  return solid(id, 'ramp', center, vec3(width / 2, RAMP_THICKNESS / 2, len / 2), material, {
    yaw,
    pitch,
  });
}

/** A cube-ish crate resting on `base.y`, centred on base x/z. */
export function crate(id: string, base: Vec3, size: number): Solid {
  const h = size / 2;
  return solid(id, 'prop', vec3(base.x, base.y + h, base.z), vec3(h, h, h), 'crate-wood');
}

/** A stack of crates of decreasing size, each resting on the one below. */
export function crateStack(
  id: string,
  base: Vec3,
  sizes: ReadonlyArray<number>,
): ReadonlyArray<Solid> {
  const out: Solid[] = [];
  let y = base.y;
  sizes.forEach((size, i) => {
    out.push(crate(`${id}-${String(i)}`, vec3(base.x, y, base.z), size));
    y += size;
  });
  return out;
}

/**
 * Four boundary walls of the given height and 1 m thickness just outside `bounds`, so the
 * playable area is enclosed (BR-WM-19).
 */
export function boundaryRing(
  bounds: MapBounds,
  height: number,
  material: MaterialId,
): ReadonlyArray<Solid> {
  const { min, max } = bounds;
  const t = 1;
  const make = (id: string, a: Vec3, b: Vec3): Solid => box(id, 'boundary', a, b, material);
  return [
    make('boundary-n', vec3(min.x - t, 0, min.z - t), vec3(max.x + t, height, min.z)),
    make('boundary-s', vec3(min.x - t, 0, max.z), vec3(max.x + t, height, max.z + t)),
    make('boundary-w', vec3(min.x - t, 0, min.z), vec3(min.x, height, max.z)),
    make('boundary-e', vec3(max.x, 0, min.z), vec3(max.x + t, height, max.z)),
  ];
}

export function node(id: string, pos: Vec3, ...tags: ReadonlyArray<NavNodeTag>): NavNodeDef {
  return { id, pos, tags };
}

/**
 * Evenly spaced nodes from `from` to `to` inclusive, at most `spacing` apart, named
 * `<prefix>-0` … `<prefix>-n`.
 */
export function chain(
  prefix: string,
  from: Vec3,
  to: Vec3,
  spacing: number,
  ...tags: ReadonlyArray<NavNodeTag>
): ReadonlyArray<NavNodeDef> {
  const d = sub(to, from);
  const len = Math.hypot(d.x, d.y, d.z);
  const segments = Math.max(1, Math.ceil(len / spacing - 1e-9));
  const out: NavNodeDef[] = [];
  for (let i = 0; i <= segments; i++) {
    out.push(node(`${prefix}-${String(i)}`, add(from, scale(d, i / segments)), ...tags));
  }
  return out;
}

/** Explicit links joining consecutive ids. */
export function linkChain(
  ids: ReadonlyArray<string>,
  kind: NavLinkKind = 'walk',
): ReadonlyArray<NavLinkDef> {
  const out: NavLinkDef[] = [];
  for (let i = 1; i < ids.length; i++) {
    const a = ids[i - 1];
    const b = ids[i];
    if (a !== undefined && b !== undefined) out.push({ a, b, kind });
  }
  return out;
}

/** A cover point `gap` metres beyond the face of an axis-aligned solid, facing it. */
export function coverBeside(
  id: string,
  target: Solid,
  side: 'n' | 's' | 'e' | 'w',
  opts: { readonly gap: number; readonly crouchOnly: boolean },
): CoverPoint {
  const { center: c, half: h } = target;
  const off = {
    n: vec3(0, 0, -(h.z + opts.gap)),
    s: vec3(0, 0, h.z + opts.gap),
    e: vec3(h.x + opts.gap, 0, 0),
    w: vec3(-(h.x + opts.gap), 0, 0),
  }[side];
  const facing = { n: vec3(0, 0, 1), s: vec3(0, 0, -1), e: vec3(-1, 0, 0), w: vec3(1, 0, 0) }[side];
  const groundY = c.y - h.y;
  return {
    id,
    pos: vec3(c.x + off.x, groundY, c.z + off.z),
    facing,
    crouchOnly: opts.crouchOnly,
  };
}
