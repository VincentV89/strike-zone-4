/**
 * Bot visual slots (LC-R-4, PD-R-2, PD-R-3, PD-R-5, BR-R-16). 20 fixed slots created once and
 * keyed by a Map<ActorId, index> that is filled and cleared, never rebuilt. The renderer mirrors
 * the snapshot's bots; it never decides how many exist. Extra bots beyond 20 are ignored.
 */
import { MAX_BOTS, type ActorId, type Stance } from '@sz/kernel';
import type { SimSnapshot, SnapshotBot } from '@sz/sim';
import { finiteOr, finiteVec, listOr } from './guards';
import type { PresetRow } from './presets';
import { resetReactions, startDeath, type ReactionState } from './reactions';

export const BOT_CAPACITY = MAX_BOTS;
export const YAW_RATE_RAD_S = 12;
export const GAIT_RAD_PER_M = 1.6;
export const CROUCH_BLEND_SEC = 0.15;
/** A bot already in the shadow-casting set leaves it only beyond botShadowNearM + 1 m. */
export const SHADOW_HYSTERESIS_M = 1;

export interface BotSlot extends ReactionState {
  id: ActorId | null;
  /** True until the first drawn frame: position snaps instead of interpolating. */
  fresh: boolean;
  seenMark: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  gait: number;
  /** 0 standing … 1 crouched. */
  crouch: number;
  stance: Stance;
  alive: boolean;
  hitFlash: boolean;
  dist: number;
  visible: boolean;
  animate: boolean;
  near: boolean;
}

export interface ActorSet {
  readonly slots: ReadonlyArray<BotSlot>;
  readonly index: Map<string, number>;
  mark: number;
}

function blankSlot(): BotSlot {
  const s: BotSlot = {
    id: null,
    fresh: true,
    seenMark: 0,
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    gait: 0,
    crouch: 0,
    stance: 'stand',
    alive: true,
    hitFlash: false,
    dist: 0,
    visible: false,
    animate: true,
    near: false,
    flinchStart: -1,
    flinchDx: 0,
    flinchDz: 0,
    deathStart: -1,
    deathDx: 0,
    deathDz: 1,
  };
  return s;
}

export function createActorSet(): ActorSet {
  const slots: BotSlot[] = [];
  for (let i = 0; i < BOT_CAPACITY; i++) slots.push(blankSlot());
  return { slots, index: new Map(), mark: 0 };
}

function freeSlot(set: ActorSet, slot: BotSlot): void {
  if (slot.id !== null) set.index.delete(slot.id);
  slot.id = null;
  slot.fresh = true;
  slot.visible = false;
  slot.near = false;
  slot.alive = true;
  slot.hitFlash = false;
  slot.gait = 0;
  slot.crouch = 0;
  resetReactions(slot);
}

export function clearActors(set: ActorSet): void {
  for (const s of set.slots) freeSlot(set, s);
  set.index.clear();
  set.mark = 0;
}

export function slotOf(set: ActorSet, id: unknown): BotSlot | undefined {
  if (typeof id !== 'string') return undefined;
  const i = set.index.get(id);
  return i === undefined ? undefined : set.slots[i];
}

/** Creates slots for new bot ids and frees slots whose id left the snapshot (BR-R-18). */
export function syncActors(set: ActorSet, curr: SimSnapshot): void {
  set.mark += 1;
  const bots = listOr(curr.bots);
  let taken = 0;
  for (const b of bots) {
    if (taken >= BOT_CAPACITY) break;
    if (typeof b.id !== 'string') continue;
    let i = set.index.get(b.id);
    if (i === undefined) {
      i = set.slots.findIndex((s) => s.id === null);
      if (i < 0) continue;
      const s = set.slots[i] as BotSlot;
      s.id = b.id;
      s.fresh = true;
      set.index.set(b.id, i);
    }
    (set.slots[i] as BotSlot).seenMark = set.mark;
    taken += 1;
  }
  for (const s of set.slots) {
    if (s.id !== null && s.seenMark !== set.mark) freeSlot(set, s);
  }
}

/** Shortest signed angle from a to b. */
export function shortestArc(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export interface ActorFrameInputs {
  readonly alpha: number;
  /** Presentation dt (0 while paused). */
  readonly dt: number;
  readonly t: number;
  readonly camX: number;
  readonly camY: number;
  readonly camZ: number;
  readonly preset: PresetRow;
}

function updateSlot(s: BotSlot, b: SnapshotBot, f: ActorFrameInputs): void {
  if (finiteVec(b.pos) && finiteVec(b.prevPos)) {
    const tx = b.prevPos.x + (b.pos.x - b.prevPos.x) * f.alpha;
    const ty = b.prevPos.y + (b.pos.y - b.prevPos.y) * f.alpha;
    const tz = b.prevPos.z + (b.pos.z - b.prevPos.z) * f.alpha;
    if (!s.fresh && s.animate && s.alive) {
      const moved = Math.sqrt((tx - s.x) ** 2 + (tz - s.z) ** 2);
      if (Number.isFinite(moved) && moved < 5) s.gait = (s.gait + moved * GAIT_RAD_PER_M) % 1000;
    }
    s.x = tx;
    s.y = ty;
    s.z = tz;
  }
  const yaw = finiteOr(b.yaw, s.yaw);
  if (s.fresh) {
    s.yaw = yaw;
    s.crouch = b.stance === 'crouch' ? 1 : 0;
  } else {
    const d = shortestArc(s.yaw, yaw);
    const maxStep = YAW_RATE_RAD_S * f.dt;
    s.yaw += Math.abs(d) <= maxStep ? d : Math.sign(d) * maxStep;
    const target = b.stance === 'crouch' ? 1 : 0;
    const k = f.dt / CROUCH_BLEND_SEC;
    s.crouch += Math.max(-k, Math.min(k, target - s.crouch));
  }
  s.stance = b.stance === 'crouch' ? 'crouch' : 'stand';
  if (!b.alive && s.alive) {
    // First frame alive is false: start the death reaction if ActorKilled has not (FD-R-2).
    startDeath(s, f.t, Math.sin(s.yaw), Math.cos(s.yaw));
  }
  s.alive = b.alive;
  s.hitFlash = s.alive && b.hitFlash;
  const dx = s.x - f.camX;
  const dy = s.y - f.camY;
  const dz = s.z - f.camZ;
  s.dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  s.visible = s.dist <= f.preset.drawDistanceM;
  s.animate = s.dist <= f.preset.animLodM;
  const nearM = f.preset.sunShadows ? f.preset.botShadowNearM : 0;
  s.near = s.near ? s.dist <= nearM + SHADOW_HYSTERESIS_M && nearM > 0 : s.dist < nearM;
  s.fresh = false;
}

/** Interpolates every mirrored bot, then applies LOD, culling and the near/far shadow split. */
export function updateActors(set: ActorSet, curr: SimSnapshot, f: ActorFrameInputs): void {
  const bots = listOr(curr.bots);
  for (const b of bots) {
    const s = slotOf(set, b.id);
    if (s !== undefined && s.seenMark === set.mark) updateSlot(s, b, f);
  }
}
