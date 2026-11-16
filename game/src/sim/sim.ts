/**
 * Simulation facade (LC-ML-01, component-methods simulation). One per round. It owns the actors,
 * perception, squad board, scheduler, path budget and tick log, and borrows the shared
 * PhysicsWorld and NavGraph through ports. Domain code here never throws during a tick except
 * for errors that SD-ML-5 deliberately lets propagate (physics, combat, player, sink).
 */
import type { PerceptionStats } from '@sz/ai/perception';
import type { DomainEvent, MatchSetup, Result, Vec3 } from '@sz/kernel';
import type { MapDefinition, SpawnPlan } from '@sz/maps';
import { applyLook, type LookDelta, type PlayerInputIntent } from '@sz/player';
import { createSink } from './sink';
import { buildSnapshot, type SimSnapshot } from './snapshot';
import { spawnActors, type SpawnError } from './spawn';
import { createSimState, type SimulationDeps } from './state';
import { stepSim, type SimGates } from './step';

export interface SimStats {
  readonly tick: number;
  readonly bots: number;
  readonly aliveBots: number;
  readonly reportedBots: number;
  readonly perception: PerceptionStats;
  readonly board: { readonly cover: number; readonly patrol: number };
}

export interface Simulation {
  readonly map: MapDefinition;
  readonly setup: MatchSetup;
  /** World line of sight for spawn selection; round never holds the physics port. */
  readonly spawnSight: (a: Vec3, b: Vec3) => boolean;
  spawn(plan: SpawnPlan): Result<void, SpawnError>;
  step(intent: PlayerInputIntent, gates: SimGates): void;
  applyLook(delta: LookDelta, sensitivity: number): void;
  /** The last tick's events, frozen, in bus order (BR-ML-04). */
  tickLog(): ReadonlyArray<DomainEvent>;
  /** Memoised per tick; undefined before spawn. After dispose, the last value. */
  snapshot(): SimSnapshot | undefined;
  aliveBotCount(): number;
  playerAlive(): boolean;
  stats(): SimStats;
  dispose(): void;
  readonly disposed: boolean;
}

export function createSim(deps: SimulationDeps): Simulation {
  const s = createSimState(deps);
  const sink = createSink(s);
  let memo: { tick: number; snap: SimSnapshot | undefined } | null = null;
  const { physics } = deps;

  function snapshot(): SimSnapshot | undefined {
    if (s.disposed) return memo?.snap;
    if (memo !== null && memo.tick === s.tick) return memo.snap;
    const snap = buildSnapshot(s);
    memo = { tick: s.tick, snap };
    return snap;
  }

  return {
    map: deps.map,
    setup: deps.setup,
    spawnSight: (a, b) => physics.lineOfSight(a, b),
    spawn(plan) {
      const r = spawnActors(s, plan);
      memo = null;
      return r;
    },
    step(intent, gates) {
      if (!s.spawned || s.disposed) return;
      stepSim(s, intent, gates, sink);
      memo = null;
    },
    applyLook(delta, sensitivity) {
      const p = s.player;
      if (s.disposed || !p?.alive) return;
      applyLook(p.motion, delta, sensitivity);
      memo = null;
    },
    tickLog: () => s.log.events(),
    snapshot,
    aliveBotCount: () => s.bots.filter((b) => b.alive).length,
    playerAlive: () => s.player?.alive === true,
    stats: () => ({
      tick: s.tick,
      bots: s.bots.length,
      aliveBots: s.bots.filter((b) => b.alive).length,
      reportedBots: s.containment.reportedCount,
      perception: s.perception.stats(),
      board: s.board.size(),
    }),
    dispose() {
      if (s.disposed) return;
      snapshot(); // keep the last frame renderable behind the end screen
      physics.removeAllCharacters();
      deps.nav.clearReservations();
      s.perception.reset();
      s.board.clear();
      s.bots = [];
      s.botsById.clear();
      s.player = undefined;
      s.log.clear();
      s.disposed = true;
    },
    get disposed() {
      return s.disposed;
    },
  };
}
