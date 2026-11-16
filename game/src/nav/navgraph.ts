/**
 * Runtime NavGraph (BR-WM-40 to BR-WM-49a). Holds only a WORLD sight function, never the
 * physics port (SD-WM-8). Queries never throw; invalid input returns null or node 0.
 */
import {
  ZERO,
  add,
  distance,
  isBotId,
  parseActorId,
  vec3,
  type ActorId,
  type PhysicsQuery,
  type Vec3,
} from '@sz/kernel';
import type { RouteDef } from '@sz/maps';
import { astar, type SearchGraph } from './astar';
import { BUCKET_SIZE, bucketKey } from './buckets';
import { flankSearch } from './flank';
import { okNodeId, okPoint } from './guards';
import { createLru } from './lru';
import type { FlankPath, NavEdge, NavGraph, NavNode, NodeId, Path, RouteId } from './types';

export const NAV_QUERY_RULES = {
  snapCandidates: 8,
  snapMaxRadius: 24,
  snapEyeHeight: 1.0,
  maxSnapDistance: 15,
  cacheEntries: 256,
} as const;

export interface NavGraphParts {
  readonly nodes: ReadonlyArray<NavNode>;
  readonly adj: ReadonlyArray<ReadonlyArray<NavEdge>>;
  readonly comp: Int32Array;
  readonly byName: ReadonlyMap<string, NodeId>;
  readonly routes: ReadonlyArray<RouteDef>;
  readonly sight: PhysicsQuery['lineOfSight'];
}

const EMPTY: ReadonlyArray<NavEdge> = Object.freeze([]);

function pathPoints(from: Vec3, nodes: ReadonlyArray<NodeId>, to: Vec3, pos: (n: NodeId) => Vec3) {
  const points = [from, ...nodes.map(pos), to];
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += distance(points[i - 1] as Vec3, points[i] as Vec3);
  }
  return { points, length };
}

export function createNavGraph(parts: NavGraphParts): NavGraph {
  const { nodes, adj, comp, byName, routes, sight } = parts;
  const count = nodes.length;
  const buckets = new Map<number, NodeId[]>();
  for (const n of nodes) {
    const key = bucketKey(n.pos.x, n.pos.z);
    const list = buckets.get(key);
    if (list) list.push(n.index);
    else buckets.set(key, [n.index]);
  }
  const routeNodes = new Map<RouteId, ReadonlySet<NodeId>>();
  for (const r of routes) {
    const set = new Set<NodeId>();
    for (const id of r.nodes) {
      const i = byName.get(id);
      if (i !== undefined) set.add(i);
    }
    routeNodes.set(r.id, set);
  }
  const cache = createLru<number, ReadonlyArray<NodeId>>(NAV_QUERY_RULES.cacheEntries);
  const reservations = new Map<ActorId, RouteId>();
  const pos = (n: NodeId): Vec3 => (nodes[n] ?? nodes[0])?.pos ?? ZERO;
  const search: SearchGraph = { nodeCount: count, pos, edges: (n) => adj[n] ?? EMPTY };

  function candidatesNear(p: Vec3): NodeId[] {
    const cx = Math.floor(p.x / BUCKET_SIZE);
    const cz = Math.floor(p.z / BUCKET_SIZE);
    const found: NodeId[] = [];
    const maxRing = Math.ceil(NAV_QUERY_RULES.snapMaxRadius / BUCKET_SIZE);
    for (let r = 0; r <= maxRing; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const list = buckets.get(bucketKey((cx + dx) * BUCKET_SIZE, (cz + dz) * BUCKET_SIZE));
          if (list) found.push(...list);
        }
      }
      if (found.length >= NAV_QUERY_RULES.snapCandidates) break;
    }
    return found;
  }

  function nearestNode(p: Vec3): NodeId {
    if (count === 0 || !okPoint(p)) return 0;
    let cands = candidatesNear(p);
    if (cands.length === 0) cands = nodes.map((n) => n.index);
    const ranked = cands
      .map((i) => ({ i, d: distance(p, pos(i)) }))
      .sort((a, b) => a.d - b.d || a.i - b.i)
      .slice(0, NAV_QUERY_RULES.snapCandidates);
    const eye = vec3(0, NAV_QUERY_RULES.snapEyeHeight, 0);
    for (const { i } of ranked) {
      if (sight(add(p, eye), add(pos(i), eye))) return i;
    }
    return ranked[0]?.i ?? 0;
  }

  function snap(from: Vec3, to: Vec3): { a: NodeId; b: NodeId } | null {
    if (count === 0 || !okPoint(from) || !okPoint(to)) return null;
    const a = nearestNode(from);
    const b = nearestNode(to);
    const far = NAV_QUERY_RULES.maxSnapDistance;
    if (distance(from, pos(a)) > far || distance(to, pos(b)) > far) return null;
    if (comp[a] !== comp[b]) return null;
    return { a, b };
  }

  function nodesBetween(a: NodeId, b: NodeId): ReadonlyArray<NodeId> | null {
    const key = a * 1024 + b;
    const hit = cache.get(key);
    if (hit) return hit;
    const found = astar(search, a, b);
    if (!found) return null;
    const frozen = Object.freeze(found);
    cache.set(key, frozen);
    return frozen;
  }

  function findPath(from: Vec3, to: Vec3): Path | null {
    const s = snap(from, to);
    if (!s) return null;
    const seq = nodesBetween(s.a, s.b);
    if (!seq) return null;
    return { nodes: seq, ...pathPoints(from, seq, to, pos) };
  }

  function findFlankPath(from: Vec3, target: Vec3, avoidRoute?: RouteId): FlankPath | null {
    const direct = findPath(from, target);
    if (!direct) return null;
    const avoid = new Set<NodeId>();
    const avoidIds = new Set<RouteId>(reservations.values());
    if (avoidRoute !== undefined && routeNodes.has(avoidRoute)) avoidIds.add(avoidRoute);
    for (const r of avoidIds) for (const n of routeNodes.get(r) ?? []) avoid.add(n);
    const flank = flankSearch(search, direct.nodes, avoid, routes, routeNodes);
    if (!flank) return null;
    return { ...flank, ...pathPoints(from, flank.nodes, target, pos) };
  }

  return {
    nodeCount: count,
    node: (id) => nodes[okNodeId(id, count) ? id : 0] as NavNode,
    nodeByName: (id) => byName.get(id),
    edges: (id) => (okNodeId(id, count) ? (adj[id] ?? EMPTY) : EMPTY),
    nearestNode,
    findPath,
    findFlankPath,
    reserveRoute(bot, route) {
      if (!routeNodes.has(route)) return;
      const parsed = parseActorId(bot);
      if (!parsed.ok || !isBotId(parsed.value)) return;
      reservations.set(parsed.value, route);
    },
    releaseRoute(bot) {
      reservations.delete(bot);
    },
    clearReservations() {
      reservations.clear();
    },
    reservations: () => new Map(reservations),
    isReachable: (a, b) => okNodeId(a, count) && okNodeId(b, count) && comp[a] === comp[b],
    routes: () => routes,
  };
}
