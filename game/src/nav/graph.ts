/**
 * Nav graph build (dec-nav-waypoint-graph, BR-WM-31 to BR-WM-39). Runs once per map at boot.
 * Uses only lineOfSight and WORLD-mask raycasts (SD-WM-8). Deterministic: candidates are
 * validated in a fixed order and adjacency is sorted.
 */
import {
  MASK_WORLD,
  add,
  distance,
  err,
  lerp,
  ok,
  radToDeg,
  scale,
  vec3,
  type PhysicsQuery,
  type Result,
  type Vec3,
} from '@sz/kernel';
import type { MapDefinition, NavLinkKind } from '@sz/maps';
import { createNavGraph } from './navgraph';
import { BUCKET_SIZE, bucketKey } from './buckets';
import type { NavBuildError, NavEdge, NavGraph, NavNode, NodeId } from './types';

export const NAV_RULES = {
  sameLevelDy: 0.3,
  autoNeighbours: 6,
  maxLinkLength: 12,
  maxWalkSlopeDeg: 10,
  maxRampSlopeDeg: 30,
  clearanceHeights: [0.5, 1.0, 1.6],
  sideOffset: 0.35,
  sideHeight: 1.0,
  groundRayStart: 1.0,
  groundRayLength: 1.4,
} as const;

interface Candidate {
  readonly a: NodeId;
  readonly b: NodeId;
  readonly kind: NavLinkKind;
  readonly explicit: boolean;
}

type LinkFault = NavBuildError & { readonly a: string; readonly b: string };

const DOWN = vec3(0, -1, 0);
const pairKey = (a: NodeId, b: NodeId) => (a < b ? a * 1024 + b : b * 1024 + a);

function horizontalLength(a: Vec3, b: Vec3): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

function autoCandidates(nodes: ReadonlyArray<NavNode>, radius: number): Array<[NodeId, NodeId]> {
  const buckets = new Map<number, NodeId[]>();
  for (const n of nodes) {
    const key = bucketKey(n.pos.x, n.pos.z);
    const list = buckets.get(key);
    if (list) list.push(n.index);
    else buckets.set(key, [n.index]);
  }
  const reach = Math.ceil(radius / BUCKET_SIZE);
  const out: Array<[NodeId, NodeId]> = [];
  for (const n of nodes) {
    const near: Array<{ j: NodeId; d: number }> = [];
    const cx = Math.floor(n.pos.x / BUCKET_SIZE);
    const cz = Math.floor(n.pos.z / BUCKET_SIZE);
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dz = -reach; dz <= reach; dz++) {
        for (const j of buckets.get(bucketKey((cx + dx) * BUCKET_SIZE, (cz + dz) * BUCKET_SIZE)) ??
          []) {
          const m = nodes[j];
          if (!m || j === n.index || Math.abs(m.pos.y - n.pos.y) > NAV_RULES.sameLevelDy) continue;
          const d = distance(n.pos, m.pos);
          if (d <= radius) near.push({ j, d });
        }
      }
    }
    near.sort((p, q) => p.d - q.d || p.j - q.j);
    for (const { j } of near.slice(0, NAV_RULES.autoNeighbours)) out.push([n.index, j]);
  }
  return out;
}

function collectCandidates(
  map: MapDefinition,
  nodes: ReadonlyArray<NavNode>,
  byName: ReadonlyMap<string, NodeId>,
): Candidate[] {
  const seen = new Set<number>();
  const out: Candidate[] = [];
  for (const l of map.navLinks) {
    const a = byName.get(l.a);
    const b = byName.get(l.b);
    if (a === undefined || b === undefined || a === b || seen.has(pairKey(a, b))) continue;
    seen.add(pairKey(a, b));
    out.push({ a, b, kind: l.kind, explicit: true });
  }
  const autos = autoCandidates(nodes, map.navAutoLinkRadius)
    .map(([a, b]) => (a < b ? ([a, b] as const) : ([b, a] as const)))
    .sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  for (const [a, b] of autos) {
    if (seen.has(pairKey(a, b))) continue;
    seen.add(pairKey(a, b));
    out.push({ a, b, kind: 'walk', explicit: false });
  }
  return out;
}

function clearanceFault(pa: Vec3, pb: Vec3, sight: PhysicsQuery['lineOfSight']): number | null {
  for (const h of NAV_RULES.clearanceHeights) {
    if (!sight(add(pa, vec3(0, h, 0)), add(pb, vec3(0, h, 0)))) return h;
  }
  const hl = horizontalLength(pa, pb);
  if (hl < 1e-6) return null;
  // Horizontal perpendicular to the link, scaled to the capsule radius.
  const side = scale(vec3(-(pb.z - pa.z) / hl, 0, (pb.x - pa.x) / hl), NAV_RULES.sideOffset);
  const up = vec3(0, NAV_RULES.sideHeight, 0);
  for (const s of [side, scale(side, -1)]) {
    if (!sight(add(add(pa, up), s), add(add(pb, up), s))) return NAV_RULES.sideHeight;
  }
  return null;
}

function groundFault(pa: Vec3, pb: Vec3, physics: PhysicsQuery): Vec3 | null {
  const len = distance(pa, pb);
  const steps = Math.max(1, Math.ceil(len));
  for (let k = 0; k <= steps; k++) {
    const p = lerp(pa, pb, k / steps);
    const origin = add(p, vec3(0, NAV_RULES.groundRayStart, 0));
    if (physics.raycast(origin, DOWN, NAV_RULES.groundRayLength, MASK_WORLD) === null) return p;
  }
  return null;
}

function checkLink(
  c: Candidate,
  nodes: ReadonlyArray<NavNode>,
  physics: PhysicsQuery,
): LinkFault | null {
  const na = nodes[c.a] as NavNode;
  const nb = nodes[c.b] as NavNode;
  const ids = { a: na.id, b: nb.id };
  const length = distance(na.pos, nb.pos);
  if (length > NAV_RULES.maxLinkLength) return { kind: 'too-long', ...ids, length };
  const slopeDeg = radToDeg(
    Math.atan2(Math.abs(nb.pos.y - na.pos.y), horizontalLength(na.pos, nb.pos)),
  );
  const maxSlope = c.kind === 'ramp' ? NAV_RULES.maxRampSlopeDeg : NAV_RULES.maxWalkSlopeDeg;
  if (slopeDeg > maxSlope + 1e-9) return { kind: 'too-steep', ...ids, slopeDeg };
  const height = clearanceFault(na.pos, nb.pos, (p, q) => physics.lineOfSight(p, q));
  if (height !== null) return { kind: 'blocked-link', ...ids, height };
  const at = groundFault(na.pos, nb.pos, physics);
  if (at !== null) return { kind: 'no-ground', ...ids, at };
  return null;
}

function components(adj: ReadonlyArray<ReadonlyArray<NavEdge>>): Int32Array {
  const comp = new Int32Array(adj.length).fill(-1);
  let next = 0;
  for (let s = 0; s < adj.length; s++) {
    if (comp[s] !== -1) continue;
    comp[s] = next;
    const queue = [s];
    for (let qi = 0; qi < queue.length; qi++) {
      for (const e of adj[queue[qi] as number] ?? []) {
        if (comp[e.to] === -1) {
          comp[e.to] = next;
          queue.push(e.to);
        }
      }
    }
    next++;
  }
  return comp;
}

function disconnectedError(comp: Int32Array, nodes: ReadonlyArray<NavNode>): NavBuildError | null {
  const sizes = new Map<number, number>();
  for (const c of comp) sizes.set(c, (sizes.get(c) ?? 0) + 1);
  if (sizes.size <= 1) return null;
  let largest = 0;
  let largestSize = -1;
  for (const [c, size] of sizes) {
    if (size > largestSize) {
      largest = c;
      largestSize = size;
    }
  }
  const unreachable = nodes.filter((n) => comp[n.index] !== largest).map((n) => n.id);
  return { kind: 'disconnected', unreachable };
}

function routeErrors(
  map: MapDefinition,
  byName: ReadonlyMap<string, NodeId>,
  adj: ReadonlyArray<ReadonlyArray<NavEdge>>,
): NavBuildError[] {
  const out: NavBuildError[] = [];
  for (const r of map.routes) {
    for (let i = 1; i < r.nodes.length; i++) {
      const a = r.nodes[i - 1] ?? '';
      const b = r.nodes[i] ?? '';
      const ia = byName.get(a);
      const ib = byName.get(b);
      const linked =
        ia !== undefined && ib !== undefined && (adj[ia] ?? []).some((e) => e.to === ib);
      if (!linked) out.push({ kind: 'route-broken', route: r.id, a, b });
    }
  }
  return out;
}

export function buildNavGraph(
  map: MapDefinition,
  physics: PhysicsQuery,
): Result<NavGraph, ReadonlyArray<NavBuildError>> {
  const nodes: NavNode[] = map.navNodes.map((n, index) =>
    Object.freeze({ index, id: n.id, pos: n.pos, tags: n.tags }),
  );
  const byName = new Map<string, NodeId>();
  for (const n of nodes) if (!byName.has(n.id)) byName.set(n.id, n.index);

  const errors: NavBuildError[] = [];
  const adj: NavEdge[][] = nodes.map(() => []);
  for (const c of collectCandidates(map, nodes, byName)) {
    const fault = checkLink(c, nodes, physics);
    if (fault) {
      if (c.explicit) errors.push(fault);
      continue;
    }
    const cost = distance((nodes[c.a] as NavNode).pos, (nodes[c.b] as NavNode).pos);
    adj[c.a]?.push({ to: c.b, cost, kind: c.kind });
    adj[c.b]?.push({ to: c.a, cost, kind: c.kind });
  }
  for (const list of adj) list.sort((p, q) => p.to - q.to);

  const comp = components(adj);
  const disconnected = disconnectedError(comp, nodes);
  if (disconnected) errors.push(disconnected);
  errors.push(...routeErrors(map, byName, adj));
  if (errors.length > 0) return err(errors);

  const sight = (a: Vec3, b: Vec3) => physics.lineOfSight(a, b);
  return ok(createNavGraph({ nodes, adj, comp, byName, routes: map.routes, sight }));
}
