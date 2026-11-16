// HUD test support (logical-components-ui-hud T2): snapshot/view fixtures and a frame driver that
// runs app-shell's steps 4–6 (onEvents → view model → diff) over a real round from round-driver.
import { PLAYER_ID, vec3, type ActorId, type DomainEvent, type Vec3 } from '@sz/kernel';
import { DEFAULT_SETTINGS, type Settings } from '@sz/persistence';
import type { RoundView } from '@sz/round';
import type { SimSnapshot, SnapshotBot } from '@sz/sim';
import { ZERO_TOTALS } from '@sz/stats';
import { createEffects, reduceEffects, type HudEffects } from '@sz/ui/core/effects';
import { diffHud, type HudPatch } from '@sz/ui/core/hud-diff';
import { createHudModeller, type HudViewModel } from '@sz/ui/core/hud-model';
import { RADAR_PX_PER_M, type RadarInput } from '@sz/ui/core/radar';
import type { TestRound } from './round-driver';

export const bot = (n: number): ActorId => `bot-${String(n)}` as ActorId;

export const RADAR: RadarInput = Object.freeze({
  segments: [],
  pxPerM: RADAR_PX_PER_M,
  radiusPx: 130,
});

export interface SnapOptions {
  readonly tick?: number;
  readonly now?: number;
  readonly pos?: Vec3;
  readonly yaw?: number;
  readonly health?: number;
  readonly armor?: number;
  readonly alive?: boolean;
  readonly magazine?: number;
  readonly reserve?: number;
  readonly status?: 'ready' | 'cooldown' | 'drawing' | 'reloading';
  readonly progress?: number;
  readonly equipped?: 'rifle' | 'pistol' | 'sniper';
  readonly scoped?: boolean;
  readonly spread?: number;
  readonly bots?: ReadonlyArray<Partial<SnapshotBot> & { readonly id: ActorId }>;
}

/** A hand-built SimSnapshot with sensible defaults (frozen like the real one). */
export function makeSnapshot(o: SnapOptions = {}): SimSnapshot {
  const bots: SnapshotBot[] = (o.bots ?? []).map((b) => ({
    pos: vec3(0, 0, -10),
    prevPos: vec3(0, 0, -10),
    yaw: 0,
    pitch: 0,
    stance: 'stand',
    state: 'patrol',
    alive: true,
    hitFlash: false,
    revealed: false,
    ...b,
  }));
  const pos = o.pos ?? vec3(0, 0, 0);
  return deepFreeze({
    tick: o.tick ?? 1,
    now: o.now ?? 1,
    player: {
      pos,
      prevPos: pos,
      yaw: o.yaw ?? 0,
      pitch: 0,
      stance: 'stand',
      eyeHeight: 1.65,
      grounded: true,
      alive: o.alive ?? true,
      vitals: { health: o.health ?? 100, armor: o.armor ?? 100 },
      weapon: {
        equipped: o.equipped ?? 'rifle',
        magazine: o.magazine ?? 30,
        reserve: o.reserve ?? 90,
        status: o.status ?? 'ready',
        progress: o.progress ?? 1,
        scoped: o.scoped ?? false,
        spread: o.spread ?? 0,
        owned: [
          { weapon: 'rifle', magazine: 30, reserve: 90 },
          { weapon: 'pistol', magazine: 12, reserve: 36 },
          { weapon: 'sniper', magazine: 5, reserve: 15 },
        ],
      },
      hitFlash: false,
    },
    bots,
    aliveBots: bots.filter((b) => b.alive).length,
    botCount: (bots.length || 1) as SimSnapshot['botCount'],
    events: [],
  });
}

export function makeView(o: Partial<RoundView> = {}): RoundView {
  return Object.freeze({
    phase: 'live',
    paused: false,
    started: true,
    timeLeftSec: 120,
    durationSec: 180,
    totals: ZERO_TOTALS,
    ...o,
  });
}

export function deepFreeze<T>(v: T): T {
  if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const c of Object.values(v)) deepFreeze(c);
  }
  return v;
}

export function ctxOf(snap: SimSnapshot | undefined, settings: Settings = DEFAULT_SETTINGS) {
  return {
    now: snap?.now,
    playerPos: snap?.player.pos,
    graphics: settings.graphics,
    health: snap?.player.vitals.health,
    alive: snap?.player.alive,
    aliveBots: snap?.aliveBots,
  };
}

export interface HudFrameDriver {
  readonly effects: HudEffects;
  readonly frames: number;
  readonly patchCounts: number[];
  readonly last: HudViewModel | undefined;
  /** Runs one frame: drain, reduce, model, diff. Returns the patches. */
  frame(tabHeld?: boolean): ReadonlyArray<HudPatch>;
}

/** Runs app-shell steps 3–6 against a TestRound's recording bus. */
export function createHudDriver(
  t: TestRound,
  settings: Settings = DEFAULT_SETTINGS,
): HudFrameDriver {
  const effects = createEffects();
  const model = createHudModeller();
  const patchCounts: number[] = [];
  let last: HudViewModel | undefined;
  let frames = 0;
  return {
    effects,
    get frames() {
      return frames;
    },
    patchCounts,
    get last() {
      return last;
    },
    frame(tabHeld = false) {
      frames++;
      const events: ReadonlyArray<DomainEvent> = t.bus.drain();
      const snap = t.round.snapshot();
      reduceEffects(effects, events, ctxOf(snap, settings));
      const vm = model({
        snap,
        view: t.round.state(),
        effects,
        radar: RADAR,
        settings,
        tabHeld,
      });
      const patches = diffHud(last, vm);
      last = vm;
      patchCounts.push(patches.length);
      return patches;
    },
  };
}

export const PLAYER = PLAYER_ID;
