/**
 * Desert Compound geometry (business-logic-model-world-maps, "Desert Compound layout").
 * Plan view, north at -Z: player yard in the south (z > 30), bot areas in the north
 * (z < -28), and four lanes between them: west alley, centre squares, watchtower yard with a
 * 6 m roof reached by two ramps, and east market street. Coordinates are authoring targets;
 * the shipped-map tests are the acceptance criteria.
 */
import { vec3, type Vec3 } from '@sz/kernel';
import { box, boundaryRing, crate, crateStack, ramp } from './build';
import type { MapBounds, MaterialId, Solid, SolidRole } from './types';

export const DESERT_BOUNDS: MapBounds = {
  min: vec3(-48, -1, -48),
  max: vec3(48, 20, 48),
  killY: -10,
};

/** Axis-aligned solid standing on y = 0 (or on `y0`) from x0..x1, z0..z1, height h. */
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

// ---- cover props: each one gets cover points in desert-nav.ts ----
export const COVER_PROPS = {
  courtCrateW: crate('court-crate-w', at(-3.5, 19), 1.2),
  courtCrateE: crate('court-crate-e', at(3.5, 19), 1.2),
  courtBarrierW: block('court-barrier-w', 'prop', [-6, -2, 9.3, 9.7], 1.1, 'concrete'),
  courtBarrierE: block('court-barrier-e', 'prop', [2, 6, 9.3, 9.7], 1.1, 'concrete'),
  well: block('well', 'prop', [-1.5, 1.5, -11.5, -8.5], 1.2, 'concrete'),
  wellCrateSw: crate('well-crate-sw', at(-4.5, -3), 1.2),
  wellCrateSe: crate('well-crate-se', at(4.5, -3), 1.2),
  wellCrateNw: crate('well-crate-nw', at(-4.5, -19), 1.2),
  wellCrateNe: crate('well-crate-ne', at(4.5, -19), 1.2),
  towerCrateS: crate('tower-crate-s', at(24.5, 15), 1.2),
  towerCrateN: crate('tower-crate-n', at(20.5, -14), 1.2),
  stallS: block('market-stall-s', 'prop', [32.5, 34.5, 19, 21], 1.4, 'crate-wood'),
  stallM: block('market-stall-m', 'prop', [32.5, 34.5, 4, 6], 1.4, 'crate-wood'),
  stallN: block('market-stall-n', 'prop', [32.5, 34.5, -11, -9], 1.4, 'crate-wood'),
  cartS: block('market-cart-s', 'prop', [38, 40, 11, 13], 1.3, 'metal'),
  cartM: block('market-cart-m', 'prop', [38, 40, -4, -2], 1.3, 'metal'),
  cartN: block('market-cart-n', 'prop', [38, 40, -19, -17], 1.3, 'metal'),
  yardCrateW: crate('yard-crate-w', at(-6, -34.5), 1.2),
  yardCrateE: crate('yard-crate-e', at(6, -34.5), 1.2),
} as const;

/** The centre crate stack (two crates) also provides cover. */
export const COURT_STACK = crateStack('court-stack', at(0, 14), [1.4, 1.0]);

const INNER_WALL_H = 5;

function innerWall(): ReadonlyArray<Solid> {
  // z = 30 wall with four gates: west alley, centre, watchtower, market.
  const spans: ReadonlyArray<readonly [number, number]> = [
    [-48, -34],
    [-31, -2],
    [2, 17.5],
    [21.5, 34],
    [38, 48],
  ];
  return spans.map(([x0, x1], i) =>
    block(`inner-wall-${String(i)}`, 'wall', [x0, x1, 29.5, 30.5], INNER_WALL_H, 'plaster'),
  );
}

function westSide(): ReadonlyArray<Solid> {
  return [
    block('west-block', 'wall', [-48, -34, -28, 29.5], 6, 'plaster'),
    block('west-house-n', 'wall', [-31, -12, -28, -6], 5, 'packed-earth'),
    block('west-house-m', 'wall', [-31, -12, -6, 10], 5.5, 'plaster'),
    block('west-house-s', 'wall', [-31, -12, 10, 29.5], 5, 'packed-earth'),
  ];
}

function centre(): ReadonlyArray<Solid> {
  const archSpans: ReadonlyArray<readonly [number, number]> = [
    [-12, -9],
    [-6, -1.5],
    [1.5, 6],
    [9, 12],
  ];
  const lintels: ReadonlyArray<readonly [number, number]> = [
    [-9, -6],
    [-1.5, 1.5],
    [6, 9],
  ];
  return [
    block('screen-wall', 'wall', [-7, 7, 25.7, 26.3], 4, 'concrete'),
    ...archSpans.map(([x0, x1], i) =>
      block(`arches-${String(i)}`, 'wall', [x0, x1, 3.5, 4.5], 4.5, 'plaster'),
    ),
    ...lintels.map(([x0, x1], i) =>
      block(`arch-lintel-${String(i)}`, 'wall', [x0, x1, 3.5, 4.5], 1.5, 'plaster', 3),
    ),
    block('centre-divider', 'wall', [12, 12.5, -28, 29.5], 5, 'plaster'),
  ];
}

function watchtower(): ReadonlyArray<Solid> {
  return [
    block('tower-house', 'wall', [17, 28, -8, 8], 5.7, 'plaster'),
    block('tower-roof', 'roof', [17, 28, -8, 8], 0.3, 'concrete', 5.7),
    block('parapet-w', 'wall', [17, 17.4, -8, 8], 1, 'plaster', 6),
    block('parapet-e', 'wall', [27.6, 28, -8, 8], 1, 'plaster', 6),
    block('parapet-s', 'wall', [20, 27.6, 7.6, 8], 1, 'plaster', 6),
    block('parapet-nw', 'wall', [17.4, 23.5, -8, -7.6], 1, 'plaster', 6),
    block('parapet-ne', 'wall', [26.5, 27.6, -8, -7.6], 1, 'plaster', 6),
    ramp('ramp-s', vec3(18.5, 0, 20), vec3(18.5, 6, 8), 2.5, 'concrete'),
    ramp('ramp-n', vec3(25, 0, -20), vec3(25, 6, -8), 2.5, 'concrete'),
  ];
}

function eastSide(): ReadonlyArray<Solid> {
  return [
    block('market-wall', 'wall', [31.5, 32.5, -28, 29.5], 5, 'plaster'),
    block('east-block', 'wall', [40, 48, -28, 29.5], 6, 'plaster'),
  ];
}

function northBand(): ReadonlyArray<Solid> {
  return [
    block('ruin-wall-a', 'wall', [-47, -41, -34.2, -33.8], 2.2, 'packed-earth'),
    block('ruin-wall-b', 'wall', [-30.2, -29.8, -47, -41], 2.2, 'packed-earth'),
    block('depot-container', 'prop', [41.5, 47.5, -35.5, -33.5], 2.6, 'container-paint'),
  ];
}

export const DESERT_SOLIDS: ReadonlyArray<Solid> = [
  box('ground', 'ground', vec3(-50, -1, -50), vec3(50, 0, 50), 'sand'),
  ...boundaryRing(DESERT_BOUNDS, 6, 'plaster'),
  ...innerWall(),
  ...westSide(),
  ...centre(),
  ...watchtower(),
  ...eastSide(),
  ...northBand(),
  ...Object.values(COVER_PROPS),
  ...COURT_STACK,
];
