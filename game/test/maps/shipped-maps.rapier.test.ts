// Map-validity suite for every shipped map against the real Rapier adapter (BR-WM-73).
// Proves req-map-desert AC1–AC3, req-map-common and story-valid-spawns on real geometry.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MASK_WORLD, createRng, distance, vec3, type ActorId, type Vec3 } from '@sz/kernel';
import { createMapCatalog, selectSpawns, type MapDefinition } from '@sz/maps';
import { buildNavGraph, type NavGraph, type NodeId } from '@sz/nav';
import { DEFAULT_CHARACTER, createPhysicsWorld, type PhysicsWorld } from '@sz/physics';
import { RAPIER_SKIP_REASON, rapierAvailable } from '../support/rapier-probe';
import { SHIPPED_MAPS } from './shipped-maps';

const WALKER = 'bot-1' as ActorId;
const DT = 1 / 60;
const WALK_SPEED = 5;
const GRAVITY = 18;
const ARRIVE = 0.6;
const EYE = 1.62;

interface WalkResult {
  readonly arrived: boolean;
  readonly minY: number;
  readonly end: Vec3;
}

/** Drives the real character controller from a to b at 5 m/s, with gravity. */
function walk(world: PhysicsWorld, a: Vec3, b: Vec3): WalkResult {
  world.teleport(WALKER, vec3(a.x, a.y + 0.1, a.z));
  let vy = 0;
  let grounded = false;
  let minY = Infinity;
  const ticks = Math.ceil((distance(a, b) / WALK_SPEED + 1.5) / DT);
  for (let i = 0; i < ticks; i++) {
    const feet = world.positionOf(WALKER) ?? a;
    minY = Math.min(minY, feet.y);
    if (distance(feet, b) <= ARRIVE * 0.5) break;
    const dx = b.x - feet.x;
    const dz = b.z - feet.z;
    const h = Math.hypot(dx, dz);
    const speed = Math.min(WALK_SPEED, h / DT);
    vy = grounded ? -1 : vy - GRAVITY * DT;
    const r = world.move(
      WALKER,
      vec3(h > 1e-6 ? (dx / h) * speed : 0, vy, h > 1e-6 ? (dz / h) * speed : 0),
      DT,
    );
    grounded = r.grounded;
  }
  const end = world.positionOf(WALKER) ?? a;
  return { arrived: distance(end, b) <= ARRIVE, minY: Math.min(minY, end.y), end };
}

function interior(map: MapDefinition, routeId: string): ReadonlySet<string> {
  const r = map.routes.find((x) => x.id === routeId);
  return new Set(r ? r.nodes.slice(1, -1) : []);
}

function reachableWithout(g: NavGraph, from: NodeId, to: NodeId, banned: ReadonlySet<NodeId>) {
  const seen = new Set<NodeId>([from]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i] as NodeId;
    if (cur === to) return true;
    for (const e of g.edges(cur)) {
      if (!seen.has(e.to) && !banned.has(e.to)) {
        seen.add(e.to);
        queue.push(e.to);
      }
    }
  }
  return false;
}

describe.each(SHIPPED_MAPS.map((m) => [m.id, m] as const))(
  `shipped map %s (Rapier)${RAPIER_SKIP_REASON}`,
  (_id, map) => {
    let world: PhysicsWorld;
    let graph: NavGraph;

    beforeAll(() => {
      if (!rapierAvailable) return;
      world = createPhysicsWorld(map);
      const built = buildNavGraph(map, world);
      expect(built.ok ? [] : built.error).toEqual([]);
      if (built.ok) graph = built.value;
      expect(world.addCharacter(WALKER, DEFAULT_CHARACTER, map.playerSpawns[0]!.pos)).toBe(true);
    });

    afterAll(() => {
      if (rapierAvailable) world.dispose();
    });

    it.skipIf(!rapierAvailable)('passes static validation', () => {
      const cat = createMapCatalog([map]);
      expect(cat.ok ? [] : cat.error).toEqual([]);
    });

    it.skipIf(!rapierAvailable)('BR-WM-37: the nav graph is one connected component', () => {
      for (let i = 1; i < graph.nodeCount; i++) expect(graph.isReachable(0, i)).toBe(true);
    });

    it.skipIf(!rapierAvailable)(
      'BR-WM-22: ≥ 3 routes, disjoint interiors, each walkable with the others removed',
      () => {
        expect(map.routes.length).toBeGreaterThanOrEqual(3);
        const all = map.routes.map((r) => interior(map, r.id));
        for (let i = 0; i < all.length; i++) {
          for (let j = i + 1; j < all.length; j++) {
            const shared = [...(all[i] ?? [])].filter((n) => all[j]?.has(n));
            expect(shared, `${map.routes[i]!.id} vs ${map.routes[j]!.id}`).toEqual([]);
          }
        }
        for (const r of map.routes) {
          const banned = new Set<NodeId>();
          for (const other of map.routes) {
            if (other.id === r.id) continue;
            for (const id of interior(map, other.id)) banned.add(graph.nodeByName(id)!);
          }
          const from = graph.nodeByName(r.nodes[0]!)!;
          const to = graph.nodeByName(r.nodes[r.nodes.length - 1]!)!;
          expect(reachableWithout(graph, from, to, banned), r.id).toBe(true);
        }
      },
    );

    it.skipIf(!rapierAvailable)('BR-WM-21: content counts by tag and role', () => {
      const elevated = map.navNodes.filter((n) => n.tags.includes('elevated') && n.pos.y >= 2.5);
      expect(elevated.length).toBeGreaterThanOrEqual(1);
      expect(map.navNodes.filter((n) => n.tags.includes('corridor')).length).toBeGreaterThanOrEqual(
        4,
      );
      expect(map.coverPoints.length).toBeGreaterThanOrEqual(30);
      expect(map.solids.some((s) => s.role === 'ramp')).toBe(true);
      expect(map.solids.some((s) => s.role === 'prop')).toBe(true);
    });

    it.skipIf(!rapierAvailable)(
      'BR-WM-23: a character walks from a player spawn up to every elevated node',
      () => {
        const start = map.playerSpawns[0]!.pos;
        for (const n of map.navNodes.filter((x) => x.tags.includes('elevated'))) {
          const path = graph.findPath(start, n.pos);
          expect(path, n.id).not.toBeNull();
          const pts = path!.points;
          for (let i = 1; i < pts.length; i++) {
            const r = walk(world, pts[i - 1]!, pts[i]!);
            expect(r.arrived, `${n.id} segment ${String(i)}`).toBe(true);
          }
        }
      },
    );

    it.skipIf(!rapierAvailable)(
      'req-map-desert AC3: the real controller walks every link both ways and never falls out',
      () => {
        const failures: string[] = [];
        for (let i = 0; i < graph.nodeCount; i++) {
          for (const e of graph.edges(i)) {
            const a = graph.node(i);
            const b = graph.node(e.to);
            const r = walk(world, a.pos, b.pos);
            if (!r.arrived || r.minY < map.bounds.killY) failures.push(`${a.id} -> ${b.id}`);
          }
        }
        expect(failures).toEqual([]);
      },
    );

    it.skipIf(!rapierAvailable)(
      'negative control: walking straight into the screen wall does not arrive',
      () => {
        if (map.id !== 'desert-compound') return;
        const r = walk(world, vec3(0, 0, 34), vec3(0, 0, 22.5));
        expect(r.arrived).toBe(false);
        expect(r.end.z).toBeGreaterThan(26.3);
      },
    );

    it.skipIf(!rapierAvailable)('BR-WM-30a: spawns are clear of geometry and on the ground', () => {
      for (const s of [...map.playerSpawns, ...map.botSpawns]) {
        expect(
          world.overlapsCapsule(s.pos, DEFAULT_CHARACTER.radius, DEFAULT_CHARACTER.standHeight),
          s.id,
        ).toBe(false);
        const down = world.raycast(
          vec3(s.pos.x, s.pos.y + 0.5, s.pos.z),
          vec3(0, -1, 0),
          0.6,
          MASK_WORLD,
        );
        expect(down, s.id).not.toBeNull();
      }
    });

    it.skipIf(!rapierAvailable)(
      'BR-WM-24: spawn areas are ≥ 20 m apart with no line of sight',
      () => {
        for (const p of map.playerSpawns) {
          for (const b of map.botSpawns) {
            expect(Math.hypot(p.pos.x - b.pos.x, p.pos.z - b.pos.z)).toBeGreaterThanOrEqual(20);
            const pe = vec3(p.pos.x, p.pos.y + EYE, p.pos.z);
            const be = vec3(b.pos.x, b.pos.y + EYE, b.pos.z);
            expect(world.lineOfSight(pe, be), `${p.id} sees ${b.id}`).toBe(false);
          }
        }
      },
    );

    it.skipIf(!rapierAvailable)(
      'BR-WM-30b: selectSpawns(20) succeeds for 50 seeds from every player spawn',
      () => {
        const los = (a: Vec3, b: Vec3) => world.lineOfSight(a, b);
        for (const p of map.playerSpawns) {
          const single = { ...map, playerSpawns: [p] };
          for (let seed = 1; seed <= 50; seed++) {
            const plan = selectSpawns(single, 20, createRng(seed), los);
            expect(plan.ok, `${p.id} seed ${String(seed)}`).toBe(true);
            if (!plan.ok) continue;
            expect(plan.value.bots).toHaveLength(20);
            for (const [i, a] of plan.value.bots.entries()) {
              for (const b of plan.value.bots.slice(i + 1)) {
                expect(Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z)).toBeGreaterThanOrEqual(
                  1.5,
                );
              }
            }
          }
        }
      },
    );

    it.skipIf(!rapierAvailable)('BR-WM-19: the playable area is enclosed', () => {
      const rng = createRng(19);
      const { min, max } = map.bounds;
      const dirs = [vec3(1, 0, 0), vec3(-1, 0, 0), vec3(0, 0, 1), vec3(0, 0, -1)];
      for (let i = 0; i < 30; i++) {
        const x = rng.range(min.x + 1, max.x - 1);
        const z = rng.range(min.z + 1, max.z - 1);
        for (const y of [1, 3]) {
          for (const d of dirs) {
            const hit = world.raycast(vec3(x, y, z), d, 300, MASK_WORLD);
            expect(hit).not.toBeNull();
            const p = hit!.point;
            expect(p.x).toBeGreaterThanOrEqual(min.x - 1e-3);
            expect(p.x).toBeLessThanOrEqual(max.x + 1e-3);
            expect(p.z).toBeGreaterThanOrEqual(min.z - 1e-3);
            expect(p.z).toBeLessThanOrEqual(max.z + 1e-3);
          }
        }
      }
    });
  },
);
