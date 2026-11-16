/**
 * Desert Compound navigation data: nodes, explicit links, routes, cover and patrol points
 * (dec-nav-waypoint-graph, BR-WM-31). Same-level links between nearby nodes are generated
 * by buildNavGraph; every route step and every ramp step is an explicit link here.
 */
import { vec3, type Vec3 } from '@sz/kernel';
import { chain, coverBeside, linkChain, node } from './build';
import type {
  CoverPoint,
  NavLinkDef,
  NavNodeDef,
  NavNodeTag,
  PatrolPoint,
  RouteDef,
  Solid,
  SpawnPoint,
} from './types';
import { COURT_STACK, COVER_PROPS } from './desert-solids';

const at = (x: number, z: number): Vec3 => vec3(x, 0, z);
const ROOF_Y = 6;

// ---- spawns ----
const PLAYER_SPAWN_X = [-14, -8, -4, 4, 8, 14] as const;
const BOT_AREAS = [
  { area: 'nw-ruins', xs: [-44, -40, -36, -32.5] },
  { area: 'north-yard', xs: [-6, -2, 2, 6] },
  { area: 'ne-depot', xs: [33, 36, 40, 44] },
] as const;
const BOT_SPAWN_Z = [-38, -44] as const;

export const DESERT_PLAYER_SPAWNS: ReadonlyArray<SpawnPoint> = PLAYER_SPAWN_X.map((x, i) => ({
  id: `player-${String(i + 1)}`,
  area: 'south-gate',
  pos: at(x, 40),
  yaw: 0, // facing north (-Z)
}));

export const DESERT_BOT_SPAWNS: ReadonlyArray<SpawnPoint> = BOT_AREAS.flatMap(({ area, xs }) =>
  BOT_SPAWN_Z.flatMap((z) => xs.map((x) => at(x, z))).map((pos, i) => ({
    id: `${area}-${String(i + 1)}`,
    area,
    pos,
    yaw: Math.PI, // facing south (+Z)
  })),
);

// ---- grids in the open yards ----
const YARD_X = [-40, -32.5, -26, -20, -14, -8, -4, 0, 4, 8, 14, 19.5, 25, 30, 36, 42] as const;
const YARD_Z = [34, 40, 45] as const;
const NORTH_X = [
  -44, -40, -36, -32.5, -28, -22, -16, -10, -6, -2, 2, 6, 10, 14.75, 20, 25, 29.75, 33, 36, 40, 44,
] as const;
const NORTH_Z = [-31, -38, -44] as const;

const yardId = (x: number, z: number) => `yard-${String(x)}-${String(z)}`;
const northId = (x: number, z: number) => `north-${String(x)}-${String(-z)}`;

const PLAYER_SPAWN_KEYS = new Set(
  DESERT_PLAYER_SPAWNS.map((s) => `${String(s.pos.x)},${String(s.pos.z)}`),
);
const BOT_SPAWN_KEYS = new Set(
  DESERT_BOT_SPAWNS.map((s) => `${String(s.pos.x)},${String(s.pos.z)}`),
);

function grid(
  xs: ReadonlyArray<number>,
  zs: ReadonlyArray<number>,
  name: (x: number, z: number) => string,
  spawnKeys: ReadonlySet<string>,
  spawnTag: NavNodeTag,
): NavNodeDef[] {
  return zs.flatMap((z) =>
    xs.map((x) => {
      const tags: NavNodeTag[] = spawnKeys.has(`${String(x)},${String(z)}`) ? [spawnTag] : [];
      return node(name(x, z), at(x, z), ...tags);
    }),
  );
}

// ---- route chains ----
const ALLEY = chain('alley', at(-32.5, 27), at(-32.5, -26), 5.5, 'corridor');

const CENTRE_ROUTE = [
  at(0, 27.9),
  at(-9.5, 27.9),
  at(-9.5, 21),
  at(-7.5, 14),
  at(-7.5, 7.5),
  at(-7.5, 0.5),
  at(-7.5, -6),
  at(-7.5, -13),
  at(-7.5, -20),
  at(-7.5, -26),
].map((p, i) => node(`centre-${String(i)}`, p));

/** Mirror lane through the east arch; not a route, so the centre route stays one lane. */
const CENTRE_EAST_LANE = [
  at(9.5, 27.9),
  at(9.5, 21),
  at(7.5, 14),
  at(7.5, 7.5),
  at(7.5, 0.5),
  at(7.5, -6),
  at(7.5, -13),
  at(7.5, -20),
  at(7.5, -26),
].map((p, i) => node(`centre-east-${String(i)}`, p));

const CENTRE_MIDDLE = [
  node('court-mid', at(0, 22.5)),
  node('arch-s', at(0, 6.5)),
  node('arch-n', at(0, 1.5)),
  node('well-s', at(0, -4)),
  node('well-n', at(0, -16)),
  node('well-far', at(0, -23)),
];

const ROOFTOP_ROUTE: ReadonlyArray<NavNodeDef> = [
  node('roof-0', at(19.5, 27)),
  node('roof-1', at(18.5, 23.5)),
  node('roof-2', at(18.5, 20)), // south ramp foot
  node('roof-3', vec3(18.5, 3, 14)), // south ramp middle
  node('roof-4', vec3(18.5, ROOF_Y, 8), 'elevated'), // south ramp top
  node('roof-5', vec3(18.5, ROOF_Y, 4), 'elevated'),
  node('roof-6', vec3(22.5, ROOF_Y, 0), 'elevated'),
  node('roof-7', vec3(25, ROOF_Y, -4), 'elevated'),
  node('roof-8', vec3(25, ROOF_Y, -8), 'elevated'), // north ramp top
  node('roof-9', vec3(25, 3, -14)), // north ramp middle
  node('roof-10', at(25, -20)), // north ramp foot
  node('roof-11', at(25, -24.5)),
];

const ROOF_EXTRA = [
  node('roof-east', vec3(25, ROOF_Y, 4), 'elevated'),
  node('roof-west', vec3(20, ROOF_Y, -4), 'elevated'),
];

const TOWER_WEST = chain('tower-w', at(14.75, 27), at(14.75, -26), 6);
const TOWER_EAST = chain('tower-e', at(29.75, 27), at(29.75, -26), 6);
const TOWER_MIDDLE = [
  node('tower-mid-s', at(23, 24)),
  node('tower-mid-m', at(23, 11)),
  node('tower-mid-n', at(20.5, -24)),
];

const MARKET = chain('market', at(36, 27), at(36, -26), 5.5);

// ---- cover points (BR-WM-21: at least 30) ----
type Side = 'n' | 's' | 'e' | 'w';
const COVER_PLAN: ReadonlyArray<readonly [Solid, ReadonlyArray<Side>]> = [
  [COVER_PROPS.courtCrateW, ['n', 's']],
  [COVER_PROPS.courtCrateE, ['n', 's']],
  [COVER_PROPS.courtBarrierW, ['n', 's']],
  [COVER_PROPS.courtBarrierE, ['n', 's']],
  [COVER_PROPS.well, ['n', 's', 'e', 'w']],
  [COVER_PROPS.wellCrateSw, ['n', 's']],
  [COVER_PROPS.wellCrateSe, ['n', 's']],
  [COVER_PROPS.wellCrateNw, ['n', 's']],
  [COVER_PROPS.wellCrateNe, ['n', 's']],
  [COVER_PROPS.towerCrateS, ['n', 's']],
  [COVER_PROPS.towerCrateN, ['n', 's']],
  [COVER_PROPS.stallS, ['n', 's']],
  [COVER_PROPS.stallM, ['n', 's']],
  [COVER_PROPS.stallN, ['n', 's']],
  [COVER_PROPS.cartS, ['n', 's']],
  [COVER_PROPS.cartM, ['n', 's']],
  [COVER_PROPS.cartN, ['n', 's']],
  [COVER_PROPS.yardCrateW, ['n', 's']],
  [COVER_PROPS.yardCrateE, ['n', 's']],
];

const COVER_GAP = 0.9;
/** Solids lower than this only hide a crouching bot. */
const CROUCH_ONLY_BELOW = 1.5;

function coverFor(target: Solid, side: Side): CoverPoint {
  const crouchOnly = target.half.y * 2 < CROUCH_ONLY_BELOW;
  return coverBeside(`cover-${target.id}-${side}`, target, side, { gap: COVER_GAP, crouchOnly });
}

const stackBase = COURT_STACK[0];
export const DESERT_COVER_POINTS: ReadonlyArray<CoverPoint> = [
  ...COVER_PLAN.flatMap(([solid, sides]) => sides.map((side) => coverFor(solid, side))),
  ...(stackBase
    ? (['n', 's'] as const).map((side) =>
        coverBeside(`cover-court-stack-${side}`, stackBase, side, {
          gap: COVER_GAP,
          crouchOnly: false,
        }),
      )
    : []),
];

const COVER_NODES = DESERT_COVER_POINTS.map((c) => node(c.id, c.pos, 'cover'));

// ---- patrol points (4 per lane region + 4 in the bot areas) ----
const PATROL_NODE_IDS: ReadonlyArray<string> = [
  'alley-1',
  'alley-5',
  'alley-9',
  'court-mid',
  'well-s',
  'well-far',
  'tower-w-2',
  'roof-6',
  'tower-e-7',
  'market-2',
  'market-5',
  'market-8',
  northId(-22, -31),
  northId(2, -31),
  northId(20, -31),
  northId(40, -31),
];
const PATROL_SET = new Set(PATROL_NODE_IDS);

function withPatrolTags(nodes: ReadonlyArray<NavNodeDef>): NavNodeDef[] {
  return nodes.map((n) => (PATROL_SET.has(n.id) ? { ...n, tags: [...n.tags, 'patrol'] } : n));
}

export const DESERT_NAV_NODES: ReadonlyArray<NavNodeDef> = withPatrolTags([
  ...grid(YARD_X, YARD_Z, yardId, PLAYER_SPAWN_KEYS, 'spawn-player'),
  ...grid(NORTH_X, NORTH_Z, northId, BOT_SPAWN_KEYS, 'spawn-bot'),
  ...ALLEY,
  ...CENTRE_ROUTE,
  ...CENTRE_EAST_LANE,
  ...CENTRE_MIDDLE,
  ...ROOFTOP_ROUTE,
  ...ROOF_EXTRA,
  ...TOWER_WEST,
  ...TOWER_EAST,
  ...TOWER_MIDDLE,
  ...MARKET,
  ...COVER_NODES,
]);

const nodeById = new Map(DESERT_NAV_NODES.map((n) => [n.id, n]));

export const DESERT_PATROL_POINTS: ReadonlyArray<PatrolPoint> = PATROL_NODE_IDS.flatMap((id) => {
  const n = nodeById.get(id);
  return n ? [{ id: `patrol-${id}`, pos: n.pos }] : [];
});

// ---- routes (BR-WM-22: interiors share no node) ----
const ids = (nodes: ReadonlyArray<NavNodeDef>) => nodes.map((n) => n.id);

export const DESERT_ROUTES: ReadonlyArray<RouteDef> = [
  {
    id: 'west-alley',
    name: 'West Alley',
    nodes: [yardId(-32.5, 34), ...ids(ALLEY), northId(-32.5, -31)],
  },
  {
    id: 'center-squares',
    name: 'Courtyard and Well Square',
    nodes: [yardId(0, 34), ...ids(CENTRE_ROUTE), northId(-6, -31)],
  },
  {
    id: 'rooftop',
    name: 'Watchtower Roof',
    nodes: [yardId(19.5, 34), ...ids(ROOFTOP_ROUTE), northId(25, -31)],
  },
  {
    id: 'east-market',
    name: 'East Market Street',
    nodes: [yardId(36, 34), ...ids(MARKET), northId(36, -31)],
  },
];

const RAMP_STEPS: ReadonlyArray<readonly [string, string]> = [
  ['roof-2', 'roof-3'],
  ['roof-3', 'roof-4'],
  ['roof-8', 'roof-9'],
  ['roof-9', 'roof-10'],
];
const RAMP_KEYS = new Set(RAMP_STEPS.map(([a, b]) => `${a}|${b}`));

/** Every route step is explicit; ramp steps are 'ramp' links. */
export const DESERT_NAV_LINKS: ReadonlyArray<NavLinkDef> = DESERT_ROUTES.flatMap((r) =>
  linkChain(r.nodes).map((l) =>
    RAMP_KEYS.has(`${l.a}|${l.b}`) ? { ...l, kind: 'ramp' as const } : l,
  ),
);
