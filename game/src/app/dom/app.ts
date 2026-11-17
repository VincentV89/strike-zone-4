/**
 * AppService (business-logic-model "Screen state machine", "Match preparation", "Settings
 * fan-out", "Abandon rules", FD-AS-2, FD-AS-3). Owns the machine state and runs its commands
 * synchronously against the units, so pointer-lock requests stay in the user activation.
 */
import type { BootPlan } from '@sz/app/core/boot-plan';
import { loadSteps } from '@sz/app/core/boot-plan';
import { holdFor } from '@sz/app/core/hold';
import {
  INITIAL_STATE,
  dispatch,
  type AppState,
  type Command,
  type Signal,
  type SystemSignal,
} from '@sz/app/core/machine';
import { toScreenModel, type ScreenData } from '@sz/app/core/screen-model';
import { bindAudioToEvents } from '@sz/audio';
import type { FrameStats, InjectedIntent } from '@sz/diagnostics';
import {
  PLAYER_ID,
  err,
  ok,
  type DomainEvent,
  type EventBus,
  type FixedClock,
  type MapId,
  type MatchSetup,
  type Result,
} from '@sz/kernel';
import { collidersToRadarSegments, type MapDefinition } from '@sz/maps';
import { DEFAULT_SETTINGS, type Settings, type Store } from '@sz/persistence';
import { DEFAULT_CHARACTER } from '@sz/physics';
import { createRound, type AbandonResult, type RoundController, type RoundView } from '@sz/round';
import { createSim, type Simulation } from '@sz/sim';
import { addSat } from '@sz/stats';
import {
  applySettingChange,
  applySetupChange,
  type CapabilityVerdict,
  type LoadStep,
  type UiIntent,
} from '@sz/ui';
import { createFrameRunner, type FrameRunner } from './loop';
import type { Booted, InputPort, Report, UiPort } from './ports';

export interface AppDeps {
  readonly ui: UiPort;
  readonly input: InputPort;
  readonly store: Store;
  readonly bus: EventBus<DomainEvent>;
  readonly clock: FixedClock;
  readonly report: Report;
  readonly nextSeed: () => number;
  readonly reducedMotion: () => boolean;
  readonly formatDate: (epochMs: number) => string;
  readonly version: string;
  readonly tabHeld: () => boolean;
  /** Boot control (late-bound by start.ts). */
  readonly startBoot: () => void;
  readonly retryBoot: () => void;
  /** Stops the rAF loop (FD-AS-3). */
  readonly stopLoop: () => void;
}

export interface App {
  /** ui's SendIntent. Every activation also unlocks audio (BR-AS-13). */
  send(intent: UiIntent): void;
  signal(sig: SystemSignal): void;
  /** Boot finished: wire the round and apply stored settings once. */
  attach(booted: Booted): void;
  setBootPlan(plan: BootPlan): void;
  setVerdict(v: CapabilityVerdict): void;
  /** Per frame: deferred match start, then the frame runner. */
  frame(tMs: number): void;
  fatal(e: unknown): void;
  /** Canvas click: same as the capture button, only on the capture prompt. */
  canvasClick(): void;
  e2eStart(setup: MatchSetup, seed: number): Result<void, string>;
  inject(intent: InjectedIntent, ticks: number): void;
  state(): AppState;
  round(): RoundController | undefined;
  frameStats(): FrameStats | undefined;
  ignoredIntents(): number;
}

interface Attached {
  readonly booted: Booted;
  readonly round: RoundController;
  readonly runner: FrameRunner;
}

const IDLE_VIEW = (record: RoundView['totals']): RoundView =>
  Object.freeze({
    phase: 'loading',
    paused: false,
    started: false,
    timeLeftSec: 0,
    durationSec: 0,
    totals: record,
  });

const PASS_VERDICT: CapabilityVerdict = Object.freeze({
  webgl2: true,
  pointer: true,
  widthOk: true,
});

export function createApp(deps: AppDeps): App {
  const { ui, input, store } = deps;
  let state: AppState = INITIAL_STATE;
  let world: Attached | undefined;
  let steps: ReadonlyArray<LoadStep> = [];
  let pct = 0;
  let verdict = PASS_VERDICT;
  let ignored = 0;
  let roundIndex = 0;
  let loadedMapId: MapId | undefined;
  let pendingStart = false;
  let fatalDone = false;
  const queue: Signal[] = [];
  let draining = false;

  const view = (): RoundView => world?.round.state() ?? IDLE_VIEW(store.record());

  function screenData(): ScreenData {
    const effects = ui.effects();
    return {
      steps,
      pct,
      verdict,
      settings: store.settings(),
      setup: store.lastSetup(),
      maps: world?.booted.catalog.listMaps() ?? [],
      storage: store.status(),
      view: view(),
      roundIndex: Math.max(1, roundIndex),
      aliveBots: world?.round.snapshot()?.aliveBots ?? 0,
      record: world?.round.totals() ?? store.record(),
      advisory: effects.advisory,
      history: store.history(),
      formatDate: deps.formatDate,
      version: deps.version,
      killedBy: effects.lastKilledBy,
    };
  }

  const render = (): void => {
    ui.showScreen(toScreenModel(state, screenData()));
  };

  function applyToUnits(s: Settings): void {
    if (world === undefined) return;
    const { renderer, audio } = world.booted;
    renderer.applySettings({
      preset: s.graphics,
      fovDeg: s.fovDeg,
      reducedMotion: deps.reducedMotion(),
    });
    audio.setVolumes(s.masterVolume / 100, s.effectsVolume / 100);
    world.round.setPendingDuration(s.roundDurationSec);
  }

  function applySettings(next: Settings): void {
    if (next === store.settings()) return;
    store.saveSettings(next);
    applyToUnits(store.settings());
  }

  function recordAbandon(r: AbandonResult): void {
    if (r.recordedAbandon && r.summary) store.recordRound(r.summary);
  }

  function ensureMap(w: Attached, map: MapDefinition): void {
    if (loadedMapId === map.id) return;
    w.booted.host.load(map);
    w.booted.renderer.loadMap(map);
    ui.setRadarOutline(collidersToRadarSegments(map));
    loadedMapId = map.id;
  }

  function roundStarted(w: Attached): void {
    roundIndex++;
    w.booted.renderer.beginRound();
  }

  /** Match preparation: switch map if needed, reset timing, start with a fresh seed. */
  function prepareAndStart(w: Attached, setup: MatchSetup, seed: number): Result<void, string> {
    const { catalog } = w.booted;
    const first = catalog.listMaps()[0];
    const map = catalog.getMap(setup.mapId) ?? (first ? catalog.getMap(first.id) : undefined);
    if (map === undefined) return err('no-map');
    ensureMap(w, map);
    w.runner.resetRound();
    const res = w.round.start({
      setup: { ...setup, mapId: map.id },
      durationSec: store.settings().roundDurationSec,
      seed,
    });
    if (res.ok) roundStarted(w);
    return res;
  }

  function afterRestart(w: Attached, r: ReturnType<RoundController['restart']>): void {
    recordAbandon(r);
    w.booted.audio.duck(false);
    w.runner.resetRound();
    if (r.start.ok) roundStarted(w);
    queue.push({ kind: r.start.ok ? 'round-started' : 'round-start-failed' });
  }

  function runRound(w: Attached, cmd: Command): void {
    const { round, runner, booted } = w;
    switch (cmd.kind) {
      case 'begin-countdown':
        round.beginCountdown();
        return;
      case 'pause':
        round.setPaused(cmd.paused);
        booted.audio.duck(cmd.paused);
        if (cmd.paused) input.setEnabled(false);
        return;
      case 'restart':
      case 'play-again':
        afterRestart(w, round.restart());
        return;
      case 'quit':
        recordAbandon(round.quitToMenu());
        booted.audio.duck(false);
        input.setEnabled(false);
        runner.resetRound();
        return;
      case 'record-round': {
        const summary = round.state().summary;
        if (summary) store.recordRound(summary);
        return;
      }
      case 'start-hold':
        runner.startHold(holdFor(cmd.outcome, deps.reducedMotion()));
        return;
      case 'play-click':
        booted.audio.play('ui-click');
        return;
      default:
        return;
    }
  }

  function run(cmd: Command): void {
    switch (cmd.kind) {
      case 'render':
        render();
        return;
      case 'apply-setup': {
        const cur = store.lastSetup();
        const next = applySetupChange(cur, cmd.field, cmd.raw);
        if (next !== cur) store.saveLastSetup(next);
        return;
      }
      case 'apply-setting':
        applySettings(applySettingChange(store.settings(), cmd.key, cmd.raw));
        return;
      case 'reset-settings':
        applySettings(DEFAULT_SETTINGS);
        return;
      case 'clear-history':
        store.clearHistory();
        return;
      case 'start-match':
        pendingStart = true; // runs at the top of the next frame, after map-loading paints
        return;
      case 'request-lock':
        // The adapter ignores lock requests while disabled (SEC-P-06), and the machine enables
        // play input only on lock-gained. Enabling first is safe: held input stays inactive
        // until the lock is actually granted (bind.ts sync: enabled && locked).
        input.setEnabled(true);
        input.requestLock();
        return;
      case 'release-lock':
        input.releaseLock();
        return;
      case 'set-input':
        input.setEnabled(cmd.enabled);
        return;
      case 'retry-boot':
        deps.retryBoot();
        return;
      case 'continue-boot':
        deps.startBoot();
        return;
      case 'announce':
        ui.announce(cmd.text);
        return;
      default:
        if (world !== undefined) runRound(world, cmd);
    }
  }

  /** Re-entrant safe: signals raised while commands run are queued and handled in order. */
  function process(sig: Signal): void {
    queue.push(sig);
    if (draining) return;
    draining = true;
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      const step = dispatch(state, next, { view: view() });
      state = step.state;
      if (step.ignored) ignored = addSat(ignored, 1); // SD-AS-8: counted, never logged
      for (const c of step.commands) run(c);
    }
    draining = false;
  }

  function startPending(w: Attached): void {
    pendingStart = false;
    const res = prepareAndStart(w, store.lastSetup(), deps.nextSeed());
    process({ kind: res.ok ? 'round-started' : 'round-start-failed' });
  }

  function buildRound(b: Booted): RoundController {
    const report = deps.report;
    return createRound({
      bus: deps.bus,
      nextSeed: deps.nextSeed,
      totals: store.record(),
      buildSimulation(config): Simulation {
        const map = b.catalog.getMap(config.setup.mapId);
        const physics = b.host.current();
        const nav = b.navs.get(config.setup.mapId);
        if (!map || !physics || !nav) throw new Error(`map ${config.setup.mapId} is not loaded`);
        return createSim({
          map,
          physics,
          characterSpec: DEFAULT_CHARACTER,
          nav,
          setup: config.setup,
          seed: config.seed,
          bus: deps.bus,
          report: (bot, e) => {
            report('bot', `${bot}: ${String(e)}`);
          },
        });
      },
    });
  }

  const app: App = {
    send(intent) {
      if (world !== undefined) void world.booted.audio.unlock();
      process(intent);
    },
    signal: process,
    attach(b) {
      if (world !== undefined) return;
      const round = buildRound(b);
      const runner = createFrameRunner({
        round,
        input,
        bus: deps.bus,
        clock: deps.clock,
        ui,
        audio: b.audio,
        renderer: b.renderer,
        settings: () => store.settings(),
        contextLost: () => state.contextLost,
        tabHeld: deps.tabHeld,
        report: deps.report,
        onRoundEnded: (outcome) => {
          process({ kind: 'round-ended', outcome });
        },
        onHoldElapsed: () => {
          process({ kind: 'hold-elapsed' });
        },
      });
      world = { booted: b, round, runner };
      loadedMapId = b.loadedMapId;
      const map = b.catalog.getMap(b.loadedMapId);
      if (map) ui.setRadarOutline(collidersToRadarSegments(map));
      bindAudioToEvents(deps.bus, b.audio, PLAYER_ID);
      applyToUnits(store.settings());
    },
    setBootPlan(plan) {
      steps = loadSteps(plan);
      pct = plan.maxPct;
      if (state.screen === 'loading') render();
    },
    setVerdict(v) {
      verdict = Object.freeze({ webgl2: v.webgl2, pointer: v.pointer, widthOk: v.widthOk });
    },
    frame(tMs) {
      if (fatalDone || world === undefined) return;
      if (pendingStart) startPending(world);
      world.runner.frame(tMs);
    },
    fatal(e) {
      if (fatalDone) return; // SEC-AS-34: idempotent
      fatalDone = true;
      deps.report('fatal', e);
      deps.stopLoop();
      input.releaseLock();
      store.flush();
      queue.length = 0;
      draining = false;
      state = dispatch(state, { kind: 'fatal' }, { view: view() }).state;
      render();
    },
    canvasClick() {
      if (state.screen === 'capture') app.send({ kind: 'capture-and-start' });
    },
    e2eStart(setup, seed) {
      if (world === undefined) return err('not-ready');
      if (fatalDone) return err('fatal');
      pendingStart = false;
      const res = prepareAndStart(world, setup, seed);
      if (!res.ok) return res;
      world.round.beginCountdown();
      process({ kind: 'e2e-started' });
      return ok(undefined);
    },
    inject(intent, ticks) {
      world?.runner.inject(intent, ticks);
    },
    state: () => state,
    round: () => world?.round,
    frameStats: () => world?.runner.frameStats(),
    ignoredIntents: () => ignored,
  };
  return app;
}
