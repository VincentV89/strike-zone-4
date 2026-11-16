/**
 * Round controller (LC-ML-20, business-logic-model §2). One per page. It owns the round phase
 * machine (R1 to R9), the current Simulation, the round stats and the session totals. app-shell
 * owns the clock and the bus drain and calls tick(intent) once per fixed step.
 */
import {
  createRng,
  err,
  ok,
  type DomainEvent,
  type EventBus,
  type MatchSetup,
  type Result,
  type RoundOutcome,
  type RoundPhase,
} from '@sz/kernel';
import { selectSpawns } from '@sz/maps';
import {
  spawnSeed,
  type LookDelta,
  type PlayerInputIntent,
  type SimSnapshot,
  type Simulation,
} from '@sz/sim';
import {
  ZERO_TOTALS,
  applyOutcome,
  createRoundStats,
  recordEvent,
  summarize,
  type RoundStats,
  type RoundSummary,
  type SessionTotals,
} from '@sz/stats';
import {
  isRoundDuration,
  parseRoundConfig,
  type RoundConfig,
  type RoundDurationSec,
} from './config';
import { evaluateOutcome, shouldRecordAbandon } from './outcome';
import { COUNTDOWN_GATES, COUNTDOWN_TICKS, LIVE_GATES, applyPause, looksAllowed } from './phases';
import { buildView, type RoundView } from './view';

export type StartError =
  'invalid-config' | 'insufficient-spawns' | 'invalid-bot-count' | 'spawn-failed';

export interface AbandonResult {
  /** True only when the round was live (BR-ML-27); roundsLost was then incremented. */
  readonly recordedAbandon: boolean;
  /** Present when an abandon was recorded, so app-shell can write a history entry. */
  readonly summary?: RoundSummary;
}

export interface RestartResult extends AbandonResult {
  readonly start: Result<void, StartError>;
}

export interface RoundDeps {
  /** Shared with the sim. round only emits and clears (BR-ML-04, BR-ML-46). */
  readonly bus: Pick<EventBus<DomainEvent>, 'emit' | 'clear'>;
  /** app-shell factory: reuses the PhysicsWorld and NavGraph when the map is unchanged. */
  readonly buildSimulation: (config: RoundConfig) => Simulation;
  /** Seed for restarts and Play Again (app-shell: crypto.getRandomValues). */
  readonly nextSeed: () => number;
  /** Seeded from persistence by app-shell. */
  readonly totals?: SessionTotals;
}

export interface RoundController {
  start(config: unknown): Result<void, StartError>;
  /** On pointer-lock gain in Ready (R2). The e2e hook calls it when headless lock is refused. */
  beginCountdown(): void;
  /** One fixed step; dt is STEP_SEC by construction (no dt argument, SEC-ML-04). */
  tick(intent: PlayerInputIntent): void;
  /** Once per frame, before the ticks (BR-ML-18). */
  look(delta: LookDelta, sensitivity: number): void;
  setPaused(paused: boolean): void;
  /** Restart from Pause (after confirmation) or Play Again from the end screen. */
  restart(durationSec?: number): RestartResult;
  quitToMenu(): AbandonResult;
  /** A duration change during a round applies at the next start or restart (BR-ML-30). */
  setPendingDuration(durationSec: unknown): void;
  state(): RoundView;
  snapshot(): SimSnapshot | undefined;
  totals(): SessionTotals;
}

interface Mutable {
  phase: RoundPhase;
  paused: boolean;
  started: boolean;
  countdownTicks: number;
  liveTicks: number;
  outcome: RoundOutcome | undefined;
  summary: RoundSummary | undefined;
}

const idle = (): Mutable => ({
  phase: 'loading',
  paused: false,
  started: false,
  countdownTicks: COUNTDOWN_TICKS,
  liveTicks: 0,
  outcome: undefined,
  summary: undefined,
});

const toSeed = (n: number): number => (Number.isFinite(n) ? n >>> 0 : 0);

export function createRound(deps: RoundDeps): RoundController {
  const { bus } = deps;
  let st = idle();
  let sim: Simulation | undefined;
  let config: RoundConfig | undefined;
  let stats: RoundStats = createRoundStats();
  let totals: SessionTotals = deps.totals ?? ZERO_TOTALS;
  let pending: RoundDurationSec | undefined;
  let version = 0;
  let viewMemo: { version: number; view: RoundView } | null = null;

  const changed = (): void => {
    version++;
  };

  function setPhase(to: RoundPhase): void {
    const from = st.phase;
    st.phase = to;
    changed();
    if (from !== to) bus.emit(Object.freeze({ type: 'RoundPhaseChanged', from, to }));
  }

  function summaryFor(outcome: RoundOutcome, setup: MatchSetup, s: Simulation): RoundSummary {
    return summarize(stats, {
      outcome,
      liveTicks: st.liveTicks,
      enemiesRemaining: s.aliveBotCount(),
      setup,
      totals,
    });
  }

  /** Q2: records a loss only when live; never emits RoundEnded (BR-ML-28). */
  function abandon(): AbandonResult {
    if (sim === undefined || config === undefined || !shouldRecordAbandon(st.started, st.phase)) {
      return { recordedAbandon: false };
    }
    totals = applyOutcome(totals, 'abandoned');
    st.outcome = 'abandoned';
    st.summary = summaryFor('abandoned', config.setup, sim);
    changed();
    return { recordedAbandon: true, summary: st.summary };
  }

  function disposeSim(): void {
    sim?.dispose();
    sim = undefined;
  }

  function endRound(
    outcome: Exclude<RoundOutcome, 'abandoned'>,
    s: Simulation,
    c: RoundConfig,
  ): void {
    st.outcome = outcome;
    totals = applyOutcome(totals, outcome);
    st.summary = summaryFor(outcome, c.setup, s);
    setPhase('ended');
    bus.emit(Object.freeze({ type: 'RoundEnded', outcome, durationSec: st.summary.durationSec }));
  }

  function start(raw: unknown): Result<void, StartError> {
    const parsed = parseRoundConfig(raw);
    if (!parsed.ok) return parsed;
    const c = parsed.value;
    disposeSim();
    bus.clear(); // BR-ML-46: nothing from the old round reaches the new one
    st = { ...idle(), phase: st.phase };
    stats = createRoundStats();
    setPhase('loading');
    const s = deps.buildSimulation(c);
    sim = s;
    const plan = selectSpawns(s.map, c.setup.botCount, createRng(spawnSeed(c.seed)), s.spawnSight);
    const spawned = plan.ok ? s.spawn(plan.value) : plan;
    if (!spawned.ok) {
      disposeSim();
      changed();
      return err(spawned.error);
    }
    config = c;
    setPhase('ready');
    return ok(undefined);
  }

  function liveTick(s: Simulation, c: RoundConfig, intent: PlayerInputIntent): void {
    s.step(intent, LIVE_GATES);
    for (const e of s.tickLog()) recordEvent(stats, e); // SD-ML-6: never from the bus
    st.liveTicks += 1;
    changed();
    const outcome = evaluateOutcome({
      aliveBots: s.aliveBotCount(),
      playerAlive: s.playerAlive(),
      liveTicks: st.liveTicks,
      durationSec: c.durationSec,
    });
    if (outcome !== null) endRound(outcome, s, c);
  }

  function countdownTick(s: Simulation, intent: PlayerInputIntent): void {
    s.step(intent, COUNTDOWN_GATES);
    st.countdownTicks -= 1;
    changed();
    if (st.countdownTicks <= 0) {
      st.started = true;
      setPhase('live');
    }
  }

  return {
    start,
    beginCountdown() {
      if (sim === undefined || st.phase !== 'ready' || st.paused) return;
      st.countdownTicks = COUNTDOWN_TICKS;
      setPhase('countdown');
    },
    tick(intent) {
      if (sim === undefined || config === undefined || st.paused) return;
      if (st.phase === 'countdown') countdownTick(sim, intent);
      else if (st.phase === 'live') liveTick(sim, config, intent);
    },
    look(delta, sensitivity) {
      if (sim === undefined || st.paused || !looksAllowed(st.phase)) return;
      sim.applyLook(delta, sensitivity); // sim skips a dead player
    },
    setPaused(p) {
      if (typeof p !== 'boolean') return;
      const next = applyPause(st, p);
      st.paused = next.paused;
      st.countdownTicks = next.countdownTicks;
      changed();
      if (next.phase !== st.phase) setPhase(next.phase);
    },
    restart(durationSec) {
      const r = abandon();
      if (config === undefined) return { ...r, start: err('invalid-config') };
      const d = isRoundDuration(durationSec) ? durationSec : (pending ?? config.durationSec);
      pending = undefined;
      const seed = toSeed(deps.nextSeed());
      return { ...r, start: start({ setup: config.setup, durationSec: d, seed }) };
    },
    quitToMenu() {
      const r = abandon();
      disposeSim();
      bus.clear();
      st = idle();
      changed();
      return r;
    },
    setPendingDuration(d) {
      if (isRoundDuration(d)) pending = d;
    },
    state() {
      if (viewMemo?.version === version) return viewMemo.view;
      const view = buildView({
        ...st,
        durationSec: config?.durationSec ?? 0,
        setup: config?.setup,
        totals,
      });
      viewMemo = { version, view };
      return view;
    },
    snapshot: () => sim?.snapshot(),
    totals: () => totals,
  };
}
