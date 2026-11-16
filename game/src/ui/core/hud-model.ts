/**
 * HUD view model (business-logic-model-ui-hud §6.1, PD-UI-2, PD-UI-4). Values are already
 * formatted and quantised, so float noise never causes a DOM write. The modeller memoises on
 * (snap.tick, effects.version, view, settings, tabHeld): a paused frame returns the same object.
 */
import type { Settings } from '@sz/persistence';
import type { RoundView } from '@sz/round';
import type { SimSnapshot } from '@sz/sim';
import { accuracyPct } from '@sz/stats';
import { damageArcAngle } from './bearing';
import {
  MAX_ARCS,
  MAX_FEED,
  arcOpacity,
  feedOpacity,
  markerOpacity,
  type HudEffects,
  type MarkerKind,
} from './effects';
import {
  actorLabel,
  botNumber,
  formatAccuracy,
  formatClock,
  quantise,
  weaponLabel,
} from './format';
import { RADAR_SLOTS, toRadarModel, type RadarInput, type RadarModel } from './radar';

export type SlotState = 'equipped' | 'owned' | 'empty';
export type AmmoCue = '' | 'R RELOAD' | 'NO AMMO';
export type CountdownText = '' | '3' | '2' | '1' | 'GO';

export interface ArcModel {
  readonly angleDeg: number;
  readonly opacity: number;
}

export interface FeedRowModel {
  readonly text: string;
  readonly headshot: boolean;
  readonly opacity: number;
}

export interface ScoreboardRow {
  readonly label: string;
  readonly alive: boolean;
}

/** No positions and no bot AI states (BR-UI-30). */
export interface ScoreboardModel {
  readonly open: boolean;
  readonly kills: number;
  readonly deaths: number;
  readonly headshots: number;
  readonly accuracy: string;
  readonly enemiesRemaining: number;
  /** One per bot slot; null beyond botCount. */
  readonly roster: ReadonlyArray<ScoreboardRow | null>;
}

export interface HudViewModel {
  readonly visible: boolean;
  readonly scoped: boolean;
  readonly health: number;
  readonly armor: number;
  readonly healthLow: boolean;
  readonly weaponLabel: string;
  readonly ammoText: string;
  readonly ammoCue: AmmoCue;
  /** 0..1 while reloading, else null. */
  readonly reloadProgress: number | null;
  readonly slots: ReadonlyArray<SlotState>;
  readonly crosshairGapPx: number;
  readonly timerText: string;
  readonly timerWarn: boolean;
  readonly enemiesRemaining: number;
  readonly kills: number;
  readonly countdown: CountdownText;
  readonly hitMarker: { readonly kind: MarkerKind | ''; readonly opacity: number };
  /** Always MAX_ARCS entries; opacity 0 means unused. */
  readonly damageArcs: ReadonlyArray<ArcModel>;
  /** Always MAX_FEED entries, newest first; empty text means unused. */
  readonly killFeed: ReadonlyArray<FeedRowModel>;
  readonly radar: RadarModel | null;
  readonly scoreboard: ScoreboardModel;
  readonly toast: string;
}

export interface HudInput {
  readonly snap: SimSnapshot | undefined;
  readonly view: RoundView;
  readonly effects: HudEffects;
  readonly radar: RadarInput;
  readonly settings: Settings;
  readonly tabHeld: boolean;
}

const WEAPON_SLOTS = ['rifle', 'pistol', 'sniper'] as const;
const GO_WINDOW_SEC = 0.4;
const ROSTER_SLOTS = RADAR_SLOTS;

const EMPTY_ARC: ArcModel = Object.freeze({ angleDeg: 0, opacity: 0 });
const EMPTY_FEED: FeedRowModel = Object.freeze({ text: '', headshot: false, opacity: 0 });

function freezeAll<T>(items: T[]): ReadonlyArray<T> {
  return Object.freeze(items);
}

/** The model shown before spawn: everything hidden. */
export const HIDDEN_HUD: HudViewModel = Object.freeze({
  visible: false,
  scoped: false,
  health: 0,
  armor: 0,
  healthLow: false,
  weaponLabel: '',
  ammoText: '',
  ammoCue: '',
  reloadProgress: null,
  slots: freezeAll<SlotState>(['empty', 'empty', 'empty']),
  crosshairGapPx: 6,
  timerText: '0:00',
  timerWarn: false,
  enemiesRemaining: 0,
  kills: 0,
  countdown: '',
  hitMarker: Object.freeze({ kind: '', opacity: 0 }),
  damageArcs: freezeAll(Array.from({ length: MAX_ARCS }, () => EMPTY_ARC)),
  killFeed: freezeAll(Array.from({ length: MAX_FEED }, () => EMPTY_FEED)),
  radar: null,
  scoreboard: Object.freeze({
    open: false,
    kills: 0,
    deaths: 0,
    headshots: 0,
    accuracy: '0%',
    enemiesRemaining: 0,
    roster: freezeAll<ScoreboardRow | null>(
      new Array<ScoreboardRow | null>(ROSTER_SLOTS).fill(null),
    ),
  }),
  toast: '',
});

function countdownOf(view: RoundView): CountdownText {
  if (view.phase === 'countdown' && view.countdown !== undefined) {
    return String(view.countdown) as CountdownText;
  }
  if (view.phase === 'live' && view.durationSec - view.timeLeftSec < GO_WINDOW_SEC) return 'GO';
  return '';
}

function ammoCueOf(w: SimSnapshot['player']['weapon']): AmmoCue {
  if (w.magazine === 0 && w.reserve === 0) return 'NO AMMO';
  if (w.magazine === 0 && w.reserve > 0 && w.status === 'ready') return 'R RELOAD';
  return '';
}

function slotsOf(w: SimSnapshot['player']['weapon']): ReadonlyArray<SlotState> {
  return freezeAll(
    WEAPON_SLOTS.map((id): SlotState => {
      if (w.equipped === id) return 'equipped';
      return w.owned.some((o) => o.weapon === id) ? 'owned' : 'empty';
    }),
  );
}

function scoreboardOf(input: HudInput, snap: SimSnapshot): ScoreboardModel {
  const t = input.effects.tally;
  const roster = new Array<ScoreboardRow | null>(ROSTER_SLOTS).fill(null);
  for (const b of snap.bots) {
    const n = botNumber(b.id);
    if (n >= 1 && n <= ROSTER_SLOTS)
      roster[n - 1] = Object.freeze({ label: actorLabel(b.id), alive: b.alive });
  }
  const phase = input.view.phase;
  return Object.freeze({
    open: input.tabHeld && (phase === 'countdown' || phase === 'live'),
    kills: t.kills,
    deaths: t.deaths,
    headshots: t.headshots,
    accuracy: formatAccuracy(accuracyPct(t)),
    enemiesRemaining: snap.aliveBots,
    roster: freezeAll(roster),
  });
}

function arcsOf(fx: HudEffects, yaw: number, now: number): ReadonlyArray<ArcModel> {
  const out: ArcModel[] = [];
  for (let i = 0; i < MAX_ARCS; i++) {
    const a = fx.arcs[i];
    out.push(
      a
        ? Object.freeze({
            angleDeg: quantise(damageArcAngle(yaw, a), 0.5),
            opacity: quantise(arcOpacity(a, now), 0.05),
          })
        : EMPTY_ARC,
    );
  }
  return freezeAll(out);
}

function feedOf(fx: HudEffects, now: number): ReadonlyArray<FeedRowModel> {
  const out: FeedRowModel[] = [];
  for (let i = 0; i < MAX_FEED; i++) {
    const f = fx.feed[i];
    out.push(
      f
        ? Object.freeze({
            text: `${actorLabel(f.killer)} [${weaponLabel(f.weapon)}] ${actorLabel(f.victim)}`,
            headshot: f.headshot,
            opacity: quantise(feedOpacity(f, now), 0.05),
          })
        : EMPTY_FEED,
    );
  }
  return freezeAll(out);
}

/** Builds the frame's view model. Pure; prefer createHudModeller for the memoised form. */
export function toHudViewModel(input: HudInput): HudViewModel {
  const { snap, view, effects: fx } = input;
  if (!snap) return HIDDEN_HUD;
  const p = snap.player;
  const w = p.weapon;
  const now = snap.now;
  const scoped = w.scoped && w.equipped === 'sniper';
  const marker = markerOpacity(fx.marker, now);
  return Object.freeze({
    visible: (view.phase === 'countdown' || view.phase === 'live') && !view.paused,
    scoped,
    health: Math.max(0, Math.round(p.vitals.health)),
    armor: Math.max(0, Math.round(p.vitals.armor)),
    healthLow: p.alive && p.vitals.health < 25,
    weaponLabel: weaponLabel(w.equipped),
    ammoText: `${String(w.magazine)}/${String(w.reserve)}`,
    ammoCue: ammoCueOf(w),
    reloadProgress: w.status === 'reloading' ? quantise(w.progress, 0.02) : null,
    slots: slotsOf(w),
    crosshairGapPx: Math.min(40, Math.max(6, Math.round(6 + w.spread * 600))),
    timerText: formatClock(view.timeLeftSec, 'ceil'),
    timerWarn: view.phase === 'live' && view.timeLeftSec < 30,
    enemiesRemaining: snap.aliveBots,
    kills: fx.tally.kills,
    countdown: countdownOf(view),
    hitMarker: Object.freeze({
      kind: marker > 0 && fx.marker ? fx.marker.kind : '',
      opacity: quantise(marker, 0.05),
    }),
    damageArcs: arcsOf(fx, p.yaw, now),
    killFeed: feedOf(fx, now),
    radar: toRadarModel(snap, fx, input.radar),
    scoreboard: scoreboardOf(input, snap),
    toast: fx.toast ? fx.toast.text : '',
  });
}

export interface HudModeller {
  (input: HudInput): HudViewModel;
  /** Frames that returned the cached model (diagnostics). */
  hits(): number;
  reset(): void;
}

/** PD-UI-2: memoised toHudViewModel. view and settings compare by reference. */
export function createHudModeller(): HudModeller {
  let key: readonly unknown[] | undefined;
  let last: HudViewModel = HIDDEN_HUD;
  let hits = 0;
  const modeller = (input: HudInput): HudViewModel => {
    const next = [
      input.snap,
      input.snap?.tick,
      input.effects.version,
      input.view,
      input.settings,
      input.tabHeld,
      input.radar,
    ] as const;
    if (key?.every((v, i) => v === next[i])) {
      hits++;
      return last;
    }
    key = next;
    last = toHudViewModel(input);
    return last;
  };
  return Object.assign(modeller, {
    hits: () => hits,
    reset() {
      key = undefined;
      last = HIDDEN_HUD;
    },
  });
}
