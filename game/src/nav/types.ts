/** Navigation types (domain-entities-world-maps, "Navigation entities"). */
import type { ActorId, Vec3 } from '@sz/kernel';
import type { NavLinkKind, NavNodeTag, RouteDef } from '@sz/maps';

/** Dense index 0..n-1, assigned in navNodes order. */
export type NodeId = number;
export type RouteId = string;

export interface NavNode {
  readonly index: NodeId;
  readonly id: string;
  readonly pos: Vec3;
  readonly tags: ReadonlyArray<NavNodeTag>;
}

export interface NavEdge {
  readonly to: NodeId;
  /** Link length in metres. */
  readonly cost: number;
  readonly kind: NavLinkKind;
}

export interface Path {
  readonly nodes: ReadonlyArray<NodeId>;
  /** from, then node positions, then to. Consecutive points are straight walkable segments. */
  readonly points: ReadonlyArray<Vec3>;
  readonly length: number;
}

export interface FlankPath extends Path {
  /** Route with the largest interior overlap, or null if the flank follows no named route. */
  readonly routeId: RouteId | null;
  /** Shared interior nodes with the direct path divided by flank interior nodes, in [0, 0.5). */
  readonly sharedFraction: number;
}

export type NavBuildError =
  | {
      readonly kind: 'blocked-link';
      readonly a: string;
      readonly b: string;
      readonly height: number;
    }
  | { readonly kind: 'no-ground'; readonly a: string; readonly b: string; readonly at: Vec3 }
  | {
      readonly kind: 'too-steep';
      readonly a: string;
      readonly b: string;
      readonly slopeDeg: number;
    }
  | { readonly kind: 'too-long'; readonly a: string; readonly b: string; readonly length: number }
  | { readonly kind: 'disconnected'; readonly unreachable: ReadonlyArray<string> }
  | {
      readonly kind: 'route-broken';
      readonly route: RouteId;
      readonly a: string;
      readonly b: string;
    };

export interface NavGraph {
  readonly nodeCount: number;
  /** Node 0 for an out-of-range id (never throws). */
  node(id: NodeId): NavNode;
  nodeByName(id: string): NodeId | undefined;
  /** Adjacency of a node, sorted by `to`; empty for an out-of-range id. */
  edges(id: NodeId): ReadonlyArray<NavEdge>;
  nearestNode(p: Vec3): NodeId;
  findPath(from: Vec3, to: Vec3): Path | null;
  findFlankPath(from: Vec3, target: Vec3, avoidRoute?: RouteId): FlankPath | null;
  reserveRoute(bot: ActorId, route: RouteId): void;
  releaseRoute(bot: ActorId): void;
  /** Called by simulation on round start and reset. */
  clearReservations(): void;
  reservations(): ReadonlyMap<ActorId, RouteId>;
  isReachable(a: NodeId, b: NodeId): boolean;
  routes(): ReadonlyArray<RouteDef>;
}

export interface PathBudget {
  readonly maxQueriesPerTick: number;
  tryConsume(): boolean;
  /** Called by simulation at the start of every tick. */
  resetTick(): void;
}
