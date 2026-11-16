/**
 * Flank search (BR-WM-45 to BR-WM-47, req-bot-flank). Results depend on reservations, so they
 * are never cached.
 */
import type { RouteDef } from '@sz/maps';
import { astar, type SearchGraph } from './astar';
import type { NodeId, RouteId } from './types';

export const FLANK_RULES = {
  directPenalty: 4,
  avoidPenalty: 3,
  maxSharedFraction: 0.5,
} as const;

const interior = (seq: ReadonlyArray<NodeId>) => seq.slice(1, -1);

export interface FlankResult {
  readonly nodes: ReadonlyArray<NodeId>;
  readonly routeId: RouteId | null;
  readonly sharedFraction: number;
}

function bestRoute(
  flankInterior: ReadonlyArray<NodeId>,
  routes: ReadonlyArray<RouteDef>,
  routeNodes: ReadonlyMap<RouteId, ReadonlySet<NodeId>>,
): RouteId | null {
  let best: RouteId | null = null;
  let bestCount = 0;
  for (const r of routes) {
    const set = routeNodes.get(r.id);
    if (!set) continue;
    const count = flankInterior.filter((n) => set.has(n)).length;
    if (count > bestCount) {
      best = r.id;
      bestCount = count;
    }
  }
  return best;
}

export function flankSearch(
  g: SearchGraph,
  direct: ReadonlyArray<NodeId>,
  avoid: ReadonlySet<NodeId>,
  routes: ReadonlyArray<RouteDef>,
  routeNodes: ReadonlyMap<RouteId, ReadonlySet<NodeId>>,
): FlankResult | null {
  const penal = new Set(interior(direct));
  const start = direct[0];
  const goal = direct[direct.length - 1];
  if (penal.size === 0 || start === undefined || goal === undefined) return null;
  const nodes = astar(g, start, goal, (e) =>
    penal.has(e.to) ? FLANK_RULES.directPenalty : avoid.has(e.to) ? FLANK_RULES.avoidPenalty : 1,
  );
  if (!nodes) return null;
  const inner = interior(nodes);
  const shared = inner.filter((n) => penal.has(n)).length / Math.max(1, inner.length);
  if (shared >= FLANK_RULES.maxSharedFraction) return null;
  return {
    nodes: Object.freeze(nodes),
    routeId: bestRoute(inner, routes, routeNodes),
    sharedFraction: shared,
  };
}
