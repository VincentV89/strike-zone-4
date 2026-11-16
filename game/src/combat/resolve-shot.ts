import {
  isFiniteVec,
  lengthSq,
  normalize,
  type PhysicsQuery,
  type RayHit,
  type Vec3,
} from '@sz/kernel';
import { weaponStats, type ShotRequest, type WeaponStats } from '@sz/weapons';
import { shotMaskFor } from './guards';
import type { ActorLookup, CombatActor, ShotResolution } from './types';

function isObject(x: unknown): x is object {
  return typeof x === 'object' && x !== null;
}

function isVec(x: unknown): x is Vec3 {
  return isObject(x) && isFiniteVec(x as Vec3);
}

/** SEC-WC-04: never beyond the table range; a non-finite or non-positive request uses it. */
function cappedRange(requested: number, stats: WeaponStats): number {
  return Number.isFinite(requested) && requested > 0
    ? Math.min(requested, stats.rangeM)
    : stats.rangeM;
}

function isAlive(actor: CombatActor | undefined): actor is CombatActor {
  return actor !== undefined && actor.vitals.health > 0;
}

function classify(
  shot: ShotRequest,
  shooter: CombatActor,
  hit: RayHit,
  actors: ActorLookup,
  stats: WeaponStats,
): ShotResolution {
  const impact = { point: hit.point, normal: hit.normal, distance: hit.distance };
  if (hit.kind === 'world') return { kind: 'world', shot, ...impact };
  const target = actors.get(hit.actorId);
  // BR-C-05..07: same side (no friendly fire), dead or unknown → blocked, no damage.
  if (!isAlive(target) || target.side === shooter.side) {
    return { kind: 'blocked', shot, target: hit.actorId, ...impact };
  }
  const zone = hit.zone === 'head' ? 'head' : 'body';
  const rawDamage = stats.damage * (zone === 'head' ? stats.headMultiplier : 1); // BR-C-08
  return { kind: 'hit', shot, target: hit.actorId, zone, rawDamage, ...impact };
}

/**
 * Resolves one hitscan shot with exactly one nearest-hit raycast (BR-C-01..09).
 * The request is a claim: weapon, origin and direction are checked, the direction is
 * re-normalised, the range is capped at the table value, and the shooter must be known and
 * alive. Mask and damage come from the actor record and WEAPON_TABLE, never from the request.
 * Every rejection happens before the raycast, so it costs zero raycasts.
 */
export function resolveShot(
  shot: ShotRequest,
  query: PhysicsQuery,
  actors: ActorLookup,
): ShotResolution {
  const stats = weaponStats(shot.weapon);
  const dir = isVec(shot.dir) ? normalize(shot.dir) : null;
  if (stats === undefined || !isVec(shot.origin) || dir === null || lengthSq(dir) === 0) {
    return { kind: 'miss', shot, rejected: true };
  }
  const shooter = actors.get(shot.shooter);
  if (!isAlive(shooter)) return { kind: 'miss', shot }; // erratum: a dead shooter deals nothing
  const clean: ShotRequest = { ...shot, dir, rangeM: cappedRange(shot.rangeM, stats) };
  const hit = query.raycast(
    clean.origin,
    dir,
    clean.rangeM,
    shotMaskFor(shooter.side),
    shot.shooter,
  );
  if (hit === null) return { kind: 'miss', shot: clean };
  return classify(clean, shooter, hit, actors, stats);
}
