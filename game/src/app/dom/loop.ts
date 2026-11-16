/**
 * Frame loop (business-logic-model "Frame loop", PD-AS-1 to PD-AS-10). One requestAnimationFrame
 * chain; per frame: look once, fixed ticks, one bus drain, HUD (contained), audio listener,
 * render, probe and advisory, then round signals. Two catch sites only: the HUD bulkhead and the
 * outer fatal boundary (SD-AS-11).
 */
import { planFrame, isRunning } from '@sz/app/core/frame';
import { createHoldTimer } from '@sz/app/core/hold';
import { roundSignals } from '@sz/app/core/signals';
import { createAdvisoryRule, createFrameProbe, type FrameStats } from '@sz/diagnostics';
import type { DomainEvent, EventBus, FixedClock, Vec3 } from '@sz/kernel';
import type { Settings } from '@sz/persistence';
import { EMPTY_CARRY, distributeIntent, type PlayerInputIntent } from '@sz/player';
import type { RoundController } from '@sz/round';
import type { SimSnapshot } from '@sz/sim';
import type { AudioPort, InputPort, Report, RendererPort, UiPort } from './ports';

/** 60 s and 10 s probes at 60 FPS (PD-AS-5). */
export const STATS_PROBE_FRAMES = 3600;
export const ADVISORY_PROBE_FRAMES = 600;

export interface FrameDeps {
  readonly round: RoundController;
  readonly input: Pick<InputPort, 'poll'>;
  readonly bus: Pick<EventBus<DomainEvent>, 'drain' | 'emit'>;
  readonly clock: FixedClock;
  readonly ui: UiPort;
  readonly audio: Pick<AudioPort, 'setListener'>;
  readonly renderer: Pick<RendererPort, 'render'>;
  readonly settings: () => Settings;
  readonly contextLost: () => boolean;
  readonly tabHeld: () => boolean;
  readonly report: Report;
  readonly onRoundEnded: (outcome: NonNullable<ReturnType<typeof roundSignals>['ended']>) => void;
  readonly onHoldElapsed: () => void;
}

export interface FrameRunner {
  frame(tMs: number): void;
  /** Round start or restart (BR-AS-32): clock, edge carry, interpolation and hold reset. */
  resetRound(): void;
  startHold(seconds: number): void;
  /** e2e: replaces input.poll() for the next `ticks` fixed steps. */
  inject(intent: PlayerInputIntent, ticks: number): void;
  frameStats(): FrameStats;
  readonly hudFaulted: boolean;
}

export function createFrameRunner(deps: FrameDeps): FrameRunner {
  const { round, ui, bus } = deps;
  const statsProbe = createFrameProbe(STATS_PROBE_FRAMES);
  const advisoryProbe = createFrameProbe(ADVISORY_PROBE_FRAMES);
  const advisory = createAdvisoryRule();
  const hold = createHoldTimer();
  const listener: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };
  let lastMs: number | undefined;
  let carry = EMPTY_CARRY;
  let prev: SimSnapshot | undefined;
  let curr: SimSnapshot | undefined;
  let alpha = 0;
  let hudFaulted = false;
  let holdJustStarted = false;
  let injected: PlayerInputIntent | undefined;
  let injectLeft = 0;

  /** HUD bulkhead (ui-hud human decision): first throw per round reports once and parks the HUD. */
  function hudFrame(events: ReadonlyArray<DomainEvent>, settings: Settings): void {
    if (hudFaulted) return;
    try {
      ui.onEvents(events, curr, settings.graphics);
      ui.updateHud({
        snap: curr,
        view: round.state(),
        radar: ui.radarInput(),
        settings,
        tabHeld: deps.tabHeld(),
      });
    } catch (e) {
      hudFaulted = true;
      deps.report('hud', e);
      ui.showHudFault();
    }
  }

  function tickRound(dtSec: number, settings: Settings): void {
    const polled = deps.input.poll();
    const intent = injectLeft > 0 && injected !== undefined ? injected : polled;
    round.look(intent.look, settings.sensitivity);
    const fs = deps.clock.advance(dtSec);
    const d = distributeIntent(intent, fs.steps, carry);
    const last = d.ticks.length - 1;
    d.ticks.forEach((t, i) => {
      if (i === last) prev = round.snapshot();
      round.tick(t);
    });
    carry = d.carry;
    alpha = fs.alpha;
    injectLeft = Math.max(0, injectLeft - fs.steps);
  }

  function listen(snap: SimSnapshot): void {
    const p: Vec3 = snap.player.pos;
    listener.x = p.x;
    listener.y = p.y + snap.player.eyeHeight;
    listener.z = p.z;
    deps.audio.setListener(listener, snap.player.yaw);
  }

  function sample(frameMs: number, settings: Settings): void {
    statsProbe.sample(frameMs);
    advisoryProbe.sample(frameMs);
    const view = round.state();
    const fps = advisory.evaluate({
      phase: view.phase,
      paused: view.paused,
      preset: settings.graphics,
      medianFps: () => advisoryProbe.medianFps(),
    });
    if (fps === null) return;
    // BR-AS-33: the only event app-shell emits; ui sees it in the next frame's drain.
    bus.emit(
      Object.freeze({
        type: 'PerformanceAdvisory',
        medianFps: fps,
        botCount: view.setup?.botCount ?? 0,
      }),
    );
  }

  return {
    frame(tMs) {
      const plan = planFrame(tMs, lastMs);
      lastMs = tMs;
      const settings = deps.settings();
      const lost = deps.contextLost();
      if (isRunning(round.state(), lost)) tickRound(plan.dtSec, settings);
      const events = bus.drain(); // BR-AS-30: exactly once per frame, after the ticks
      curr = round.snapshot();
      const signals = roundSignals(events);
      if (signals.newRound) {
        advisory.rearm();
        if (hudFaulted) {
          hudFaulted = false;
          ui.resetHud();
        }
      }
      hudFrame(events, settings);
      if (curr !== undefined) listen(curr);
      const view = round.state();
      deps.renderer.render({
        prev,
        curr,
        alpha,
        events,
        dtSec: plan.dtSec,
        paused: view.paused || lost,
      });
      if (plan.sample) sample(plan.frameMs, settings);
      if (signals.ended !== undefined) deps.onRoundEnded(signals.ended);
      if (hold.active && hold.advance(holdJustStarted ? 0 : plan.dtSec)) {
        holdJustStarted = false;
        deps.onHoldElapsed();
      }
      holdJustStarted = false;
    },
    resetRound() {
      deps.clock.reset();
      carry = EMPTY_CARRY;
      prev = undefined;
      curr = undefined;
      alpha = 0;
      hold.reset();
      holdJustStarted = false;
    },
    startHold(seconds) {
      hold.start(seconds);
      holdJustStarted = true;
    },
    inject(intent, ticks) {
      injected = intent;
      injectLeft = ticks;
    },
    frameStats: () => statsProbe.stats(),
    get hudFaulted() {
      return hudFaulted;
    },
  };
}

export interface LoopDeps {
  readonly raf: (cb: (tMs: number) => void) => number;
  readonly caf: (handle: number) => void;
  readonly frame: (tMs: number) => void;
  readonly onFatal: (e: unknown) => void;
}

export interface Loop {
  start(): void;
  stop(): void;
  readonly running: boolean;
}

/** PD-AS-2: one rAF handle; a fatal frame never schedules another one. */
export function createLoop(deps: LoopDeps): Loop {
  let handle: number | undefined;
  let started = false;
  let stopped = false;
  /** Read through a call: deps.frame may stop the loop (fatal) while it runs. */
  const isStopped = (): boolean => stopped;

  function onFrame(tMs: number): void {
    handle = undefined;
    if (stopped) return;
    try {
      deps.frame(tMs);
    } catch (e) {
      stopped = true;
      deps.onFatal(e);
      return;
    }
    if (!isStopped()) handle = deps.raf(onFrame);
  }

  return {
    start() {
      if (started || stopped) return;
      started = true;
      handle = deps.raf(onFrame);
    },
    stop() {
      stopped = true;
      if (handle !== undefined) deps.caf(handle);
      handle = undefined;
    },
    get running() {
      return started && !stopped;
    },
  };
}
