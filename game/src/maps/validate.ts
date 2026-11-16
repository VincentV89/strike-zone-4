/**
 * Static map validation (BR-WM-10 to BR-WM-18, SD-WM-9 limits). No physics. Collects every
 * error instead of stopping at the first (BR-WM-03). Lookups use Map/Set so hostile ids such
 * as '__proto__' are ordinary keys (SEC-WM-01).
 */
import { degToRad, distance, isFiniteVec, length, type Vec3 } from '@sz/kernel';
import { solidTop } from './geometry';
import type { MapDefinition, MapValidationCode, MapValidationError, NavNodeTag } from './types';

export const MAP_LIMITS = {
  solids: 1500,
  navNodes: 600,
  navLinks: 2000,
  routes: 16,
  spawnsPerKind: 64,
} as const;

const MAX_HALF_EXTENT = 60;
const BOUNDS_MARGIN = 2;
const MAX_RAMP_PITCH = degToRad(30);
const KILL_Y_DEPTH = 5;
const TAGGED_POINT_TOLERANCE = 0.05;
const SPAWN_NODE_RADIUS = 3;
const MAX_AUTO_LINK_RADIUS = 12;

type Report = (code: MapValidationCode, path: string) => void;

function insideBounds(p: Vec3, map: MapDefinition, margin: number): boolean {
  const { min, max } = map.bounds;
  return (
    p.x >= min.x - margin &&
    p.x <= max.x + margin &&
    p.y >= min.y - margin &&
    p.y <= max.y + margin &&
    p.z >= min.z - margin &&
    p.z <= max.z + margin
  );
}

function checkUnique(ids: ReadonlyArray<{ readonly id: string }>, path: string, report: Report) {
  const seen = new Set<string>();
  ids.forEach((item, i) => {
    if (seen.has(item.id)) report('duplicate-id', `${path}[${String(i)}].id`);
    seen.add(item.id);
  });
}

function checkLimits(map: MapDefinition, report: Report): boolean {
  const over: Array<[number, number, string]> = [
    [map.solids.length, MAP_LIMITS.solids, 'solids'],
    [map.navNodes.length, MAP_LIMITS.navNodes, 'navNodes'],
    [map.navLinks.length, MAP_LIMITS.navLinks, 'navLinks'],
    [map.routes.length, MAP_LIMITS.routes, 'routes'],
    [map.playerSpawns.length, MAP_LIMITS.spawnsPerKind, 'playerSpawns'],
    [map.botSpawns.length, MAP_LIMITS.spawnsPerKind, 'botSpawns'],
  ];
  let ok = true;
  for (const [count, limit, path] of over) {
    if (count > limit) {
      report('too-many', path);
      ok = false;
    }
  }
  return ok;
}

function checkBounds(map: MapDefinition, report: Report): boolean {
  const { min, max, killY } = map.bounds;
  const finite = isFiniteVec(min) && isFiniteVec(max) && Number.isFinite(killY);
  if (!finite || min.x >= max.x || min.y >= max.y || min.z >= max.z) {
    report('bad-bounds', 'bounds');
    return false;
  }
  const grounds = map.solids.filter((s) => s.role === 'ground' && isFiniteVec(s.center));
  const lowestTop = grounds.reduce((lo, s) => Math.min(lo, solidTop(s)), Infinity);
  if (grounds.length === 0 || killY > lowestTop - KILL_Y_DEPTH) {
    report('bad-bounds', 'bounds.killY');
  }
  return true;
}

function checkSolids(map: MapDefinition, boundsOk: boolean, report: Report) {
  map.solids.forEach((s, i) => {
    const at = `solids[${String(i)}]`;
    const h = s.half;
    const finite =
      isFiniteVec(s.center) && isFiniteVec(h) && Number.isFinite(s.yaw) && Number.isFinite(s.pitch);
    if (!finite) {
      report('bad-solid', at);
      return;
    }
    for (const axis of ['x', 'y', 'z'] as const) {
      if (!(h[axis] > 0 && h[axis] <= MAX_HALF_EXTENT)) report('bad-solid', `${at}.half.${axis}`);
    }
    if (boundsOk && !insideBounds(s.center, map, BOUNDS_MARGIN)) {
      report('out-of-bounds', `${at}.center`);
    }
    if (s.material === 'invisible' && s.role !== 'boundary') {
      report('invisible-not-boundary', `${at}.material`);
    }
    if (s.role === 'ramp') {
      if (!(s.pitch !== 0 && Math.abs(s.pitch) <= MAX_RAMP_PITCH + 1e-9)) {
        report('bad-ramp', `${at}.pitch`);
      }
    } else if (s.pitch !== 0) {
      report('bad-solid', `${at}.pitch`);
    }
  });
}

function checkLights(map: MapDefinition, report: Report) {
  const { sun, hemisphere, fog } = map.lights;
  const dir = sun.direction;
  if (!isFiniteVec(dir) || Math.abs(length(dir) - 1) > 1e-3 || !(dir.y < -0.3)) {
    report('bad-light', 'lights.sun.direction');
  }
  const positive = (v: number) => Number.isFinite(v) && v > 0;
  if (!positive(sun.intensity)) report('bad-light', 'lights.sun.intensity');
  if (!positive(hemisphere.intensity)) report('bad-light', 'lights.hemisphere.intensity');
  if (!(positive(fog.near) && positive(fog.far) && fog.near < fog.far)) {
    report('bad-light', 'lights.fog');
  }
}

function areaCount(spawns: MapDefinition['playerSpawns']): number {
  return new Set(spawns.map((s) => s.area)).size;
}

function checkSpawns(map: MapDefinition, boundsOk: boolean, report: Report) {
  if (map.playerSpawns.length < 4 || areaCount(map.playerSpawns) < 1) {
    report('too-few-spawns', 'playerSpawns');
  }
  if (map.botSpawns.length < 24 || areaCount(map.botSpawns) < 2) {
    report('too-few-spawns', 'botSpawns');
  }
  const kinds = [
    ['playerSpawns', map.playerSpawns],
    ['botSpawns', map.botSpawns],
  ] as const;
  for (const [path, spawns] of kinds) {
    spawns.forEach((s, i) => {
      const valid = isFiniteVec(s.pos) && Number.isFinite(s.yaw);
      if (!valid || (boundsOk && !insideBounds(s.pos, map, 0))) {
        report('out-of-bounds', `${path}[${String(i)}].pos`);
      }
    });
  }
}

function hasTaggedNode(map: MapDefinition, p: Vec3, tag: NavNodeTag, radius: number): boolean {
  return map.navNodes.some((n) => n.tags.includes(tag) && distance(n.pos, p) <= radius);
}

function checkTaggedPoints(map: MapDefinition, report: Report) {
  map.patrolPoints.forEach((p, i) => {
    if (!hasTaggedNode(map, p.pos, 'patrol', TAGGED_POINT_TOLERANCE)) {
      report('missing-tagged-node', `patrolPoints[${String(i)}]`);
    }
  });
  map.coverPoints.forEach((c, i) => {
    if (!hasTaggedNode(map, c.pos, 'cover', TAGGED_POINT_TOLERANCE)) {
      report('missing-tagged-node', `coverPoints[${String(i)}]`);
    }
  });
  map.playerSpawns.forEach((s, i) => {
    if (!hasTaggedNode(map, s.pos, 'spawn-player', SPAWN_NODE_RADIUS)) {
      report('missing-tagged-node', `playerSpawns[${String(i)}]`);
    }
  });
  map.botSpawns.forEach((s, i) => {
    if (!hasTaggedNode(map, s.pos, 'spawn-bot', SPAWN_NODE_RADIUS)) {
      report('missing-tagged-node', `botSpawns[${String(i)}]`);
    }
  });
}

function checkNav(map: MapDefinition, boundsOk: boolean, report: Report) {
  const ids = new Set(map.navNodes.map((n) => n.id));
  map.navNodes.forEach((n, i) => {
    if (!isFiniteVec(n.pos) || (boundsOk && !insideBounds(n.pos, map, 0))) {
      report('out-of-bounds', `navNodes[${String(i)}].pos`);
    }
  });
  const r = map.navAutoLinkRadius;
  if (!(Number.isFinite(r) && r >= 0 && r <= MAX_AUTO_LINK_RADIUS)) {
    report('bad-bounds', 'navAutoLinkRadius');
  }
  map.navLinks.forEach((l, i) => {
    if (!ids.has(l.a)) report('unknown-node', `navLinks[${String(i)}].a`);
    if (!ids.has(l.b)) report('unknown-node', `navLinks[${String(i)}].b`);
  });
  if (map.routes.length < 3) report('too-few-routes', 'routes');
  map.routes.forEach((route, i) => {
    if (route.nodes.length < 3) report('too-few-routes', `routes[${String(i)}].nodes`);
    route.nodes.forEach((id, j) => {
      if (!ids.has(id)) report('unknown-node', `routes[${String(i)}].nodes[${String(j)}]`);
    });
  });
}

/** Every static error in one map. An empty list means the map passed. */
export function validateMap(map: MapDefinition): ReadonlyArray<MapValidationError> {
  const errors: MapValidationError[] = [];
  const report: Report = (code, path) => errors.push({ mapId: map.id, code, path });
  if (!checkLimits(map, report)) return errors; // SD-WM-9: oversized maps stop here.
  checkUnique(map.solids, 'solids', report);
  checkUnique(map.playerSpawns, 'playerSpawns', report);
  checkUnique(map.botSpawns, 'botSpawns', report);
  checkUnique(map.patrolPoints, 'patrolPoints', report);
  checkUnique(map.coverPoints, 'coverPoints', report);
  checkUnique(map.navNodes, 'navNodes', report);
  checkUnique(map.routes, 'routes', report);
  const boundsOk = checkBounds(map, report);
  checkSolids(map, boundsOk, report);
  checkLights(map, report);
  checkSpawns(map, boundsOk, report);
  checkNav(map, boundsOk, report);
  checkTaggedPoints(map, report);
  return errors;
}
