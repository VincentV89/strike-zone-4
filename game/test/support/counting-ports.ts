// Counting ports for bot-ai count gates (LC-AI-C22, ADR-AI-7). Every member a bot could reach is
// counted, including the ones it must never call (raycast, resetTick, clearReservations).
import type { PhysicsQuery } from '@sz/kernel';
import type { NavGraph, PathBudget } from '@sz/nav';

export interface PortCounts {
  lineOfSight: number;
  raycast: number;
  findPath: number;
  findFlankPath: number;
  nearestNode: number;
  tryConsume: number;
  refused: number;
  resetTick: number;
  clearReservations: number;
}

export function zeroCounts(): PortCounts {
  return {
    lineOfSight: 0,
    raycast: 0,
    findPath: 0,
    findFlankPath: 0,
    nearestNode: 0,
    tryConsume: 0,
    refused: 0,
    resetTick: 0,
    clearReservations: 0,
  };
}

export function countingQuery(inner: PhysicsQuery, counts: PortCounts): PhysicsQuery {
  return {
    raycast(origin, dir, maxDist, mask, exclude) {
      counts.raycast++;
      return inner.raycast(origin, dir, maxDist, mask, exclude);
    },
    lineOfSight(a, b) {
      counts.lineOfSight++;
      return inner.lineOfSight(a, b);
    },
  };
}

export function countingNav(inner: NavGraph, counts: PortCounts): NavGraph {
  return {
    nodeCount: inner.nodeCount,
    node: (id) => inner.node(id),
    nodeByName: (id) => inner.nodeByName(id),
    edges: (id) => inner.edges(id),
    nearestNode(p) {
      counts.nearestNode++;
      return inner.nearestNode(p);
    },
    findPath(from, to) {
      counts.findPath++;
      return inner.findPath(from, to);
    },
    findFlankPath(from, target, avoid) {
      counts.findFlankPath++;
      return inner.findFlankPath(from, target, avoid);
    },
    reserveRoute: (bot, route) => {
      inner.reserveRoute(bot, route);
    },
    releaseRoute: (bot) => {
      inner.releaseRoute(bot);
    },
    clearReservations() {
      counts.clearReservations++;
      inner.clearReservations();
    },
    reservations: () => inner.reservations(),
    isReachable: (a, b) => inner.isReachable(a, b),
    routes: () => inner.routes(),
  };
}

export function countingBudget(inner: PathBudget, counts: PortCounts): PathBudget {
  return {
    maxQueriesPerTick: inner.maxQueriesPerTick,
    tryConsume() {
      counts.tryConsume++;
      const ok = inner.tryConsume();
      if (!ok) counts.refused++;
      return ok;
    },
    resetTick() {
      counts.resetTick++;
      inner.resetTick();
    },
  };
}
