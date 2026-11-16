// Path queries, flanking, reservations, cache and budget (BR-WM-40 to BR-WM-49a).
import { describe, expect, it } from 'vitest';
import { PLAYER_ID, createRng, vec3, type ActorId, type Vec3 } from '@sz/kernel';
import { box, node } from '@sz/maps';
import {
  DEFAULT_MAX_PATH_QUERIES_PER_TICK,
  astar,
  buildNavGraph,
  createPathBudget,
  type NavGraph,
  type SearchStats,
} from '@sz/nav';
import { createLru } from '@sz/nav/lru';
import { createNavGraph } from '@sz/nav/navgraph';
import { createBoxWorldQuery } from '../support/box-world-query';
import { gridNodes, navScene } from './nav-scenes';

const BOT1 = 'bot-1' as ActorId;
const BOT2 = 'bot-2' as ActorId;
const NAN = Number.NaN;

/** 7 × 7 grid, 4 m apart, with routes along the left (x = 0) and right (x = 24) columns. */
function gridGraph(): { g: NavGraph; sightCalls: () => number } {
  const columnRoute = (id: string, i: number) => ({
    id,
    name: id,
    nodes: [0, 1, 2, 3, 4, 5, 6].map((j) => `g-${String(i)}-${String(j)}`),
  });
  const map = navScene({
    nodes: gridNodes(7, 4),
    routes: [columnRoute('left', 0), columnRoute('right', 6), columnRoute('middle', 3)],
    radius: 6,
  });
  const q = createBoxWorldQuery(map);
  const built = buildNavGraph(map, q);
  if (!built.ok) throw new Error(JSON.stringify(built.error));
  const before = q.calls.lineOfSight;
  return { g: built.value, sightCalls: () => q.calls.lineOfSight - before };
}

const at = (x: number, z: number): Vec3 => vec3(x, 0, z);

describe('nearestNode (BR-WM-40)', () => {
  it('returns the closest visible node, else the closest node; node 0 for invalid input', () => {
    const wallMap = navScene({
      nodes: [node('near', at(0, -2)), node('far', at(4, 0)), node('other', at(8, 0))],
      solids: [box('w', 'wall', vec3(-2, 0, -1.2), vec3(2, 3, -0.8), 'plaster')],
    });
    const q = createBoxWorldQuery(wallMap);
    const g = createNavGraph({
      nodes: wallMap.navNodes.map((n, index) => ({ ...n, index })),
      adj: [[], [], []],
      comp: Int32Array.from([0, 1, 2]),
      byName: new Map([
        ['near', 0],
        ['far', 1],
        ['other', 2],
      ]),
      routes: [],
      sight: (a, b) => q.lineOfSight(a, b),
    });
    expect(g.nearestNode(at(0, 0))).toBe(1);
    const blind = createNavGraph({
      nodes: wallMap.navNodes.map((n, index) => ({ ...n, index })),
      adj: [[], [], []],
      comp: Int32Array.from([0, 1, 2]),
      byName: new Map(),
      routes: [],
      sight: () => false,
    });
    expect(blind.nearestNode(at(0, 0))).toBe(0);
    expect(blind.nearestNode(vec3(NAN, 0, 0))).toBe(0);
    expect(blind.nearestNode(vec3(1e9, 0, 0))).toBe(0);
    expect(blind.nearestNode(at(500, 500))).toBe(2);
  });
});

describe('findPath (BR-WM-41 to BR-WM-44)', () => {
  it('starts at from, ends at to, follows links, and reports the length', () => {
    const { g } = gridGraph();
    const from = at(0.5, 0.5);
    const to = at(23.5, 23.5);
    const p = g.findPath(from, to)!;
    expect(p.points[0]).toBe(from);
    expect(p.points[p.points.length - 1]).toBe(to);
    expect(p.nodes[0]).toBe(g.nodeByName('g-0-0'));
    expect(p.nodes[p.nodes.length - 1]).toBe(g.nodeByName('g-6-6'));
    for (let i = 1; i < p.nodes.length; i++) {
      expect(g.edges(p.nodes[i - 1]!).some((e) => e.to === p.nodes[i])).toBe(true);
    }
    expect(p.length).toBeGreaterThan(Math.hypot(23, 23) - 1e-9);
  });

  it('BR-WM-43: both ends on one node gives from → node → to', () => {
    const { g } = gridGraph();
    const p = g.findPath(at(0.2, 0.2), at(-0.3, 0.1))!;
    expect(p.nodes).toEqual([0]);
    expect(p.points).toHaveLength(3);
  });

  it('BR-WM-42: null more than 15 m off the graph or across components', () => {
    const { g } = gridGraph();
    expect(g.findPath(at(0, 0), at(24, 60))).toBeNull();
    expect(g.findPath(at(-40, 0), at(4, 4))).toBeNull();
    const split = createNavGraph({
      nodes: [node('a', at(0, 0)), node('b', at(5, 0))].map((n, index) => ({ ...n, index })),
      adj: [[], []],
      comp: Int32Array.from([0, 1]),
      byName: new Map([
        ['a', 0],
        ['b', 1],
      ]),
      routes: [],
      sight: () => true,
    });
    expect(split.findPath(at(0, 0), at(5, 0))).toBeNull();
    expect(split.isReachable(0, 1)).toBe(false);
  });

  it('BR-WM-49a: invalid input returns null and never throws', () => {
    const { g } = gridGraph();
    for (const bad of [vec3(NAN, 0, 0), vec3(0, Infinity, 0), vec3(0, 0, 1e7)]) {
      expect(g.findPath(bad, at(4, 4))).toBeNull();
      expect(g.findPath(at(4, 4), bad)).toBeNull();
      expect(g.findFlankPath(bad, at(4, 4))).toBeNull();
      expect(g.findFlankPath(at(4, 4), bad)).toBeNull();
    }
    expect(g.node(-1).index).toBe(0);
    expect(g.node(9999).index).toBe(0);
    expect(g.edges(1.5)).toEqual([]);
    expect(g.isReachable(0, 9999)).toBe(false);
    expect(g.nodeByName('__proto__')).toBeUndefined();
  });

  it('BR-WM-44: a cache hit returns the same frozen node sequence', () => {
    const { g } = gridGraph();
    const a = g.findPath(at(0, 0), at(24, 24))!;
    const b = g.findPath(at(0.1, 0), at(24, 23.9))!;
    expect(b.nodes).toBe(a.nodes);
    expect(Object.isFrozen(a.nodes)).toBe(true);
  });

  it('NFR-WM-P1: at most 16 sight rays per findPath', () => {
    const { g, sightCalls } = gridGraph();
    const rng = createRng(3);
    for (let i = 0; i < 50; i++) {
      const start = sightCalls();
      g.findPath(at(rng.range(0, 24), rng.range(0, 24)), at(rng.range(0, 24), rng.range(0, 24)));
      expect(sightCalls() - start).toBeLessThanOrEqual(16);
    }
  });

  it('NFR-WM-P3: A* pops each node at most once and breaks ties by lower NodeId', () => {
    const { g } = gridGraph();
    const search = {
      nodeCount: g.nodeCount,
      pos: (n: number) => g.node(n).pos,
      edges: (n: number) => g.edges(n),
    };
    const stats: SearchStats = { pops: 0 };
    const p = astar(search, 0, g.nodeCount - 1, () => 1, stats);
    expect(p).not.toBeNull();
    expect(stats.pops).toBeLessThanOrEqual(g.nodeCount);
    expect(astar(search, 0, g.nodeCount - 1)).toEqual(p);
    expect(astar(search, -1, 0)).toBeNull();
    const island = { nodeCount: 2, pos: () => at(0, 0), edges: () => [] };
    expect(astar(island, 0, 1)).toBeNull();
  });
});

describe('findFlankPath (BR-WM-45 to BR-WM-48)', () => {
  it('BR-WM-46: shares under half of the direct interior and names the route it follows', () => {
    const { g } = gridGraph();
    const direct = g.findPath(at(12, 0), at(12, 24))!;
    const flank = g.findFlankPath(at(12, 0), at(12, 24))!;
    expect(flank).not.toBeNull();
    expect(flank.sharedFraction).toBeLessThan(0.5);
    const inner = new Set(direct.nodes.slice(1, -1));
    const shared = flank.nodes.slice(1, -1).filter((n) => inner.has(n)).length;
    expect(shared / Math.max(1, flank.nodes.length - 2)).toBe(flank.sharedFraction);
    expect(flank.points[0]).toEqual(at(12, 0));
    expect(['left', 'right', 'middle', null]).toContain(flank.routeId);
  });

  it('BR-WM-46: null when the direct path has no interior nodes', () => {
    const { g } = gridGraph();
    expect(g.findFlankPath(at(0, 0), at(0, 4))).toBeNull();
  });

  it('BR-WM-45/48: reservations and avoidRoute raise cost but never block', () => {
    const { g } = gridGraph();
    const from = at(0, 0);
    const to = at(0, 24);
    const leftNodes = new Set(
      g
        .routes()
        .find((r) => r.id === 'left')!
        .nodes.map((id) => g.nodeByName(id)),
    );
    const avoided = g.findFlankPath(from, to, 'left');
    expect(avoided).not.toBeNull();
    const onLeft = avoided!.nodes.slice(1, -1).filter((n) => leftNodes.has(n)).length;
    g.reserveRoute(BOT1, 'left');
    const reserved = g.findFlankPath(from, to);
    expect(reserved?.nodes).toEqual(avoided?.nodes);
    expect(onLeft).toBeLessThan(avoided!.nodes.length - 2);
    expect(g.findPath(from, to)).not.toBeNull();
  });

  it('BR-WM-48: one reservation per bot; release, clear and invalid input', () => {
    const { g } = gridGraph();
    g.reserveRoute(BOT1, 'left');
    g.reserveRoute(BOT1, 'right');
    g.reserveRoute(BOT2, 'middle');
    expect([...g.reservations()]).toEqual([
      [BOT1, 'right'],
      [BOT2, 'middle'],
    ]);
    g.reserveRoute(BOT2, 'nope');
    g.reserveRoute(PLAYER_ID, 'left');
    g.reserveRoute('bot-99' as ActorId, 'left');
    g.reserveRoute('__proto__' as ActorId, 'left');
    expect(g.reservations().size).toBe(2);
    g.releaseRoute(BOT1);
    expect([...g.reservations().keys()]).toEqual([BOT2]);
    g.clearReservations();
    expect(g.reservations().size).toBe(0);
    expect(g.findFlankPath(at(0, 0), at(0, 24), 'not-a-route')).not.toBeNull();
  });
});

describe('PathBudget (BR-WM-49) and LRU', () => {
  it('allows maxQueriesPerTick between resets', () => {
    const b = createPathBudget();
    expect(b.maxQueriesPerTick).toBe(DEFAULT_MAX_PATH_QUERIES_PER_TICK);
    expect([1, 2, 3, 4, 5].map(() => b.tryConsume())).toEqual([true, true, true, true, false]);
    b.resetTick();
    expect(b.tryConsume()).toBe(true);
    expect(createPathBudget(0).tryConsume()).toBe(false);
    expect(createPathBudget(NAN).maxQueriesPerTick).toBe(4);
    expect(createPathBudget(-1).maxQueriesPerTick).toBe(4);
    expect(createPathBudget(1e9).maxQueriesPerTick).toBe(1000);
  });

  it('evicts the least recently used entry', () => {
    const lru = createLru<number, string>(2);
    lru.set(1, 'a');
    lru.set(2, 'b');
    expect(lru.get(1)).toBe('a');
    lru.set(3, 'c');
    expect(lru.get(2)).toBeUndefined();
    expect(lru.get(1)).toBe('a');
    expect(lru.size).toBe(2);
    lru.set(1, 'z');
    expect(lru.get(1)).toBe('z');
  });
});
