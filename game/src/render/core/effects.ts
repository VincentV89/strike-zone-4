/**
 * Drained events → effects (business-logic-model "Events to effects", BR-R-10 to BR-R-12,
 * BR-R-15, LC-R-7). One switch over the known event union; unknown types fall through to
 * `default` and are ignored (BR-R-19). No allocation per event (PD-R-5, PD-R-12).
 */
import { PLAYER_ID, type DomainEvent } from '@sz/kernel';
import type { SnapshotPlayer } from '@sz/sim';
import { slotOf } from './actors';
import { asWeaponId, finiteVec, listOr, weaponRow } from './guards';
import { acquire, type EffectSlot } from './pool';
import { startDeath, startFlinch } from './reactions';
import type { PresentationState } from './state';
import { vmFire, vmReload, vmSwitch } from './viewmodel';

export const MUZZLE_SEC = 0.05;
export const PUFF_SEC = 0.4;
export const SPARK_SEC = 0.25;
export const SPARKS_PER_HIT = 6;
/** Decals live until stolen by a newer decal. */
export const DECAL_SEC = Number.POSITIVE_INFINITY;
export const DECAL_OFFSET_M = 0.01;
export const DECAL_SIZE_M = 0.12;
export const WORLD_MUZZLE_BASE_M = 0.35;
/** Muzzle point ahead of the eye along the shot direction. */
export const MUZZLE_AHEAD_M = 0.6;

function place(
  e: EffectSlot,
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  size: number,
): void {
  e.x = x;
  e.y = y;
  e.z = z;
  e.nx = nx;
  e.ny = ny;
  e.nz = nz;
  e.size = size;
}

/** Module scratch, so event mapping allocates nothing (PD-R-5). */
const U = { x: 0, y: 0, z: 0 };
const P = { x: 0, z: 0 };

/** Normalises into U; false for a zero or non-finite vector. */
function unit(x: number, y: number, z: number): boolean {
  const len = Math.sqrt(x * x + y * y + z * z);
  if (!Number.isFinite(len) || len <= 1e-9) return false;
  U.x = x / len;
  U.y = y / len;
  U.z = z / len;
  return true;
}

function addSparks(s: PresentationState, px: number, py: number, pz: number): void {
  // Tangent basis around the normal in U; sparks spread evenly in a cone (deterministic).
  const nx = U.x;
  const ny = U.y;
  const nz = U.z;
  const ax = Math.abs(ny) < 0.9 ? 0 : 1;
  const ay = Math.abs(ny) < 0.9 ? 1 : 0;
  // t1 = a × n, t2 = n × t1
  let t1x = ay * nz;
  let t1y = -ax * nz;
  let t1z = ax * ny - ay * nx;
  const l1 = Math.sqrt(t1x * t1x + t1y * t1y + t1z * t1z) || 1;
  t1x /= l1;
  t1y /= l1;
  t1z /= l1;
  const t2x = ny * t1z - nz * t1y;
  const t2y = nz * t1x - nx * t1z;
  const t2z = nx * t1y - ny * t1x;
  for (let i = 0; i < SPARKS_PER_HIT; i++) {
    const a = (i / SPARKS_PER_HIT) * Math.PI * 2 + s.acquisitions * 0.7;
    const c = Math.cos(a) * 0.6;
    const sn = Math.sin(a) * 0.6;
    const dx = nx + c * t1x + sn * t2x;
    const dy = ny + c * t1y + sn * t2y;
    const dz = nz + c * t1z + sn * t2z;
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const e = acquire(s.effects.spark, s.t, SPARK_SEC);
    s.acquisitions += 1;
    place(e, px, py, pz, dx / l, dy / l, dz / l, 0.05);
  }
}

/** Position of an actor's feet: the player from the snapshot, a bot from its drawn slot. */
function actorXZ(s: PresentationState, player: SnapshotPlayer, id: unknown): boolean {
  if (id === PLAYER_ID) {
    if (!finiteVec(player.pos)) return false;
    P.x = player.pos.x;
    P.z = player.pos.z;
    return true;
  }
  const slot = slotOf(s.actors, id);
  if (slot === undefined) return false;
  P.x = slot.x;
  P.z = slot.z;
  return true;
}

/** Applies every event of this frame in order. Hostile entries are skipped, never thrown on. */
export function applyEvents(
  s: PresentationState,
  events: ReadonlyArray<DomainEvent>,
  player: SnapshotPlayer,
): void {
  for (const e of listOr(events)) {
    const v: unknown = e;
    if (typeof v !== 'object' || v === null) continue;
    applyEvent(s, e, player);
  }
}

function applyEvent(s: PresentationState, e: DomainEvent, player: SnapshotPlayer): void {
  switch (e.type) {
    case 'ShotFired': {
      if (e.shooter === PLAYER_ID) {
        const row = weaponRow(e.weapon);
        vmFire(s.viewmodel, s.t, row?.kickPitch ?? 0);
        return;
      }
      if (!finiteVec(e.origin) || !finiteVec(e.dir)) return;
      if (!unit(e.dir.x, e.dir.y, e.dir.z)) return;
      const x = e.origin.x + U.x * MUZZLE_AHEAD_M;
      const y = e.origin.y + U.y * MUZZLE_AHEAD_M;
      const z = e.origin.z + U.z * MUZZLE_AHEAD_M;
      const cam = s.camera;
      const dist = Math.sqrt((x - cam.x) ** 2 + (y - cam.y) ** 2 + (z - cam.z) ** 2);
      if (!(dist <= s.preset.drawDistanceM)) return;
      const m = acquire(s.effects.muzzle, s.t, MUZZLE_SEC);
      s.acquisitions += 1;
      place(m, x, y, z, U.x, U.y, U.z, WORLD_MUZZLE_BASE_M);
      return;
    }
    case 'ShotImpact': {
      if (!finiteVec(e.point) || !finiteVec(e.normal)) return;
      if (!unit(e.normal.x, e.normal.y, e.normal.z)) return;
      const p = e.point;
      const nx = U.x;
      const ny = U.y;
      const nz = U.z;
      if (e.surface === 'world') {
        const puff = acquire(s.effects.puff, s.t, PUFF_SEC);
        place(puff, p.x + nx * 0.05, p.y + ny * 0.05, p.z + nz * 0.05, nx, ny, nz, 0.15);
        const decal = acquire(s.effects.decal, s.t, DECAL_SEC);
        s.acquisitions += 2;
        place(
          decal,
          p.x + nx * DECAL_OFFSET_M,
          p.y + ny * DECAL_OFFSET_M,
          p.z + nz * DECAL_OFFSET_M,
          nx,
          ny,
          nz,
          DECAL_SIZE_M,
        );
      } else if (e.target !== undefined && slotOf(s.actors, e.target) !== undefined) {
        addSparks(s, p.x, p.y, p.z);
      }
      return;
    }
    case 'HitConfirmed': {
      const slot = slotOf(s.actors, e.target);
      if (slot === undefined) return;
      if (actorXZ(s, player, e.shooter)) startFlinch(slot, s.t, slot.x - P.x, slot.z - P.z);
      else startFlinch(slot, s.t, Math.sin(slot.yaw), Math.cos(slot.yaw));
      return;
    }
    case 'ActorKilled': {
      const slot = slotOf(s.actors, e.victim);
      if (slot === undefined) return;
      if (actorXZ(s, player, e.killer)) startDeath(slot, s.t, slot.x - P.x, slot.z - P.z);
      else startDeath(slot, s.t, Math.sin(slot.yaw), Math.cos(slot.yaw));
      return;
    }
    case 'ReloadStarted':
      if (e.actor === PLAYER_ID) vmReload(s.viewmodel, s.t, e.durationSec);
      return;
    case 'WeaponSwitched': {
      if (e.actor !== PLAYER_ID) return;
      const to = asWeaponId(e.to);
      const row = weaponRow(to);
      if (to === undefined || row === undefined) return;
      vmSwitch(s.viewmodel, to, s.t, row.drawSec);
      return;
    }
    default:
      // DamageTaken belongs to ui-hud; every other type is ignored.
      return;
  }
}
