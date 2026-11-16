// Nav graph build (BR-WM-31 to BR-WM-39) against the pure box-world query.
import { describe, expect, it } from 'vitest';
import { vec3, type PhysicsQuery } from '@sz/kernel';
import { box, desertCompound, node, ramp } from '@sz/maps';
import { buildNavGraph, type NavBuildError, type NavGraph } from '@sz/nav';
import { createPhysicsWorld } from '@sz/physics';
import { createBoxWorldQuery } from '../support/box-world-query';
import { RAPIER_SKIP_REASON, rapierAvailable } from '../support/rapier-probe';
import { gridNodes, navScene } from './nav-scenes';

const build = (map: Parameters<typeof buildNavGraph>[0], q?: PhysicsQuery) =>
  buildNavGraph(map, q ?? createBoxWorldQuery(map));

function errorsOf(r: ReturnType<typeof build>): ReadonlyArray<NavBuildError> {
  return r.ok ? [] : r.error;
}

function graphOf(r: ReturnType<typeof build>): NavGraph {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

function edgeList(g: NavGraph): string[] {
  const out: string[] = [];
  for (let i = 0; i < g.nodeCount; i++) {
    for (const e of g.edges(i))
      if (i < e.to) out.push(`${g.node(i).id}|${g.node(e.to).id}|${e.kind}|${e.cost.toFixed(6)}`);
  }
  return out;
}

/** FNV-1a 32-bit over a string. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const wall = (id: string, x0: number, x1: number, z0: number, z1: number, h = 3) =>
  box(id, 'wall', vec3(x0, 0, z0), vec3(x1, h, z1), 'plaster');

describe('buildNavGraph', () => {
  it('BR-WM-31: auto-links same-level neighbours within the radius, at most 6 nearest each', () => {
    const g = graphOf(build(navScene({ nodes: gridNodes(4, 3) })));
    expect(g.nodeCount).toBe(16);
    for (let i = 0; i < g.nodeCount; i++) {
      for (const e of g.edges(i)) {
        expect(e.kind).toBe('walk');
        expect(e.cost).toBeLessThanOrEqual(9);
      }
    }
    const ring = navScene({
      nodes: [
        node('c', vec3(0, 0, 0)),
        ...Array.from({ length: 8 }, (_, k) =>
          node(`r${String(k)}`, vec3(Math.cos(k) * (2 + k * 0.1), 0, Math.sin(k) * (2 + k * 0.1))),
        ),
      ],
      radius: 3,
    });
    const centre = graphOf(build(ring));
    expect(centre.edges(0).length).toBeGreaterThanOrEqual(6);
  });

  it('BR-WM-31: no automatic link when heights differ by more than 0.3 m', () => {
    const map = navScene({
      nodes: [node('a', vec3(0, 0, 0)), node('b', vec3(3, 0.31, 0))],
      solids: [box('step', 'prop', vec3(2, 0, -2), vec3(5, 0.31, 2), 'concrete')],
    });
    expect(errorsOf(build(map)).map((e) => e.kind)).toEqual(['disconnected']);
  });

  it('BR-WM-36: an explicit link through a wall is an error; an automatic one is dropped', () => {
    const solids = [wall('w', -1, 1, -5.5, -4.5)];
    const nodes = [node('a', vec3(0, 0, 0)), node('b', vec3(0, 0, -8)), node('c', vec3(4, 0, -4))];
    const explicit = build(navScene({ nodes, solids, links: [{ a: 'a', b: 'b', kind: 'walk' }] }));
    expect(errorsOf(explicit)).toEqual([{ kind: 'blocked-link', a: 'a', b: 'b', height: 0.5 }]);
    const g = graphOf(build(navScene({ nodes, solids })));
    expect(g.edges(0).map((e) => e.to)).toEqual([2]);
  });

  it('BR-WM-34: a post 0.25 m beside the link blocks it at the side ray (height 1.0)', () => {
    const solids = [box('post', 'prop', vec3(0.25, 0, -3.1), vec3(0.4, 2, -2.9), 'metal')];
    const r = build(
      navScene({
        nodes: [node('a', vec3(0, 0, 0)), node('b', vec3(0, 0, -6))],
        solids,
        links: [{ a: 'a', b: 'b', kind: 'walk' }],
      }),
    );
    expect(errorsOf(r)).toContainEqual({ kind: 'blocked-link', a: 'a', b: 'b', height: 1 });
  });

  it('BR-WM-32: links longer than 12 m are errors', () => {
    const r = build(
      navScene({
        nodes: [node('a', vec3(0, 0, 0)), node('b', vec3(12.5, 0, 0))],
        links: [{ a: 'a', b: 'b', kind: 'walk' }],
      }),
    );
    expect(errorsOf(r)).toContainEqual({ kind: 'too-long', a: 'a', b: 'b', length: 12.5 });
  });

  it('BR-WM-33: walk ≤ 10°, ramp ≤ 30°', () => {
    const ramped = ramp('r', vec3(0, 0, 0), vec3(0, 3, -6), 2, 'concrete');
    const nodes = [node('a', vec3(0, 0, 0)), node('b', vec3(0, 3, -6))];
    const asWalk = build(
      navScene({ nodes, solids: [ramped], links: [{ a: 'a', b: 'b', kind: 'walk' }] }),
    );
    expect(errorsOf(asWalk)[0]).toMatchObject({ kind: 'too-steep', a: 'a', b: 'b' });
    expect((errorsOf(asWalk)[0] as { slopeDeg: number }).slopeDeg).toBeCloseTo(26.565, 2);
    const asRamp = build(
      navScene({ nodes, solids: [ramped], links: [{ a: 'a', b: 'b', kind: 'ramp' }] }),
    );
    expect(errorsOf(asRamp)).toEqual([]);
    const steep = build(
      navScene({
        nodes: [node('a', vec3(0, 0, 0)), node('b', vec3(0, 4, -5))],
        links: [{ a: 'a', b: 'b', kind: 'ramp' }],
      }),
    );
    expect(errorsOf(steep)[0]).toMatchObject({ kind: 'too-steep' });
  });

  it('BR-WM-35: a link over a gap has no ground', () => {
    const solids = [
      box('f1', 'ground', vec3(-5, -1, -2), vec3(1, 0, 2), 'sand'),
      box('f2', 'ground', vec3(4, -1, -2), vec3(10, 0, 2), 'sand'),
    ];
    const r = build(
      navScene({
        noFloor: true,
        nodes: [node('a', vec3(0, 0, 0)), node('b', vec3(6, 0, 0))],
        solids,
        links: [{ a: 'a', b: 'b', kind: 'walk' }],
      }),
    );
    expect(errorsOf(r)).toContainEqual({ kind: 'no-ground', a: 'a', b: 'b', at: vec3(2, 0, 0) });
  });

  it('BR-WM-37: a stranded node makes the graph disconnected, listing it', () => {
    const r = build(navScene({ nodes: [...gridNodes(2, 3), node('far', vec3(40, 0, 40))] }));
    expect(errorsOf(r)).toEqual([{ kind: 'disconnected', unreachable: ['far'] }]);
  });

  it('BR-WM-38: route steps must be linked', () => {
    const nodes = [node('a', vec3(0, 0, 0)), node('b', vec3(5, 0, 0)), node('c', vec3(10, 0, 0))];
    const ok = build(navScene({ nodes, routes: [{ id: 'r', name: 'R', nodes: ['a', 'b', 'c'] }] }));
    expect(errorsOf(ok)).toEqual([]);
    const broken = build(
      navScene({ nodes, routes: [{ id: 'r', name: 'R', nodes: ['a', 'c', 'ghost'] }] }),
    );
    expect(errorsOf(broken)).toEqual([
      { kind: 'route-broken', route: 'r', a: 'a', b: 'c' },
      { kind: 'route-broken', route: 'r', a: 'c', b: 'ghost' },
    ]);
  });

  it('explicit links win over automatic duplicates and keep their kind', () => {
    const nodes = [node('a', vec3(0, 0, 0)), node('b', vec3(3, 0, 0))];
    const g = graphOf(
      build(
        navScene({
          nodes,
          links: [
            { a: 'b', b: 'a', kind: 'ramp' },
            { a: 'a', b: 'b', kind: 'walk' },
            { a: 'a', b: 'ghost', kind: 'walk' },
          ],
        }),
      ),
    );
    expect(g.edges(0)).toEqual([{ to: 1, cost: 3, kind: 'ramp' }]);
  });

  it('BR-WM-39: deterministic for the same map and physics answers', () => {
    const map = navScene({ nodes: gridNodes(5, 4), solids: [wall('w', 5, 6, -1, 9)] });
    expect(edgeList(graphOf(build(map)))).toEqual(edgeList(graphOf(build(map))));
  });
});

describe('Desert Compound nav graph', () => {
  const g = graphOf(build(desertCompound));

  it('SD-WM-12: link count and adjacency digest are pinned as literals', () => {
    const edges = edgeList(g);
    expect(g.nodeCount).toBe(DESERT_NODE_COUNT);
    expect(edges.length).toBe(DESERT_LINK_COUNT);
    expect(fnv1a(edges.join('\n'))).toBe(DESERT_DIGEST);
  });

  it.skipIf(!rapierAvailable)(
    `the pure box query and Rapier build the same graph${RAPIER_SKIP_REASON}`,
    () => {
      const world = createPhysicsWorld(desertCompound);
      try {
        expect(edgeList(graphOf(build(desertCompound, world)))).toEqual(edgeList(g));
      } finally {
        world.dispose();
      }
    },
  );
});

const DESERT_NODE_COUNT = 237;
const DESERT_LINK_COUNT = 547;
const DESERT_DIGEST = 'f788031b';
