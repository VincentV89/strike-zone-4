// Checks that apply only to the Industrial Warehouse (business-rules-warehouse-map). The
// shared static, content and Rapier suites also run on it through SHIPPED_MAPS (BR-WH-50).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MASK_WORLD, PLAYER_ID, createRng, degToRad, vec3, type Vec3 } from '@sz/kernel';
import {
  createMapCatalog,
  desertCompound,
  footprint2d,
  industrialWarehouse as map,
  selectSpawns,
  solidTop,
  validateMap,
  type NavNodeDef,
  type Solid,
} from '@sz/maps';
import { buildNavGraph, type NavGraph } from '@sz/nav';
import { DEFAULT_CHARACTER, createPhysicsWorld, type PhysicsWorld } from '@sz/physics';
import { createPlayerMotion, placePlayer, stepMovement } from '@sz/player';
import { createBoxWorldQuery } from '../support/box-world-query';
import { edgeList, fnv1aString } from '../support/nav-digest';
import { RAPIER_SKIP_REASON, rapierAvailable } from '../support/rapier-probe';

// Pinned from the first green run against the box-world query (BR-WH-27, SD-WH-6). Any
// change to the warehouse data changes these on purpose.
const WAREHOUSE_NODE_COUNT = 182;
const WAREHOUSE_LINK_COUNT = 456;
const WAREHOUSE_DIGEST = 'ac562957';

const DT = 1 / 60;
const EYE = 1.62;
/** SEC-WH-06 bounds: highest foot height in the air, and the highest surface to stand on. */
const ESCAPE_CEILING = 6.5;
const MAX_STANDING_HEIGHT = 5.2;
const byId = (id: string): Solid => {
  const s = map.solids.find((x) => x.id === id);
  if (!s) throw new Error(`no solid ${id}`);
  return s;
};
const bottom = (s: Solid) => s.center.y - s.half.y;
const spanX = (s: Solid): readonly [number, number] => [
  s.center.x - s.half.x,
  s.center.x + s.half.x,
];

function boxGraph(q = createBoxWorldQuery(map)): NavGraph {
  const built = buildNavGraph(map, q);
  if (!built.ok) throw new Error(JSON.stringify(built.error));
  return built.value;
}

describe('Industrial Warehouse data', () => {
  it('BR-WH-01: id, name and catalog order after Desert Compound', () => {
    expect(map.id).toBe('industrial-warehouse');
    expect(map.name).toBe('Industrial Warehouse');
    const cat = createMapCatalog([desertCompound, map]);
    expect(cat.ok).toBe(true);
    if (!cat.ok) return;
    expect(cat.value.listMaps().map((m) => m.id)).toEqual([
      'desert-compound',
      'industrial-warehouse',
    ]);
    expect(cat.value.getMap('industrial-warehouse')).toBe(map);
  });

  it('BR-WH-05 / SEC-WH-08: validates with zero errors and stays inside the unit budgets', () => {
    expect(validateMap(map)).toEqual([]);
    expect(map.solids.length).toBe(56);
    expect(map.solids.length).toBeLessThanOrEqual(80);
    expect(map.solids.filter((s) => s.castShadow).length).toBeLessThanOrEqual(60);
    expect(map.navNodes.length).toBe(182);
    expect(map.navNodes.length).toBeLessThanOrEqual(250);
  });

  it('BR-WH-10: bounds, kill height and a concrete ground slab with top y = 0', () => {
    expect(map.bounds).toEqual({ min: vec3(-40, -1, -40), max: vec3(40, 16, 40), killY: -10 });
    const ground = map.solids.filter((s) => s.role === 'ground');
    expect(ground.map((s) => [s.id, s.material, solidTop(s)])).toEqual([['ground', 'concrete', 0]]);
  });

  it('BR-WH-11: open top; the only roof solid is the gantry deck; boundary ≥ 12 m', () => {
    expect(map.solids.filter((s) => s.role === 'roof').map((s) => s.id)).toEqual(['gantry-deck']);
    const boundary = map.solids.filter((s) => s.role === 'boundary');
    expect(boundary).toHaveLength(4);
    for (const s of boundary) expect(solidTop(s), s.id).toBeGreaterThanOrEqual(12);
  });

  it.each(['south', 'north'])(
    'BR-WH-12: the %s cross wall is 6 m tall with three gates at x = −28, 0 and 28.6',
    (prefix) => {
      const segs = map.solids
        .filter((s) => s.id.startsWith(`${prefix}-wall-`))
        .map(spanX)
        .sort((a, b) => a[0] - b[0]);
      expect(segs).toHaveLength(4);
      for (const s of map.solids.filter((x) => x.id.startsWith(`${prefix}-wall-`))) {
        expect(solidTop(s)).toBe(6);
      }
      const gates = segs.slice(1).map((s, i) => [segs[i]![1], s[0]] as const);
      expect(gates).toHaveLength(3);
      for (const [g, x] of gates.map((g, i) => [g, [-28, 0, 28.6][i]!] as const)) {
        expect(g[1] - g[0]).toBeGreaterThanOrEqual(3);
        expect(x).toBeGreaterThan(g[0]);
        expect(x).toBeLessThan(g[1]);
      }
      expect(segs[0]![0]).toBe(-40);
      expect(segs[3]![1]).toBe(40);
    },
  );

  it('BR-WH-14: containers are 2.5 × 2.6 m, 6 or 12 m long, props, never named crate/stack', () => {
    const containers = map.solids.filter((s) => s.material === 'container-paint');
    expect(containers).toHaveLength(10);
    for (const s of containers) {
      expect(s.role, s.id).toBe('prop');
      expect(s.id).not.toMatch(/crate|stack/);
      expect(s.half.x * 2, s.id).toBeCloseTo(2.5, 9);
      expect(s.half.y * 2, s.id).toBeCloseTo(2.6, 9);
      expect([6, 12]).toContain(Math.round(s.half.z * 2));
    }
  });

  it('BR-WH-15: at least 8 crates of 1.2 m on the main floor', () => {
    const crates = map.solids.filter(
      (s) => /crate/.test(s.id) && Math.abs(s.center.x) < 14.4 && Math.abs(s.center.z) < 27.5,
    );
    expect(crates.length).toBeGreaterThanOrEqual(8);
    for (const s of crates) expect(s.half.y * 2).toBeCloseTo(1.2, 9);
  });

  it('BR-WH-16: the gantry deck is at 4 m, ≥ 20 m long, with ≥ 5 elevated nodes and ≤ 30° ramps', () => {
    const deck = byId('gantry-deck');
    expect(solidTop(deck)).toBeCloseTo(4, 9);
    expect(deck.half.z * 2).toBeGreaterThanOrEqual(20);
    const elevated = map.navNodes.filter((n) => n.tags.includes('elevated'));
    expect(elevated.length).toBeGreaterThanOrEqual(5);
    for (const n of elevated) expect(n.pos.y).toBe(4);
    const ramps = map.solids.filter((s) => s.role === 'ramp');
    expect(ramps.map((s) => s.id).sort()).toEqual(['gantry-ramp-n', 'gantry-ramp-s']);
    for (const r of ramps) {
      expect(Math.abs(r.pitch)).toBeLessThanOrEqual(degToRad(30));
      expect(Math.abs(r.pitch)).toBeCloseTo(Math.atan(4 / 10), 9);
    }
  });

  it('BR-WH-17: the deck is closed by the parapet on the west and storage-e on the east', () => {
    const parapets = map.solids.filter((s) => s.id.startsWith('gantry-parapet-'));
    expect(parapets).toHaveLength(4);
    const zs = parapets
      .map((s) => [s.center.z - s.half.z, s.center.z + s.half.z] as const)
      .sort((a, b) => a[0] - b[0]);
    expect(zs[0]![0]).toBe(-14);
    expect(zs[3]![1]).toBe(14);
    for (let i = 1; i < zs.length; i++) expect(zs[i]![0]).toBeCloseTo(zs[i - 1]![1], 9);
    for (const s of parapets) {
      expect(bottom(s)).toBeCloseTo(4, 9);
      expect(s.half.y * 2).toBeCloseTo(1.1, 9);
    }
    const deck = byId('gantry-deck');
    const store = byId('storage-e');
    expect(spanX(store)[0]).toBeCloseTo(spanX(deck)[1], 9);
    expect(solidTop(store)).toBeGreaterThanOrEqual(6);
  });

  it('BR-WH-18: only the agreed materials are used', () => {
    const used = new Set(map.solids.map((s) => s.material));
    expect([...used].sort()).toEqual(['concrete', 'container-paint', 'crate-wood', 'metal']);
  });

  it('BR-WH-21: exactly three routes with the agreed ids', () => {
    expect(map.routes.map((r) => r.id)).toEqual(['west-containers', 'main-floor', 'east-gantry']);
    for (const r of map.routes) expect(r.nodes.length).toBeGreaterThanOrEqual(3);
  });

  it('BR-WH-22: every route step is explicit; exactly the four ramp steps are ramp links', () => {
    const links = new Set(map.navLinks.map((l) => `${l.a}|${l.b}`));
    for (const r of map.routes) {
      for (let i = 1; i < r.nodes.length; i++) {
        expect(links.has(`${r.nodes[i - 1]!}|${r.nodes[i]!}`), r.id).toBe(true);
      }
    }
    expect(map.navLinks.filter((l) => l.kind === 'ramp').map((l) => `${l.a}|${l.b}`)).toEqual([
      'gantry-1|gantry-2',
      'gantry-2|gantry-3',
      'gantry-7|gantry-8',
      'gantry-8|gantry-9',
    ]);
  });

  it('BR-WH-23: exactly 34 cover points; the 4 deck points are at y = 4 and crouch-only', () => {
    expect(map.coverPoints).toHaveLength(34);
    const deck = map.coverPoints.filter((c) => c.id.startsWith('cover-gantry-parapet-'));
    expect(deck).toHaveLength(4);
    for (const c of deck) {
      expect(c.pos.y).toBeCloseTo(4, 9);
      expect(c.crouchOnly).toBe(true);
    }
    for (const c of map.coverPoints) {
      const solidId = c.id.replace(/^cover-/, '').replace(/-[nsew]$/, '');
      expect(c.crouchOnly, c.id).toBe(byId(solidId).half.y * 2 < 1.5);
    }
  });

  it('BR-WH-24: ≥ 4 corridor nodes and ≥ 1 elevated node at y ≥ 2.5 m', () => {
    expect(map.navNodes.filter((n) => n.tags.includes('corridor'))).toHaveLength(9);
    expect(map.navNodes.filter((n) => n.tags.includes('elevated') && n.pos.y >= 2.5)).toHaveLength(
      5,
    );
  });

  it('BR-WH-25: 12 patrol points on patrol nodes, covering every lane region', () => {
    expect(map.patrolPoints).toHaveLength(12);
    const patrolNodes = map.navNodes.filter((n) => n.tags.includes('patrol'));
    expect(patrolNodes).toHaveLength(12);
    const region = (n: NavNodeDef) => n.id.replace(/-[^-]+$/, '').replace(/^bay-n.*/, 'bay-n');
    expect(new Set(patrolNodes.map(region))).toEqual(
      new Set(['west', 'main', 'aisle-w', 'aisle-e', 'floor-east', 'gantry', 'bay-n']),
    );
  });

  it('BR-WH-27: node count, link count and adjacency digest are pinned literals', () => {
    const q = createBoxWorldQuery(map);
    const g = boxGraph(q);
    const edges = edgeList(g);
    expect(q.calls.raycast + q.calls.lineOfSight).toBeLessThanOrEqual(10_000); // NFR-WH-P1
    expect(g.nodeCount).toBe(WAREHOUSE_NODE_COUNT);
    expect(edges.length).toBe(WAREHOUSE_LINK_COUNT);
    expect(fnv1aString(edges.join('\n'))).toBe(WAREHOUSE_DIGEST);
  });

  it('rack-gap nodes link each side aisle straight to the main floor (human decision 2026-11-16)', () => {
    const g = boxGraph();
    const gaps = map.navNodes.filter((n) => n.id.startsWith('rack-gap-'));
    expect(gaps).toHaveLength(6);
    for (const n of gaps) {
      const near = g.edges(g.nodeByName(n.id)!).map((e) => g.node(e.to).id);
      expect(
        near.some((id) => id.startsWith('aisle-')),
        n.id,
      ).toBe(true);
      expect(
        near.some((id) => /^(main|floor-east)-/.test(id)),
        n.id,
      ).toBe(true);
    }
  });

  it('BR-WH-30: 6 player spawns in south-bay and 12 bot spawns in each north bay', () => {
    expect(map.playerSpawns.map((s) => s.area)).toEqual(Array(6).fill('south-bay'));
    const areas = map.botSpawns.map((s) => s.area);
    expect(areas.filter((a) => a === 'nw-bay')).toHaveLength(12);
    expect(areas.filter((a) => a === 'ne-bay')).toHaveLength(12);
    for (const p of map.playerSpawns) {
      for (const b of map.botSpawns) {
        expect(Math.hypot(p.pos.x - b.pos.x, p.pos.z - b.pos.z)).toBeGreaterThanOrEqual(69);
      }
    }
  });

  it('BR-WH-33: selectSpawns returns exactly N bots for every supported count', () => {
    const q = createBoxWorldQuery(map);
    const los = (a: Vec3, b: Vec3) => q.lineOfSight(a, b);
    for (const n of [1, 2, 3, 5, 8, 10, 15, 20] as const) {
      const plan = selectSpawns(map, n, createRng(33), los);
      expect(plan.ok, String(n)).toBe(true);
      if (plan.ok) expect(plan.value.bots).toHaveLength(n);
    }
  });

  it('BR-WH-40 / BR-WH-41: steep sun, darker hemisphere and indoor fog', () => {
    const { sun, hemisphere, fog } = map.lights;
    expect(sun.direction.y).toBeLessThan(-0.85);
    expect(Math.hypot(sun.direction.x, sun.direction.y, sun.direction.z)).toBeCloseTo(1, 9);
    expect(sun).toMatchObject({ color: '#F4F1EA', intensity: 2 });
    expect(hemisphere).toEqual({ sky: '#9AA6B2', ground: '#4A4640', intensity: 0.45 });
    expect(fog).toEqual({ color: '#2E3238', near: 35, far: 110 });
  });
});

/** Horizontal distance from (x, z) to a convex footprint polygon (0 inside). */
function distanceToFootprint(p: Vec3, s: Solid): number {
  const poly = footprint2d(s);
  let best = Infinity;
  let pos = 0;
  let neg = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const cross = ex * (p.z - a.z) - ez * (p.x - a.x);
    if (cross > 0) pos++;
    if (cross < 0) neg++;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.z - a.z) * ez) / (ex * ex + ez * ez)));
    best = Math.min(best, Math.hypot(p.x - (a.x + ex * t), p.z - (a.z + ez * t)));
  }
  return pos === 0 || neg === 0 ? 0 : best;
}

/** Elevated nodes plus nodes within 3 m of a boundary or wall footprint (SD-WH-5). */
function escapeStartNodes(): ReadonlyArray<NavNodeDef> {
  const walls = map.solids.filter((s) => s.role === 'boundary' || s.role === 'wall');
  return map.navNodes.filter(
    (n) => n.tags.includes('elevated') || walls.some((w) => distanceToFootprint(n.pos, w) <= 3),
  );
}

/** Walks the raw character controller toward `dir` for `seconds`; returns the lowest y seen. */
function slide(world: PhysicsWorld, from: Vec3, dir: Vec3, seconds: number): number {
  world.teleport(PLAYER_ID, vec3(from.x, from.y + 0.1, from.z));
  let minY = Infinity;
  let vy = 0;
  let grounded = false;
  for (let i = 0; i < Math.ceil(seconds / DT); i++) {
    vy = grounded ? -1 : vy - 18 * DT;
    grounded = world.move(PLAYER_ID, vec3(dir.x * 5, vy, dir.z * 5), DT).grounded;
    minY = Math.min(minY, world.positionOf(PLAYER_ID)?.y ?? -Infinity);
  }
  return minY;
}

describe.skipIf(!rapierAvailable)(`Industrial Warehouse on Rapier${RAPIER_SKIP_REASON}`, () => {
  let world: PhysicsWorld;

  beforeAll(() => {
    world = createPhysicsWorld(map);
    expect(world.addCharacter(PLAYER_ID, DEFAULT_CHARACTER, map.playerSpawns[0]!.pos)).toBe(true);
  });

  afterAll(() => {
    world.dispose();
  });

  it('BR-WH-27: the box query and Rapier build the same graph', () => {
    const built = buildNavGraph(map, world);
    expect(built.ok ? [] : built.error).toEqual([]);
    if (!built.ok) return;
    expect(built.value.nodeCount).toBe(WAREHOUSE_NODE_COUNT);
    expect(edgeList(built.value)).toEqual(edgeList(boxGraph()));
  });

  it('BR-WH-13: the west container corridor is 2.5 to 3.5 m wide along its length', () => {
    const zs: number[] = [];
    for (let z = -19; z <= 19; z += 1) if (Math.abs(z) >= 2) zs.push(z);
    for (const z of zs) {
      for (const dx of [-1, 1]) {
        const hit = world.raycast(vec3(-28, 1, z), vec3(dx, 0, 0), 5, MASK_WORLD);
        expect(hit, `z ${String(z)} dx ${String(dx)}`).not.toBeNull();
        expect(hit!.distance).toBeGreaterThanOrEqual(1.25);
        expect(hit!.distance).toBeLessThanOrEqual(1.75);
      }
    }
  });

  it('BR-WH-17: a sideways walk from every deck node stays on the deck', () => {
    // gantry-3 and gantry-7 sit where the deck meets the ramp tops; a ramp's sides are open
    // by design, so stepping off one is not walking off the deck.
    const deckNodes = map.navNodes.filter(
      (x) => x.tags.includes('elevated') && Math.abs(x.pos.z) < 13,
    );
    expect(deckNodes.map((x) => x.id)).toEqual(['gantry-4', 'gantry-5', 'gantry-6']);
    for (const n of deckNodes) {
      for (const dx of [-1, 1]) {
        expect(
          slide(world, n.pos, vec3(dx, 0, 0), 2),
          `${n.id} dx ${String(dx)}`,
        ).toBeGreaterThanOrEqual(3.9);
      }
    }
  });

  it('BR-WH-52: walking straight from the player bay into screen-s does not arrive', () => {
    world.teleport(PLAYER_ID, vec3(0, 0.1, 31));
    for (let i = 0; i < 4 / DT; i++) world.move(PLAYER_ID, vec3(0, -1, -5), DT);
    const end = world.positionOf(PLAYER_ID)!;
    expect(end.z).toBeGreaterThan(24.3);
    expect(Math.hypot(end.x, end.z - 20)).toBeGreaterThan(0.6);
  });

  it('SD-WH-3: without the two screen walls some spawn pair can see each other', () => {
    const open = createPhysicsWorld({
      ...map,
      solids: map.solids.filter((s) => s.id !== 'screen-s' && s.id !== 'screen-n'),
    });
    try {
      let visible = 0;
      for (const p of map.playerSpawns) {
        for (const b of map.botSpawns) {
          const pe = vec3(p.pos.x, p.pos.y + EYE, p.pos.z);
          const be = vec3(b.pos.x, b.pos.y + EYE, b.pos.z);
          if (open.lineOfSight(pe, be)) visible++;
        }
      }
      expect(visible).toBeGreaterThan(0);
    } finally {
      open.dispose();
    }
  });

  // The character controller's 0.4 m autostep plus the 1.0 m jump apex lets a player climb a
  // ledge of up to about 1.4 m, which includes the 1.1 m gantry parapet (top 5.1 m). From there
  // a jump peaks near 6.05 m. That is still 6 m below the 12 m boundary, and the 6 m storage-e
  // roof is 3.8 m away across the deck. So the ceiling is 6.5 m in the air, and the highest
  // grounded foot height is the parapet top (human decision, 2026-11-16).
  it('SEC-WH-06: sprint-jumping in 8 directions never leaves the hall or climbs too high', () => {
    const starts = escapeStartNodes();
    expect(starts.length).toBeGreaterThanOrEqual(20);
    expect(starts.length).toBeLessThanOrEqual(100);
    const failures: string[] = [];
    let highestGrounded = -Infinity;
    const intent = {
      move: { forward: 1, right: 0 },
      sprint: true,
      crouch: false,
      jump: true,
    } as const;
    for (const n of starts) {
      for (let k = 0; k < 8; k++) {
        const pose = { position: n.pos, yaw: (k * Math.PI) / 4 };
        const motion = createPlayerMotion(pose);
        expect(placePlayer(motion, world, pose)).toBe(true);
        for (let t = 0; t < 120; t++) {
          const out = stepMovement(motion, intent, world, DT, { move: true });
          world.step(DT);
          const p = world.positionOf(PLAYER_ID)!;
          if (out.grounded) highestGrounded = Math.max(highestGrounded, p.y);
          const ok =
            Number.isFinite(p.x + p.y + p.z) &&
            Math.abs(p.x) <= 40 &&
            Math.abs(p.z) <= 40 &&
            p.y >= -0.5 &&
            p.y <= ESCAPE_CEILING;
          if (!ok) {
            failures.push(`${n.id} yaw ${String(k)} tick ${String(t)} at ${JSON.stringify(p)}`);
            break;
          }
        }
      }
    }
    expect(failures).toEqual([]);
    expect(highestGrounded).toBeLessThanOrEqual(MAX_STANDING_HEIGHT);
  }, 60_000);
});
