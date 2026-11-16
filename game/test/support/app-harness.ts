// app-shell test harness (PD-AS-15). Builds the real App over counting fakes for ui, input,
// audio and renderer, the real round/sim/stats/persistence, and the box-world SimPhysicsPort fake
// from round-driver. Test-only: nothing here is shipped.
import type { App, AppDeps } from '@sz/app/dom/app';
import { createApp } from '@sz/app/dom/app';
import type {
  AudioPort,
  Booted,
  HostPort,
  InputPort,
  RendererPort,
  UiPort,
} from '@sz/app/dom/ports';
import { createReporter, type Reporter } from '@sz/app/dom/report';
import {
  createEventBus,
  createFixedClock,
  type DomainEvent,
  type EventBus,
  type MapId,
} from '@sz/kernel';
import {
  createMapCatalog,
  desertCompound,
  industrialWarehouse,
  type MapCatalog,
  type MapDefinition,
} from '@sz/maps';
import type { NavGraph } from '@sz/nav';
import { createStore, type Store } from '@sz/persistence';
import type { PhysicsWorld } from '@sz/physics';
import { NEUTRAL_INTENT, type PlayerInputIntent } from '@sz/player';
import type { RenderFrame, RenderSettings } from '@sz/render';
import type { ScreenModel, UiIntent } from '@sz/ui';
import { createEffects } from '@sz/ui/core/effects';
import { mapWorld } from './ai-arena';
import { createFakeStorage, createManualSchedule, type FakeStorage } from './fake-storage';
import { createFakeSimPhysics, type FakeSimPhysics } from './round-driver';

export interface FakeUi extends UiPort {
  readonly screens: ScreenModel[];
  readonly announcements: string[];
  readonly outlines: number;
  hudThrows: boolean;
  readonly counts: { onEvents: number; updateHud: number; showHudFault: number; resetHud: number };
  last(): ScreenModel | undefined;
}

export function createFakeUi(): FakeUi {
  const screens: ScreenModel[] = [];
  const announcements: string[] = [];
  const fx = createEffects();
  const counts = { onEvents: 0, updateHud: 0, showHudFault: 0, resetHud: 0 };
  let outlines = 0;
  const ui: FakeUi = {
    screens,
    announcements,
    get outlines() {
      return outlines;
    },
    hudThrows: false,
    counts,
    last: () => screens[screens.length - 1],
    showScreen(m) {
      screens.push(m);
    },
    onEvents() {
      counts.onEvents++;
    },
    updateHud() {
      counts.updateHud++;
      if (ui.hudThrows) throw new Error('hud boom');
    },
    radarInput: () => ({ segments: null, pxPerM: 4, radiusPx: 130 }),
    setRadarOutline() {
      outlines++;
    },
    announce(text) {
      announcements.push(text);
    },
    showHudFault() {
      counts.showHudFault++;
    },
    resetHud() {
      counts.resetHud++;
    },
    effects: () => fx,
  };
  return ui;
}

export interface FakeInput extends InputPort {
  intent: PlayerInputIntent;
  readonly counts: { poll: number; requestLock: number; releaseLock: number };
  readonly enabled: boolean[];
}

export function createFakeInput(): FakeInput {
  const counts = { poll: 0, requestLock: 0, releaseLock: 0 };
  const enabled: boolean[] = [];
  const input: FakeInput = {
    intent: NEUTRAL_INTENT,
    counts,
    enabled,
    poll() {
      counts.poll++;
      return input.intent;
    },
    requestLock() {
      counts.requestLock++;
    },
    releaseLock() {
      counts.releaseLock++;
    },
    setEnabled(on) {
      enabled.push(on);
    },
  };
  return input;
}

export interface FakeAudio extends AudioPort {
  readonly played: string[];
  readonly ducks: boolean[];
  readonly volumes: [number, number][];
  readonly counts: { unlock: number; setListener: number };
}

export function createFakeAudio(): FakeAudio {
  const played: string[] = [];
  const ducks: boolean[] = [];
  const volumes: [number, number][] = [];
  const counts = { unlock: 0, setListener: 0 };
  return {
    played,
    ducks,
    volumes,
    counts,
    unlock() {
      counts.unlock++;
      return Promise.resolve();
    },
    play(cue) {
      played.push(cue);
    },
    setListener() {
      counts.setListener++;
    },
    setVolumes(m, e) {
      volumes.push([m, e]);
    },
    duck(on) {
      ducks.push(on);
    },
  };
}

export interface FakeRenderer extends RendererPort {
  readonly loaded: MapId[];
  readonly frames: RenderFrame[];
  readonly settings: Partial<RenderSettings>[];
  readonly counts: { beginRound: number };
}

export function createFakeRenderer(): FakeRenderer {
  const loaded: MapId[] = [];
  const frames: RenderFrame[] = [];
  const settings: Partial<RenderSettings>[] = [];
  const counts = { beginRound: 0 };
  return {
    loaded,
    frames,
    settings,
    counts,
    loadMap(map) {
      loaded.push(map.id);
    },
    beginRound() {
      counts.beginRound++;
    },
    render(f) {
      frames.push(f);
      if (frames.length > 50) frames.shift();
    },
    applySettings(s) {
      settings.push(s);
      return { preset: 'medium', fovDeg: 90, reducedMotion: false, ...s };
    },
  };
}

export interface FakeHost extends HostPort {
  readonly loads: MapId[];
  readonly worlds: Map<MapId, FakeSimPhysics>;
  currentFake(): FakeSimPhysics | undefined;
}

export function createFakeHost(): FakeHost {
  const loads: MapId[] = [];
  const worlds = new Map<MapId, FakeSimPhysics>();
  let current: FakeSimPhysics | undefined;
  const host: FakeHost = {
    loads,
    worlds,
    currentFake: () => current,
    load(map: MapDefinition) {
      loads.push(map.id);
      current = createFakeSimPhysics(map);
      worlds.set(map.id, current);
      return current as unknown as PhysicsWorld;
    },
    current: () => current as unknown as PhysicsWorld | undefined,
    query: { raycast: () => null, lineOfSight: () => true },
  };
  return host;
}

export interface AppHarness {
  readonly app: App;
  readonly ui: FakeUi;
  readonly input: FakeInput;
  readonly audio: FakeAudio;
  readonly renderer: FakeRenderer;
  readonly host: FakeHost;
  readonly store: Store;
  readonly storage: FakeStorage;
  readonly bus: EventBus<DomainEvent>;
  readonly reporter: Reporter;
  readonly reported: string[];
  readonly booted: Booted;
  readonly bootCalls: { start: number; retry: number; stopLoop: number };
  /** Advances wall time and runs app.frame; returns the new time in ms. */
  frames(n: number, dtMs?: number): number;
  send(intent: UiIntent): void;
  /** boot-ready → enter → start-match → frame → capture → lock → countdown → live. */
  goLive(): void;
  screen(): string;
}

export interface HarnessOptions {
  readonly reducedMotion?: boolean;
  readonly storage?: FakeStorage;
  readonly attach?: boolean;
  readonly seeds?: () => number;
}

let catalogCache: MapCatalog | undefined;

function catalog(): MapCatalog {
  if (catalogCache) return catalogCache;
  const made = createMapCatalog([desertCompound, industrialWarehouse]);
  if (!made.ok) throw new Error('catalog');
  catalogCache = made.value;
  return catalogCache;
}

export function createAppHarness(opts: HarnessOptions = {}): AppHarness {
  const ui = createFakeUi();
  const input = createFakeInput();
  const audio = createFakeAudio();
  const renderer = createFakeRenderer();
  const host = createFakeHost();
  const storage = opts.storage ?? createFakeStorage();
  const sched = createManualSchedule();
  const store = createStore({ storage, now: () => 1_700_000_000_000, schedule: sched.schedule });
  const reported: string[] = [];
  const reporter = createReporter((m) => {
    reported.push(m);
  });
  const bus = createEventBus<DomainEvent>({
    onSubscriberError: (e) => {
      reporter('subscriber', e);
    },
  });
  const bootCalls = { start: 0, retry: 0, stopLoop: 0 };
  let seed = 7;
  const deps: AppDeps = {
    ui,
    input,
    store,
    bus,
    clock: createFixedClock({ stepHz: 60, maxSubsteps: 5 }),
    report: reporter,
    nextSeed: opts.seeds ?? (() => seed++),
    reducedMotion: () => opts.reducedMotion === true,
    formatDate: (ms) => new Date(ms).toISOString(),
    version: 'test',
    tabHeld: () => false,
    startBoot: () => {
      bootCalls.start++;
    },
    retryBoot: () => {
      bootCalls.retry++;
    },
    stopLoop: () => {
      bootCalls.stopLoop++;
    },
  };
  const app = createApp(deps);
  const navs = new Map<MapId, NavGraph>();
  for (const m of [desertCompound, industrialWarehouse]) navs.set(m.id, mapWorld(m).nav);
  host.load(desertCompound);
  const booted: Booted = {
    host,
    catalog: catalog(),
    navs,
    renderer,
    audio,
    loadedMapId: desertCompound.id,
  };
  if (opts.attach !== false) app.attach(booted);
  let t = 1000;
  const h: AppHarness = {
    app,
    ui,
    input,
    audio,
    renderer,
    host,
    store,
    storage,
    bus,
    reporter,
    reported,
    booted,
    bootCalls,
    frames(n, dtMs = 1000 / 60) {
      for (let i = 0; i < n; i++) {
        t += dtMs;
        app.frame(t);
      }
      return t;
    },
    send: (intent) => {
      app.send(intent);
    },
    goLive() {
      app.signal({ kind: 'boot-ready' });
      h.send({ kind: 'enter' });
      h.send({ kind: 'start-match' });
      h.frames(1);
      h.send({ kind: 'capture-and-start' });
      app.signal({ kind: 'lock-gained' });
      // 180 countdown ticks at 3 ticks per 50 ms frame, plus slack.
      h.frames(62, 50);
    },
    screen: () => app.state().screen,
  };
  return h;
}
