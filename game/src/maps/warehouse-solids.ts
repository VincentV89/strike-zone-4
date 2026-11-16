/**
 * Industrial Warehouse geometry (business-logic-model-warehouse-map, "Layout"). Plan view,
 * north at -Z: player bay in the south (z > 28), bot bays in the north (z < -28), and the
 * main hall between two 6 m cross walls. The hall is open-topped (ADR-WH-1): a 12 m boundary
 * ring and no roof solids except the gantry deck, which is the elevated walkway surface.
 * Coordinates are authoring targets; the shipped-map and warehouse tests are the acceptance
 * criteria.
 */
import { vec3, type Vec3 } from '@sz/kernel';
import { box, boundaryRing, crate, ramp } from './build';
import type { MapBounds, MaterialId, Solid, SolidRole } from './types';

export const WAREHOUSE_BOUNDS: MapBounds = {
  min: vec3(-40, -1, -40),
  max: vec3(40, 16, 40),
  killY: -10,
};

/** Axis-aligned solid from x0..x1, z0..z1, standing on `y0` with height h. */
function block(
  id: string,
  role: SolidRole,
  xz: readonly [number, number, number, number],
  h: number,
  material: MaterialId,
  y0 = 0,
): Solid {
  const [x0, x1, z0, z1] = xz;
  return box(id, role, vec3(x0, y0, z0), vec3(x1, y0 + h, z1), material);
}

const at = (x: number, z: number): Vec3 => vec3(x, 0, z);

export const CROSS_WALL_HEIGHT = 6;
/** Gate centres in both cross walls: west corridor, centre, east gantry (BR-WH-12). */
export const GATE_X = [-28, 0, 28.6] as const;
export const DECK_TOP = 4;
const DECK_THICKNESS = 0.3;
const DECK_X: readonly [number, number] = [26.5, 30.5];
const DECK_Z: readonly [number, number] = [-14, 14];
const CONTAINER_H = 2.6;
const ROW_W_X: readonly [number, number] = [-32, -29.5];
const ROW_E_X: readonly [number, number] = [-26.5, -24];
/** Container segments north to south; the 3 m gap at z −1.5..1.5 is the cross-alley. */
const CONTAINER_Z: ReadonlyArray<readonly [number, number]> = [
  [-19.5, -7.5],
  [-7.5, -1.5],
  [1.5, 7.5],
  [7.5, 19.5],
];

// ---- cover props: each one gets cover points in warehouse-nav.ts ----
const containerE = (i: number): Solid => {
  const [z0, z1] = CONTAINER_Z[i] ?? [0, 0];
  return block(
    `container-e-${String(i)}`,
    'prop',
    [ROW_E_X[0], ROW_E_X[1], z0, z1],
    CONTAINER_H,
    'container-paint',
  );
};

const PARAPET_Z: ReadonlyArray<readonly [number, number]> = [
  [-14, -7],
  [-7, 0],
  [0, 7],
  [7, 14],
];
const parapet = (i: number): Solid => {
  const [z0, z1] = PARAPET_Z[i] ?? [0, 0];
  return block(`gantry-parapet-${String(i)}`, 'wall', [26.5, 26.7, z0, z1], 1.1, 'metal', DECK_TOP);
};

export const COVER_PROPS = {
  floorCrate0: crate('floor-crate-0', at(-4.5, 17), 1.2),
  floorCrate1: crate('floor-crate-1', at(4.5, 17), 1.2),
  floorCrate2: crate('floor-crate-2', at(-4.5, -17), 1.2),
  floorCrate3: crate('floor-crate-3', at(4.5, -17), 1.2),
  floorCrate4: crate('floor-crate-4', at(-12, 8), 1.2),
  floorCrate5: crate('floor-crate-5', at(12, 8), 1.2),
  floorCrate6: crate('floor-crate-6', at(-12, -8), 1.2),
  floorCrate7: crate('floor-crate-7', at(12, -8), 1.2),
  barrierSw: block('barrier-sw', 'prop', [-6, -2, 9.3, 9.7], 1.1, 'concrete'),
  barrierSe: block('barrier-se', 'prop', [2, 6, 9.3, 9.7], 1.1, 'concrete'),
  barrierNw: block('barrier-nw', 'prop', [-6, -2, -9.7, -9.3], 1.1, 'concrete'),
  barrierNe: block('barrier-ne', 'prop', [2, 6, -9.7, -9.3], 1.1, 'concrete'),
  press: block('press', 'prop', [-3, 3, -3, 3], 2.2, 'metal'),
  parapet0: parapet(0),
  parapet1: parapet(1),
  parapet2: parapet(2),
  parapet3: parapet(3),
  containerE1: containerE(1),
  containerE2: containerE(2),
} as const;

/** One cross wall at z = zc with the three gates (BR-WH-12). */
function crossWall(prefix: string, zc: number): ReadonlyArray<Solid> {
  const spans: ReadonlyArray<readonly [number, number]> = [
    [-40, -29.5],
    [-26.5, -2],
    [2, 26.5],
    [30.5, 40],
  ];
  return spans.map(([x0, x1], i) =>
    block(
      `${prefix}-wall-${String(i)}`,
      'wall',
      [x0, x1, zc - 0.5, zc + 0.5],
      CROSS_WALL_HEIGHT,
      'metal',
    ),
  );
}

function containers(): ReadonlyArray<Solid> {
  const rowW = CONTAINER_Z.map(([z0, z1], i) =>
    block(
      `container-w-${String(i)}`,
      'prop',
      [ROW_W_X[0], ROW_W_X[1], z0, z1],
      CONTAINER_H,
      'container-paint',
    ),
  );
  // Second container on top of each 12 m row-E segment (5.2 m total height).
  const tops = [0, 3].map((seg, i) => {
    const [z0, z1] = CONTAINER_Z[seg] ?? [0, 0];
    return block(
      `container-e-top-${String(i)}`,
      'prop',
      [ROW_E_X[0], ROW_E_X[1], z0, z1],
      CONTAINER_H,
      'container-paint',
      CONTAINER_H,
    );
  });
  return [
    ...rowW,
    containerE(0),
    COVER_PROPS.containerE1,
    COVER_PROPS.containerE2,
    containerE(3),
    ...tops,
  ];
}

function hall(): ReadonlyArray<Solid> {
  return [
    block('storage-w', 'wall', [-40, -32, -27.5, 27.5], 5, 'metal'),
    block('storage-e', 'wall', [30.5, 40, -27.5, 27.5], 6, 'metal'),
    block('screen-s', 'wall', [-5.5, 5.5, 23.7, 24.3], 4, 'concrete'),
    block('screen-n', 'wall', [-5.5, 5.5, -24.3, -23.7], 4, 'concrete'),
    block('rack-sw', 'prop', [-15.6, -14.4, 4, 16], 4, 'metal'),
    block('rack-nw', 'prop', [-15.6, -14.4, -16, -4], 4, 'metal'),
    block('rack-se', 'prop', [14.4, 15.6, 4, 16], 4, 'metal'),
    block('rack-ne', 'prop', [14.4, 15.6, -16, -4], 4, 'metal'),
  ];
}

function gantry(): ReadonlyArray<Solid> {
  const postZ = [-13.5, -7, 0, 7, 13.5];
  return [
    block(
      'gantry-deck',
      'roof',
      [DECK_X[0], DECK_X[1], DECK_Z[0], DECK_Z[1]],
      DECK_THICKNESS,
      'metal',
      DECK_TOP - DECK_THICKNESS,
    ),
    ...postZ.map((z, i) =>
      block(
        `gantry-post-${String(i)}`,
        'prop',
        [26.6, 27.0, z - 0.2, z + 0.2],
        DECK_TOP - DECK_THICKNESS,
        'metal',
      ),
    ),
    ramp('gantry-ramp-s', vec3(28.6, 0, 24), vec3(28.6, DECK_TOP, DECK_Z[1]), 3.6, 'concrete'),
    ramp('gantry-ramp-n', vec3(28.6, 0, -24), vec3(28.6, DECK_TOP, DECK_Z[0]), 3.6, 'concrete'),
  ];
}

export const WAREHOUSE_SOLIDS: ReadonlyArray<Solid> = [
  box('ground', 'ground', vec3(-42, -1, -42), vec3(42, 0, 42), 'concrete'),
  ...boundaryRing(WAREHOUSE_BOUNDS, 12, 'concrete'),
  ...crossWall('south', 28),
  ...crossWall('north', -28),
  ...hall(),
  ...containers(),
  ...gantry(),
  COVER_PROPS.floorCrate0,
  COVER_PROPS.floorCrate1,
  COVER_PROPS.floorCrate2,
  COVER_PROPS.floorCrate3,
  COVER_PROPS.floorCrate4,
  COVER_PROPS.floorCrate5,
  COVER_PROPS.floorCrate6,
  COVER_PROPS.floorCrate7,
  COVER_PROPS.barrierSw,
  COVER_PROPS.barrierSe,
  COVER_PROPS.barrierNw,
  COVER_PROPS.barrierNe,
  COVER_PROPS.press,
  COVER_PROPS.parapet0,
  COVER_PROPS.parapet1,
  COVER_PROPS.parapet2,
  COVER_PROPS.parapet3,
];
