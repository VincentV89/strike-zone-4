/**
 * HUD effect reducers (business-logic-model-ui-hud §7, PD-UI-1, PD-UI-7). Pure functions of
 * (state, drained events, sim time). Effects age on sim time (FD-UI-6), so Pause freezes them.
 * Stores are fixed-size: 4 arcs, 5 feed rows, at most 20 pings, 1 marker, 1 toast.
 */
import { PLAYER_ID, type ActorId, type DomainEvent, type Vec3, type WeaponId } from '@sz/kernel';
import type { GraphicsPreset } from '@sz/persistence';
import type { SimSnapshot } from '@sz/sim';
import { createRoundStats, recordEvent, type RoundStats } from '@sz/stats';
import { angleDiffDeg, worldBearingDeg } from './bearing';

/**
 * Largest noiseRadiusM over BOT_LOADOUT (FD-UI-7). A literal, because ui may not import weapon
 * values; a test imports @sz/weapons and pins it.
 */
export const HEARD_SHOT_RADIUS_M = 40;

export const MARKER_HOLD_SEC = 0.1;
export const MARKER_LIFE_SEC = 0.3;
export const ARC_LIFE_SEC = 1;
export const ARC_MERGE_DEG = 20;
export const MAX_ARCS = 4;
export const FEED_VISIBLE_SEC = 5;
export const FEED_FADE_SEC = 0.3;
export const MAX_FEED = 5;
export const PING_LIFE_SEC = 3;
export const MAX_PINGS = 20;
export const TOAST_LIFE_SEC = 8;
export const ANNOUNCE_BATCH_SEC = 2;
export const LOW_HEALTH = 25;

export type MarkerKind = 'body' | 'head' | 'kill';

export interface Marker {
  readonly kind: MarkerKind;
  readonly t0: number;
}

export interface Arc {
  x: number;
  z: number;
  t0: number;
}

export interface FeedEntry {
  readonly killer: ActorId;
  readonly victim: ActorId;
  readonly weapon: WeaponId;
  readonly headshot: boolean;
  readonly t0: number;
}

export interface Ping {
  readonly x: number;
  readonly z: number;
  readonly t0: number;
}

export interface Toast {
  readonly text: string;
  readonly t0: number;
}

/** Mutable reducer state owned by ui (business-logic-model-ui-hud §4.3). */
export interface HudEffects {
  /** Increases whenever a store changes (PD-UI-1). */
  version: number;
  /** Sim time of the last reduce. */
  now: number;
  marker: Marker | undefined;
  readonly arcs: Arc[];
  /** Newest first. */
  readonly feed: FeedEntry[];
  readonly pings: Map<ActorId, Ping>;
  toast: Toast | undefined;
  toastShown: boolean;
  advisory: { readonly fps: number } | undefined;
  tally: RoundStats;
  lastKilledBy: { readonly killer: ActorId; readonly headshot: boolean } | undefined;
  /** 1 on the first round of a page load (§7.8). */
  roundIndex: number;
  lowHealthArmed: boolean;
  pendingKills: number;
  lastFlush: number;
  readonly announcements: string[];
}

export interface EffectsContext {
  /** snapshot.now; undefined before spawn. */
  readonly now: number | undefined;
  readonly playerPos: Vec3 | undefined;
  readonly graphics: GraphicsPreset;
  readonly health: number | undefined;
  readonly alive: boolean | undefined;
  readonly aliveBots: number | undefined;
}

/** The reducer context for one frame, read from the frame's snapshot (§6). */
export function effectsContext(
  snap: SimSnapshot | undefined,
  graphics: GraphicsPreset,
): EffectsContext {
  return {
    now: snap?.now,
    playerPos: snap?.player.pos,
    graphics,
    health: snap?.player.vitals.health,
    alive: snap?.player.alive,
    aliveBots: snap?.aliveBots,
  };
}

export function createEffects(): HudEffects {
  return {
    version: 0,
    now: 0,
    marker: undefined,
    arcs: [],
    feed: [],
    pings: new Map(),
    toast: undefined,
    toastShown: false,
    advisory: undefined,
    tally: createRoundStats(),
    lastKilledBy: undefined,
    roundIndex: 0,
    lowHealthArmed: true,
    pendingKills: 0,
    lastFlush: Number.NEGATIVE_INFINITY,
    announcements: [],
  };
}

/** A new round (RoundPhaseChanged loading → ready): new tally, every effect cleared, round number + 1 (§7.8). */
export function resetRound(fx: HudEffects): void {
  fx.tally = createRoundStats();
  fx.marker = undefined;
  fx.arcs.length = 0;
  fx.feed.length = 0;
  fx.pings.clear();
  fx.toast = undefined;
  fx.toastShown = false;
  fx.advisory = undefined;
  fx.lastKilledBy = undefined;
  fx.roundIndex += 1;
  fx.lowHealthArmed = true;
  fx.pendingKills = 0;
  fx.lastFlush = Number.NEGATIVE_INFINITY;
  fx.now = 0;
  fx.version += 1;
}

const KIND_RANK: Readonly<Record<MarkerKind, number>> = { body: 0, head: 1, kill: 2 };

function onHit(fx: HudEffects, kind: MarkerKind, now: number): void {
  const m = fx.marker;
  const visible = m !== undefined && now - m.t0 < MARKER_LIFE_SEC;
  const best = visible && KIND_RANK[m.kind] > KIND_RANK[kind] ? m.kind : kind;
  fx.marker = { kind: best, t0: now };
}

function onDamage(fx: HudEffects, dir: Vec3, now: number): void {
  if (!Number.isFinite(dir.x) || !Number.isFinite(dir.z)) return;
  if (Math.abs(dir.x) + Math.abs(dir.z) < 1e-6) return; // vitals change, no arc
  const bearing = worldBearingDeg(dir);
  const same = fx.arcs.find((a) => angleDiffDeg(worldBearingDeg(a), bearing) < ARC_MERGE_DEG);
  if (same) {
    same.x = dir.x;
    same.z = dir.z;
    same.t0 = now;
    return;
  }
  fx.arcs.push({ x: dir.x, z: dir.z, t0: now });
  if (fx.arcs.length > MAX_ARCS) fx.arcs.shift();
}

function onShot(fx: HudEffects, shooter: ActorId, origin: Vec3, ctx: EffectsContext, now: number) {
  const p = ctx.playerPos;
  if (shooter === PLAYER_ID || !p) return false;
  if (Math.hypot(origin.x - p.x, origin.z - p.z) > HEARD_SHOT_RADIUS_M) return false;
  if (!fx.pings.has(shooter) && fx.pings.size >= MAX_PINGS) return false;
  fx.pings.set(shooter, { x: origin.x, z: origin.z, t0: now });
  return true;
}

function onKilled(fx: HudEffects, e: Extract<DomainEvent, { type: 'ActorKilled' }>, now: number) {
  fx.feed.unshift({
    killer: e.killer,
    victim: e.victim,
    weapon: e.weapon,
    headshot: e.headshot,
    t0: now,
  });
  if (fx.feed.length > MAX_FEED) fx.feed.length = MAX_FEED;
  fx.pings.delete(e.victim);
  if (e.victim === PLAYER_ID) fx.lastKilledBy = { killer: e.killer, headshot: e.headshot };
  else fx.pendingKills += 1;
}

/** Returns true when the event changed a store. */
function reduceOne(fx: HudEffects, e: DomainEvent, ctx: EffectsContext, now: number): boolean {
  switch (e.type) {
    case 'HitConfirmed':
      recordEvent(fx.tally, e);
      if (e.shooter !== PLAYER_ID) return false;
      onHit(fx, e.killed ? 'kill' : e.zone === 'head' ? 'head' : 'body', now);
      return true;
    case 'DamageTaken':
      recordEvent(fx.tally, e);
      if (e.victim === PLAYER_ID) onDamage(fx, e.dir, now);
      return true;
    case 'ActorKilled':
      recordEvent(fx.tally, e);
      onKilled(fx, e, now);
      return true;
    case 'ShotFired':
      recordEvent(fx.tally, e);
      return onShot(fx, e.shooter, e.origin, ctx, now) || e.shooter === PLAYER_ID;
    case 'PerformanceAdvisory':
      if (ctx.graphics !== 'high' || fx.toastShown) return false;
      fx.advisory = { fps: Math.round(Number.isFinite(e.medianFps) ? e.medianFps : 0) };
      fx.toast = {
        text: `Performance is low (${String(fx.advisory.fps)} FPS). Try Medium graphics in Pause → Settings.`,
        t0: now,
      };
      fx.toastShown = true;
      return true;
    case 'RoundPhaseChanged':
      // §7.8 says "→ loading", but the controller emits only real changes and its idle phase is
      // already 'loading', so the first round never emits it. Every successful start emits
      // loading → ready, so the round resets there (once per start, first round included).
      if (e.to === 'ready' && e.from === 'loading') resetRound(fx);
      if (e.to === 'live') fx.announcements.push('Round started');
      return true;
    case 'RoundEnded':
      flushKills(fx, ctx, now);
      return false;
    default:
      return false;
  }
}

function flushKills(fx: HudEffects, ctx: EffectsContext, now: number): void {
  if (fx.pendingKills === 0) return;
  const left = String(ctx.aliveBots ?? 0);
  fx.announcements.push(
    fx.pendingKills === 1
      ? `Enemy eliminated, ${left} remaining`
      : `${String(fx.pendingKills)} enemies eliminated, ${left} remaining`,
  );
  fx.pendingKills = 0;
  fx.lastFlush = now;
}

function lowHealth(fx: HudEffects, ctx: EffectsContext): void {
  const h = ctx.health;
  if (h === undefined || !Number.isFinite(h)) return;
  if (h >= LOW_HEALTH) {
    fx.lowHealthArmed = true;
    return;
  }
  if (ctx.alive === true && fx.lowHealthArmed) {
    fx.lowHealthArmed = false;
    fx.announcements.push('Low health');
  }
}

/** Removes aged-out entries in place; true when anything was removed. */
function expire(fx: HudEffects, now: number): boolean {
  let changed = false;
  if (fx.marker && now - fx.marker.t0 >= MARKER_LIFE_SEC) {
    fx.marker = undefined;
    changed = true;
  }
  for (let i = fx.arcs.length - 1; i >= 0; i--) {
    const a = fx.arcs[i];
    if (a && now - a.t0 >= ARC_LIFE_SEC) {
      fx.arcs.splice(i, 1);
      changed = true;
    }
  }
  for (let i = fx.feed.length - 1; i >= 0; i--) {
    const f = fx.feed[i];
    if (f && now - f.t0 >= FEED_VISIBLE_SEC + FEED_FADE_SEC) {
      fx.feed.splice(i, 1);
      changed = true;
    }
  }
  for (const [id, p] of fx.pings) {
    if (now - p.t0 >= PING_LIFE_SEC) {
      fx.pings.delete(id);
      changed = true;
    }
  }
  if (fx.toast && now - fx.toast.t0 >= TOAST_LIFE_SEC) {
    fx.toast = undefined;
    changed = true;
  }
  return changed;
}

/** Walks the drained events in order, then ages every store (§7). */
export function reduceEffects(
  fx: HudEffects,
  events: ReadonlyArray<DomainEvent>,
  ctx: EffectsContext,
): void {
  let changed = false;
  for (const e of events) {
    const now = ctx.now ?? fx.now;
    if (reduceOne(fx, e, ctx, now)) changed = true;
  }
  const now = ctx.now ?? fx.now;
  if (fx.pendingKills > 0 && now - fx.lastFlush >= ANNOUNCE_BATCH_SEC) flushKills(fx, ctx, now);
  lowHealth(fx, ctx);
  if (expire(fx, now)) changed = true;
  fx.now = now;
  if (changed) fx.version += 1;
}

/** Returns and clears the queued polite announcements. */
export function takeAnnouncements(fx: HudEffects): ReadonlyArray<string> {
  return fx.announcements.splice(0);
}

// ---- opacity helpers (quantised by the view model) ----

export function markerOpacity(m: Marker | undefined, now: number): number {
  if (!m) return 0;
  const age = now - m.t0;
  if (age < 0 || age >= MARKER_LIFE_SEC) return age < 0 ? 1 : 0;
  if (age < MARKER_HOLD_SEC) return 1;
  return 1 - (age - MARKER_HOLD_SEC) / (MARKER_LIFE_SEC - MARKER_HOLD_SEC);
}

export function arcOpacity(a: Pick<Arc, 't0'>, now: number): number {
  const age = Math.max(0, now - a.t0);
  return Math.max(0, 1 - age / ARC_LIFE_SEC);
}

export function feedOpacity(f: Pick<FeedEntry, 't0'>, now: number): number {
  const age = Math.max(0, now - f.t0);
  if (age < FEED_VISIBLE_SEC) return 1;
  return Math.max(0, 1 - (age - FEED_VISIBLE_SEC) / FEED_FADE_SEC);
}

export function pingOpacity(p: Pick<Ping, 't0'>, now: number): number {
  const age = Math.max(0, now - p.t0);
  return Math.max(0, 1 - age / PING_LIFE_SEC);
}
