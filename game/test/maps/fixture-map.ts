// A small map that passes static validation; tests break one field at a time.
import { vec3 } from '@sz/kernel';
import { box, boundaryRing, node, type MapDefinition, type NavNodeDef } from '@sz/maps';

const BOUNDS = { min: vec3(-50, -1, -50), max: vec3(50, 20, 50), killY: -10 };

export function fixtureMap(overrides: Partial<MapDefinition> = {}): MapDefinition {
  const playerSpawns = [0, 1, 2, 3].map((i) => ({
    id: `p${String(i)}`,
    area: 'south',
    pos: vec3(i * 4, 0, 40),
    yaw: 0,
  }));
  const botSpawns = Array.from({ length: 24 }, (_, i) => ({
    id: `b${String(i)}`,
    area: i < 12 ? 'nw' : 'ne',
    pos: vec3((i % 12) * 4 + (i < 12 ? -48 : 2), 0, -40),
    yaw: Math.PI,
  }));
  const spawnNodes: NavNodeDef[] = [
    ...playerSpawns.map((s) => node(`n-${s.id}`, s.pos, 'spawn-player')),
    ...botSpawns.map((s) => node(`n-${s.id}`, s.pos, 'spawn-bot')),
  ];
  const routeNodes = [0, 1, 2].flatMap((r) =>
    [0, 1, 2].map((k) => node(`r${String(r)}-${String(k)}`, vec3(r * 10, 0, k * 5))),
  );
  return {
    id: 'desert-compound',
    name: 'Fixture',
    blurb: 'A test fixture.',
    bounds: BOUNDS,
    solids: [
      box('ground', 'ground', vec3(-50, -1, -50), vec3(50, 0, 50), 'sand'),
      ...boundaryRing(BOUNDS, 6, 'invisible'),
      box('crate', 'prop', vec3(0, 0, 0), vec3(1, 1, 1), 'crate-wood'),
    ],
    lights: {
      sun: { direction: vec3(0, -1, 0), color: '#fff', intensity: 2 },
      hemisphere: { sky: '#fff', ground: '#000', intensity: 0.5 },
      fog: { color: '#fff', near: 10, far: 100 },
    },
    playerSpawns,
    botSpawns,
    patrolPoints: [{ id: 'pp', pos: vec3(20, 0, 20) }],
    coverPoints: [{ id: 'cp', pos: vec3(2, 0, 0), facing: vec3(-1, 0, 0), crouchOnly: true }],
    navNodes: [
      ...spawnNodes,
      ...routeNodes,
      node('patrol', vec3(20, 0, 20), 'patrol'),
      node('cover', vec3(2, 0, 0), 'cover'),
    ],
    navLinks: [],
    navAutoLinkRadius: 9,
    routes: [0, 1, 2].map((r) => ({
      id: `route-${String(r)}`,
      name: `Route ${String(r)}`,
      nodes: [0, 1, 2].map((k) => `r${String(r)}-${String(k)}`),
    })),
    ...overrides,
  };
}
