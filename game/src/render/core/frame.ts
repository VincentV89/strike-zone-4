/**
 * Per-frame presentation step (business-logic-model "Per-frame sequence", PD-R-6, LC-R-8).
 * Pure: reads the frozen RenderFrame and writes only into the presentation state and its
 * preallocated instance buffers. gl then uploads dirty buffers and draws.
 */
import { STEP_SEC, type WeaponId } from '@sz/kernel';
import type { SnapshotPlayer } from '@sz/sim';
import { clearActors, syncActors, updateActors } from './actors';
import { beginPack, endPack, writeColor, type InstanceBuffer } from './buffers';
import { updateCamera } from './camera';
import { applyEvents } from './effects';
import { flashWorldSize } from './flash';
import { asWeaponId, clampAlpha, clampDt, clampFov, finiteVec, weaponRow } from './guards';
import { fromRotationX, fromRotationY, mat4, multiply, scaleBy, writeMat } from './pack';
import { advance, clearPool, type EffectPool } from './pool';
import { presetRow } from './presets';
import { poseBot } from './rig';
import { applyCaps, EFFECT_KINDS, type PresentationState } from './state';
import type { RenderFrame, RenderSettings } from './types';
import { resetViewmodel, vmPose, vmStep, type ViewmodelPose } from './viewmodel';

export interface FrameOutput {
  /** False before the first snapshot of a round: gl clears and draws nothing. */
  draw: boolean;
  /** True when the frame was paused and nothing was recomputed (BR-R-14). */
  frozen: boolean;
  viewmodel: ViewmodelPose;
}

const out: FrameOutput = {
  draw: false,
  frozen: false,
  viewmodel: { visible: false, weapon: 'rifle', x: 0, y: 0, z: 0, pitch: 0, roll: 0, flash: false },
};

/** Applies settings live (BR-R-08): unknown preset or non-finite FOV keep the previous value. */
export function applyRenderSettings(
  s: PresentationState,
  next: Partial<RenderSettings>,
): RenderSettings {
  const row = presetRow(next.preset) ?? s.preset;
  const settings: RenderSettings = Object.freeze({
    preset: row.id,
    fovDeg: clampFov(next.fovDeg, s.settings.fovDeg),
    reducedMotion:
      typeof next.reducedMotion === 'boolean' ? next.reducedMotion : s.settings.reducedMotion,
  });
  s.settings = settings;
  s.preset = row;
  applyCaps(s);
  return settings;
}

/** Round start, Restart, Play Again (FD-R-5, BR-R-18): clears pools, slots, reactions and clock. */
export function beginRound(s: PresentationState, weapon: WeaponId = 'rifle'): void {
  s.t = 0;
  s.frames = 0;
  s.playerDeathStart = -1;
  clearActors(s.actors);
  for (const k of EFFECT_KINDS) {
    clearPool(s.effects[k]);
    const b = s.effectBuffers[k];
    b.count = 0;
    b.dirty = true;
  }
  for (const b of s.botNear) {
    b.count = 0;
    b.dirty = true;
  }
  for (const b of s.botFar) {
    b.count = 0;
    b.dirty = true;
  }
  resetViewmodel(s.viewmodel, weapon);
}

const m = mat4();
const r = mat4();

/** Camera-facing quad: T(p) · Ry(camYaw) · Rx(camPitch) · S(size). */
function writeBillboard(
  b: InstanceBuffer,
  i: number,
  x: number,
  y: number,
  z: number,
  size: number,
  yaw: number,
  pitch: number,
): void {
  fromRotationY(m, yaw);
  fromRotationX(r, pitch);
  multiply(m, m, r);
  scaleBy(m, m, size, size, size);
  m[12] = x;
  m[13] = y;
  m[14] = z;
  writeMat(b.matrices, i, m);
}

/** Decal quad lying on the surface: local +Z = normal. */
function writeDecal(
  b: InstanceBuffer,
  i: number,
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  size: number,
): void {
  // tangent = normalize(up × n), or +X when n is vertical
  let tx = nz;
  let tz = -nx;
  let ty = 0;
  const tl = Math.sqrt(tx * tx + tz * tz);
  if (tl < 1e-6) {
    tx = 1;
    ty = 0;
    tz = 0;
  } else {
    tx /= tl;
    tz /= tl;
  }
  // bitangent = n × t
  const bx = ny * tz - nz * ty;
  const by = nz * tx - nx * tz;
  const bz = nx * ty - ny * tx;
  const o = i * 16;
  const mm = b.matrices;
  mm[o] = tx * size;
  mm[o + 1] = ty * size;
  mm[o + 2] = tz * size;
  mm[o + 3] = 0;
  mm[o + 4] = bx * size;
  mm[o + 5] = by * size;
  mm[o + 6] = bz * size;
  mm[o + 7] = 0;
  mm[o + 8] = nx;
  mm[o + 9] = ny;
  mm[o + 10] = nz;
  mm[o + 11] = 0;
  mm[o + 12] = x;
  mm[o + 13] = y;
  mm[o + 14] = z;
  mm[o + 15] = 1;
}

const SPARK_SPEED = 4;

function packPool(
  s: PresentationState,
  kind: (typeof EFFECT_KINDS)[number],
  pool: EffectPool,
  b: InstanceBuffer,
  aspect: number,
): void {
  beginPack(b);
  const cam = s.camera;
  const vFov = (cam.vFovDeg * Math.PI) / 180;
  for (const e of pool.slots) {
    if (!e.live || b.count >= b.capacity) continue;
    const age = s.t - e.start;
    const k = Number.isFinite(e.dur) && e.dur > 0 ? Math.min(1, age / e.dur) : 0;
    const i = b.count;
    switch (kind) {
      case 'decal':
        writeDecal(b, i, e.x, e.y, e.z, e.nx, e.ny, e.nz, e.size);
        writeColor(b, i, 1, 1, 1);
        break;
      case 'puff': {
        writeBillboard(b, i, e.x, e.y + 0.2 * k, e.z, e.size + 0.35 * k, cam.yaw, cam.pitch);
        const f = 0.55 * (1 - k);
        writeColor(b, i, f, f * 0.96, f * 0.9);
        break;
      }
      case 'spark': {
        const d = SPARK_SPEED * age;
        writeBillboard(
          b,
          i,
          e.x + e.nx * d,
          e.y + e.ny * d - 2 * age * age,
          e.z + e.nz * d,
          e.size * (1 - 0.6 * k),
          cam.yaw,
          cam.pitch,
        );
        writeColor(b, i, 1 - 0.3 * k, 0.7 * (1 - k), 0.3 * (1 - k));
        break;
      }
      case 'muzzle': {
        const dist = Math.sqrt((e.x - cam.x) ** 2 + (e.y - cam.y) ** 2 + (e.z - cam.z) ** 2);
        writeBillboard(
          b,
          i,
          e.x,
          e.y,
          e.z,
          flashWorldSize(e.size, dist, vFov, aspect),
          cam.yaw,
          cam.pitch,
        );
        writeColor(b, i, 1, 0.82, 0.5);
        break;
      }
    }
    b.count += 1;
  }
  endPack(b);
}

function playerSpeed(p: SnapshotPlayer): number {
  if (!finiteVec(p.pos) || !finiteVec(p.prevPos)) return 0;
  const dx = p.pos.x - p.prevPos.x;
  const dz = p.pos.z - p.prevPos.z;
  return Math.sqrt(dx * dx + dz * dz) / STEP_SEC;
}

/**
 * One presentation frame. Paused frames advance nothing and return before packing, so the
 * scene is redrawn frozen behind the Pause dialog (PD-R-6, RD-R-7).
 */
export function stepPresentation(
  s: PresentationState,
  frame: RenderFrame,
  aspect: number,
): FrameOutput {
  const curr = frame.curr;
  out.viewmodel = s.vmPose;
  if (curr === undefined || typeof curr !== 'object') {
    out.draw = false;
    out.frozen = false;
    return out;
  }
  out.draw = true;
  if (frame.paused) {
    out.frozen = true;
    return out;
  }
  out.frozen = false;
  const dt = clampDt(frame.dtSec);
  s.t += dt;
  s.frames += 1;
  const alpha = clampAlpha(frame.alpha);
  const player = curr.player;
  syncActors(s.actors, curr);

  // Camera first: muzzle-flash size and culling depend on it.
  const weapon = weaponRow(player.weapon.equipped);
  const scoped = player.weapon.scoped && weapon?.scopedFovDeg != null;
  if (!player.alive) {
    if (s.playerDeathStart < 0) s.playerDeathStart = s.t;
  } else {
    s.playerDeathStart = -1;
  }
  const prevPlayer = frame.prev?.player;
  updateCamera(s.camera, player, prevPlayer, alpha, {
    fovDeg: s.settings.fovDeg,
    aspect,
    drawDistanceM: s.preset.drawDistanceM,
    scopedFovDeg: scoped ? weapon.scopedFovDeg : null,
    deathT: s.playerDeathStart < 0 ? -1 : s.t - s.playerDeathStart,
    reducedMotion: s.settings.reducedMotion,
  });

  applyEvents(s, frame.events, player);

  updateActors(s.actors, curr, {
    alpha,
    dt,
    t: s.t,
    camX: s.camera.x,
    camY: s.camera.y,
    camZ: s.camera.z,
    preset: s.preset,
  });
  for (const b of s.botNear) beginPack(b);
  for (const b of s.botFar) beginPack(b);
  for (const slot of s.actors.slots) {
    if (slot.id === null || !slot.visible) continue;
    poseBot(slot, s.t, slot.near ? s.botNear : s.botFar);
  }
  for (const b of s.botNear) endPack(b);
  for (const b of s.botFar) endPack(b);

  for (const k of EFFECT_KINDS) {
    advance(s.effects[k], s.t);
    packPool(s, k, s.effects[k], s.effectBuffers[k], aspect);
  }

  // Viewmodel: follows the equipped weapon without animation when no switch event explained it.
  const equipped = asWeaponId(player.weapon.equipped);
  if (equipped !== undefined && equipped !== s.viewmodel.weapon && s.viewmodel.drawStart < 0) {
    s.viewmodel.weapon = equipped;
  }
  const speed = playerSpeed(player);
  vmStep(s.viewmodel, dt, speed, s.settings.reducedMotion);
  vmPose(s.viewmodel, s.t, speed, s.settings.reducedMotion, s.vmPose);
  s.vmPose.visible = player.alive && !scoped;
  out.viewmodel = s.vmPose;
  return out;
}

export interface CoreStats {
  readonly t: number;
  readonly frames: number;
  readonly preset: string;
  readonly botSlots: number;
  readonly botSlotCapacity: number;
  readonly botInstances: number;
  readonly poolLive: Readonly<Record<(typeof EFFECT_KINDS)[number], number>>;
  readonly poolCapacity: Readonly<Record<(typeof EFFECT_KINDS)[number], number>>;
  readonly effectInstances: number;
}

/** Counts only (SD-R-7); a new frozen object per call, so never call it in the frame path. */
export function coreStats(s: PresentationState): CoreStats {
  const count = (bs: ReadonlyArray<InstanceBuffer>): number => bs.reduce((n, b) => n + b.count, 0);
  return Object.freeze({
    t: s.t,
    frames: s.frames,
    preset: s.preset.id,
    botSlots: s.actors.slots.filter((x) => x.id !== null).length,
    botSlotCapacity: s.actors.slots.length,
    botInstances: count(s.botNear) + count(s.botFar),
    poolLive: Object.freeze({
      decal: s.effects.decal.live,
      puff: s.effects.puff.live,
      spark: s.effects.spark.live,
      muzzle: s.effects.muzzle.live,
    }),
    poolCapacity: Object.freeze({
      decal: s.effects.decal.capacity,
      puff: s.effects.puff.capacity,
      spark: s.effects.spark.capacity,
      muzzle: s.effects.muzzle.capacity,
    }),
    effectInstances: EFFECT_KINDS.reduce((n, k) => n + s.effectBuffers[k].count, 0),
  });
}
