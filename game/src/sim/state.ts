/**
 * The World aggregate's internal state (domain-entities-match-loop "Aggregates"). One per round,
 * built by createSim. The step, spawn, sink and snapshot modules read and write it.
 */
import {
  createBotWorldView,
  createScheduler,
  createSquadBoard,
  type AiScheduler,
  type BotWorldView,
  type SquadBoard,
} from '@sz/ai';
import { createPerceptionSystem, type PerceptionSystem } from '@sz/ai/perception';
import type { MutableActorLookup } from '@sz/combat';
import type { ActorId, DomainEvent, EventBus, MatchSetup } from '@sz/kernel';
import type { MapDefinition } from '@sz/maps';
import { createPathBudget, type NavGraph, type PathBudget } from '@sz/nav';
import type { CharacterSpec } from '@sz/physics';
import { createActorLookup, type BotActor, type PlayerActor } from './actors';
import { createContainment, type BotErrorReporter, type Containment } from './containment';
import { createTickLog, type TickLog } from './events';
import type { SimPhysicsPort } from './ports';

export interface SimulationDeps {
  readonly map: MapDefinition;
  readonly physics: SimPhysicsPort;
  /** DEFAULT_CHARACTER from @sz/physics, injected by app-shell. */
  readonly characterSpec: CharacterSpec;
  /** Built once per map by app-shell and reused across rounds. */
  readonly nav: NavGraph;
  readonly setup: MatchSetup;
  /** uint32 round seed. */
  readonly seed: number;
  /** sim only emits; it never subscribes (BR-ML-04). */
  readonly bus: Pick<EventBus<DomainEvent>, 'emit'>;
  /** Called at most once per bot per round when a bot's AI or weapon tick throws (SD-ML-5). */
  readonly report?: BotErrorReporter;
}

export interface SimState {
  readonly deps: SimulationDeps;
  readonly perception: PerceptionSystem;
  readonly scheduler: AiScheduler;
  readonly budget: PathBudget;
  readonly board: SquadBoard;
  /** The only BotWorldView sim ever passes to @sz/ai (SD-ML-3). */
  readonly world: BotWorldView;
  readonly log: TickLog;
  readonly containment: Containment;
  readonly actors: MutableActorLookup;
  readonly botsById: Map<ActorId, BotActor>;
  bots: BotActor[];
  player: PlayerActor | undefined;
  tick: number;
  spawned: boolean;
  disposed: boolean;
}

const NO_REPORT: BotErrorReporter = () => undefined;

export function createSimState(deps: SimulationDeps): SimState {
  const budget = createPathBudget();
  const board = createSquadBoard();
  const botsById = new Map<ActorId, BotActor>();
  const state: SimState = {
    deps,
    perception: createPerceptionSystem(),
    scheduler: createScheduler(),
    budget,
    board,
    world: createBotWorldView({
      query: deps.physics,
      nav: deps.nav,
      budget,
      map: deps.map,
      board,
    }),
    log: createTickLog(),
    containment: createContainment(deps.report ?? NO_REPORT),
    actors: createActorLookup(() => state.player, botsById),
    botsById,
    bots: [],
    player: undefined,
    tick: 0,
    spawned: false,
    disposed: false,
  };
  return state;
}
