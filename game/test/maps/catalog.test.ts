// Map catalog and static validation (BR-WM-01 to BR-WM-18, SEC-WM-01, SEC-WM-08).
import { describe, expect, it } from 'vitest';
import { vec3 } from '@sz/kernel';
import {
  MAP_LIMITS,
  box,
  createMapCatalog,
  desertCompound,
  node,
  ramp,
  validateMap,
  type MapDefinition,
  type MapValidationCode,
} from '@sz/maps';
import { fixtureMap } from './fixture-map';

const codes = (m: MapDefinition) => validateMap(m).map((e) => `${e.code}@${e.path}`);
const hasCode = (m: MapDefinition, code: MapValidationCode, path?: string) =>
  validateMap(m).some((e) => e.code === code && (path === undefined || e.path === path));

describe('createMapCatalog', () => {
  it('accepts Desert Compound and lists maps in registration order (BR-WM-04)', () => {
    const second = fixtureMap({ id: 'industrial-warehouse', name: 'Second' });
    const cat = createMapCatalog([desertCompound, second]);
    expect(cat.ok).toBe(true);
    if (!cat.ok) return;
    expect(cat.value.listMaps().map((m) => m.id)).toEqual([
      'desert-compound',
      'industrial-warehouse',
    ]);
    expect(cat.value.listMaps()[0]).toEqual({
      id: 'desert-compound',
      name: desertCompound.name,
      blurb: desertCompound.blurb,
    });
  });

  it('BR-WM-05: returns the same objects, deep-frozen (SD-WM-9)', () => {
    const def = fixtureMap();
    const cat = createMapCatalog([def]);
    if (!cat.ok) throw new Error('fixture invalid');
    expect(cat.value.getMap('desert-compound')).toBe(def);
    expect(Object.isFrozen(def)).toBe(true);
    expect(Object.isFrozen(def.solids[0]?.center)).toBe(true);
    expect(Object.isFrozen(def.routes[0]?.nodes)).toBe(true);
  });

  it('BR-WM-07: an unregistered id returns undefined; has() reports it', () => {
    const cat = createMapCatalog([fixtureMap()]);
    if (!cat.ok) throw new Error('fixture invalid');
    expect(cat.value.getMap('industrial-warehouse')).toBeUndefined();
    expect(cat.value.has('industrial-warehouse')).toBe(false);
    expect(cat.value.has('desert-compound')).toBe(true);
  });

  it('BR-WM-02: duplicate map ids fail', () => {
    const cat = createMapCatalog([fixtureMap(), fixtureMap()]);
    expect(cat.ok ? [] : cat.error.map((e) => e.code)).toEqual(['duplicate-map']);
  });

  it('BR-WM-03: returns every error, not only the first', () => {
    const broken = fixtureMap({ routes: [], playerSpawns: [], name: 'x' });
    const cat = createMapCatalog([broken]);
    const found = cat.ok ? [] : cat.error.map((e) => e.code);
    expect(found).toContain('too-few-routes');
    expect(found).toContain('too-few-spawns');
  });

  it('SEC-WM-01: hostile ids are ordinary keys', () => {
    const cat = createMapCatalog([fixtureMap()]);
    if (!cat.ok) throw new Error('fixture invalid');
    for (const id of ['__proto__', 'constructor', 'toString', '', 'x'.repeat(10_000)]) {
      expect(cat.value.getMap(id as MapDefinition['id'])).toBeUndefined();
      expect(cat.value.has(id as MapDefinition['id'])).toBe(false);
    }
    const dup = fixtureMap({
      solids: [
        ...fixtureMap().solids,
        box('__proto__', 'prop', vec3(0, 0, 5), vec3(1, 1, 6), 'metal'),
        box('__proto__', 'prop', vec3(0, 0, 8), vec3(1, 1, 9), 'metal'),
      ],
    });
    expect(hasCode(dup, 'duplicate-id')).toBe(true);
  });
});

describe('validateMap', () => {
  it('the fixture is valid', () => {
    expect(codes(fixtureMap())).toEqual([]);
  });

  it('BR-WM-10: duplicate ids in a collection', () => {
    const f = fixtureMap();
    expect(
      hasCode(
        fixtureMap({ navNodes: [...f.navNodes, f.navNodes[0]!] }),
        'duplicate-id',
        `navNodes[${String(f.navNodes.length)}].id`,
      ),
    ).toBe(true);
    expect(
      hasCode(fixtureMap({ botSpawns: [...f.botSpawns, f.botSpawns[0]!] }), 'duplicate-id'),
    ).toBe(true);
  });

  it('BR-WM-11: half extents in (0, 60], finite, centre within bounds + 2 m', () => {
    const f = fixtureMap();
    const add = (s: ReturnType<typeof box>) => fixtureMap({ solids: [...f.solids, s] });
    expect(
      hasCode(
        add({ ...box('z', 'prop', vec3(0, 0, 0), vec3(1, 1, 1), 'metal'), half: vec3(0, 1, 1) }),
        'bad-solid',
        'solids[6].half.x',
      ),
    ).toBe(true);
    expect(
      hasCode(
        add({ ...box('z', 'prop', vec3(0, 0, 0), vec3(1, 1, 1), 'metal'), half: vec3(1, 61, 1) }),
        'bad-solid',
        'solids[6].half.y',
      ),
    ).toBe(true);
    expect(
      hasCode(
        add({
          ...box('z', 'prop', vec3(0, 0, 0), vec3(1, 1, 1), 'metal'),
          center: vec3(Number.NaN, 0, 0),
        }),
        'bad-solid',
        'solids[6]',
      ),
    ).toBe(true);
    expect(
      hasCode(
        add(box('far', 'prop', vec3(60, 0, 0), vec3(61, 1, 1), 'metal')),
        'out-of-bounds',
        'solids[6].center',
      ),
    ).toBe(true);
    expect(codes(add(box('edge', 'prop', vec3(50, 0, 0), vec3(52, 1, 1), 'metal')))).toEqual([]);
  });

  it('BR-WM-12: killY at least 5 m below the lowest ground top; bounds well-formed', () => {
    const b = fixtureMap().bounds;
    expect(hasCode(fixtureMap({ bounds: { ...b, killY: -4 } }), 'bad-bounds', 'bounds.killY')).toBe(
      true,
    );
    expect(codes(fixtureMap({ bounds: { ...b, killY: -5 } }))).toEqual([]);
    expect(hasCode(fixtureMap({ bounds: { ...b, min: b.max } }), 'bad-bounds', 'bounds')).toBe(
      true,
    );
    expect(
      hasCode(
        fixtureMap({ solids: fixtureMap().solids.filter((s) => s.role !== 'ground') }),
        'bad-bounds',
        'bounds.killY',
      ),
    ).toBe(true);
  });

  it('BR-WM-13: spawn counts and areas', () => {
    const f = fixtureMap();
    expect(
      hasCode(
        fixtureMap({ playerSpawns: f.playerSpawns.slice(0, 3) }),
        'too-few-spawns',
        'playerSpawns',
      ),
    ).toBe(true);
    expect(
      hasCode(fixtureMap({ botSpawns: f.botSpawns.slice(0, 23) }), 'too-few-spawns', 'botSpawns'),
    ).toBe(true);
    expect(
      hasCode(
        fixtureMap({ botSpawns: f.botSpawns.map((s) => ({ ...s, area: 'one' })) }),
        'too-few-spawns',
        'botSpawns',
      ),
    ).toBe(true);
    const outside = f.playerSpawns.map((s, i) => (i === 0 ? { ...s, pos: vec3(0, 0, 51) } : s));
    expect(
      hasCode(fixtureMap({ playerSpawns: outside }), 'out-of-bounds', 'playerSpawns[0].pos'),
    ).toBe(true);
  });

  it('BR-WM-14: patrol, cover and spawn points need tagged nav nodes', () => {
    const f = fixtureMap();
    expect(
      hasCode(
        fixtureMap({ patrolPoints: [{ id: 'x', pos: vec3(20, 0, 20.1) }] }),
        'missing-tagged-node',
        'patrolPoints[0]',
      ),
    ).toBe(true);
    expect(codes(fixtureMap({ patrolPoints: [{ id: 'x', pos: vec3(20, 0, 20.04) }] }))).toEqual([]);
    expect(
      hasCode(
        fixtureMap({ navNodes: f.navNodes.filter((n) => n.id !== 'cover') }),
        'missing-tagged-node',
        'coverPoints[0]',
      ),
    ).toBe(true);
    const untagged = f.navNodes.map((n) => (n.id === 'n-p0' ? { ...n, tags: [] } : n));
    expect(
      hasCode(fixtureMap({ navNodes: untagged }), 'missing-tagged-node', 'playerSpawns[0]'),
    ).toBe(true);
    const moved = f.navNodes.map((n) =>
      n.id === 'n-b0' ? { ...n, pos: vec3(n.pos.x, 0, n.pos.z + 3.1) } : n,
    );
    expect(hasCode(fixtureMap({ navNodes: moved }), 'missing-tagged-node', 'botSpawns[0]')).toBe(
      true,
    );
  });

  it('BR-WM-15: at least 3 routes of at least 3 known nodes; links reference known nodes', () => {
    const f = fixtureMap();
    expect(hasCode(fixtureMap({ routes: f.routes.slice(0, 2) }), 'too-few-routes', 'routes')).toBe(
      true,
    );
    const short = f.routes.map((r, i) => (i === 0 ? { ...r, nodes: r.nodes.slice(0, 2) } : r));
    expect(hasCode(fixtureMap({ routes: short }), 'too-few-routes', 'routes[0].nodes')).toBe(true);
    const unknown = f.routes.map((r, i) => (i === 1 ? { ...r, nodes: [...r.nodes, 'nope'] } : r));
    expect(hasCode(fixtureMap({ routes: unknown }), 'unknown-node', 'routes[1].nodes[3]')).toBe(
      true,
    );
    expect(
      hasCode(
        fixtureMap({ navLinks: [{ a: 'r0-0', b: 'ghost', kind: 'walk' }] }),
        'unknown-node',
        'navLinks[0].b',
      ),
    ).toBe(true);
    expect(
      hasCode(
        fixtureMap({ navLinks: [{ a: 'ghost', b: 'r0-0', kind: 'walk' }] }),
        'unknown-node',
        'navLinks[0].a',
      ),
    ).toBe(true);
    const nodes = [...f.navNodes, node('nan', vec3(Number.NaN, 0, 0))];
    expect(hasCode(fixtureMap({ navNodes: nodes }), 'out-of-bounds')).toBe(true);
    expect(hasCode(fixtureMap({ navAutoLinkRadius: 13 }), 'bad-bounds', 'navAutoLinkRadius')).toBe(
      true,
    );
  });

  it('BR-WM-16: invisible only on boundary solids', () => {
    const f = fixtureMap();
    const s = box('ghost', 'wall', vec3(0, 0, 5), vec3(1, 2, 6), 'invisible');
    expect(hasCode(fixtureMap({ solids: [...f.solids, s] }), 'invisible-not-boundary')).toBe(true);
  });

  it('BR-WM-17: ramps pitch in (0°, 30°]; other roles pitch 0', () => {
    const f = fixtureMap();
    const add = (s: ReturnType<typeof box>) => fixtureMap({ solids: [...f.solids, s] });
    expect(codes(add(ramp('ok', vec3(0, 0, 10), vec3(0, 3, 4.8), 2, 'concrete')))).toEqual([]);
    expect(
      hasCode(add(ramp('steep', vec3(0, 0, 10), vec3(0, 3, 6), 2, 'concrete')), 'bad-ramp'),
    ).toBe(true);
    expect(
      hasCode(
        add({ ...box('flat', 'ramp', vec3(0, 0, 0), vec3(1, 1, 1), 'concrete') }),
        'bad-ramp',
      ),
    ).toBe(true);
    expect(
      hasCode(
        add({ ...box('tilt', 'wall', vec3(0, 0, 0), vec3(1, 1, 1), 'concrete'), pitch: 0.1 }),
        'bad-solid',
        'solids[6].pitch',
      ),
    ).toBe(true);
  });

  it('BR-WM-18: sun is a unit vector above the horizon; intensities and fog are sane', () => {
    const l = fixtureMap().lights;
    const withSun = (direction: ReturnType<typeof vec3>, intensity = 2) =>
      fixtureMap({ lights: { ...l, sun: { ...l.sun, direction, intensity } } });
    expect(hasCode(withSun(vec3(0, -2, 0)), 'bad-light', 'lights.sun.direction')).toBe(true);
    expect(hasCode(withSun(vec3(1, 0, 0)), 'bad-light', 'lights.sun.direction')).toBe(true);
    expect(hasCode(withSun(vec3(0, -1, 0), 0), 'bad-light', 'lights.sun.intensity')).toBe(true);
    expect(
      hasCode(
        fixtureMap({ lights: { ...l, hemisphere: { ...l.hemisphere, intensity: Number.NaN } } }),
        'bad-light',
        'lights.hemisphere.intensity',
      ),
    ).toBe(true);
    expect(
      hasCode(
        fixtureMap({ lights: { ...l, fog: { ...l.fog, near: 100, far: 10 } } }),
        'bad-light',
        'lights.fog',
      ),
    ).toBe(true);
  });

  it('SEC-WM-08: size limits at limit and limit + 1', () => {
    const f = fixtureMap();
    const crates = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        box(`c${String(i)}`, 'prop', vec3(0, 0, 0), vec3(1, 1, 1), 'metal'),
      );
    const atLimit = fixtureMap({
      solids: [...f.solids, ...crates(MAP_LIMITS.solids - f.solids.length)],
    });
    expect(codes(atLimit)).toEqual([]);
    const over = fixtureMap({
      solids: [...f.solids, ...crates(MAP_LIMITS.solids - f.solids.length + 1)],
    });
    expect(codes(over)).toEqual(['too-many@solids']);
    const manyNodes = Array.from({ length: MAP_LIMITS.navNodes + 1 }, (_, i) =>
      node(`x${String(i)}`, vec3(0, 0, 0)),
    );
    expect(codes(fixtureMap({ navNodes: manyNodes }))).toEqual(['too-many@navNodes']);
    const manyLinks = Array.from({ length: MAP_LIMITS.navLinks + 1 }, () => ({
      a: 'r0-0',
      b: 'r0-1',
      kind: 'walk' as const,
    }));
    expect(codes(fixtureMap({ navLinks: manyLinks }))).toEqual(['too-many@navLinks']);
    const manyRoutes = Array.from({ length: MAP_LIMITS.routes + 1 }, (_, i) => ({
      ...f.routes[0]!,
      id: `r${String(i)}`,
    }));
    expect(codes(fixtureMap({ routes: manyRoutes }))).toEqual(['too-many@routes']);
    const manySpawns = Array.from({ length: MAP_LIMITS.spawnsPerKind + 1 }, (_, i) => ({
      ...f.botSpawns[0]!,
      id: `s${String(i)}`,
    }));
    expect(codes(fixtureMap({ botSpawns: manySpawns }))).toEqual(['too-many@botSpawns']);
    expect(codes(fixtureMap({ playerSpawns: manySpawns }))).toEqual(['too-many@playerSpawns']);
  });
});
