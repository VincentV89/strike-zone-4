/**
 * Boot (BootService, business-logic-model "Boot workflow" and "Boot steps"). The runner executes
 * the pure boot plan step by step; a rejected step becomes a value (BR-AS-03), is logged once with
 * console.warn (BR-AS-04) and waits for Retry, which reruns only that step (BR-AS-02).
 */
import {
  createBootPlan,
  isComplete,
  markDone,
  markFailed,
  markRunning,
  markSubDone,
  nextStep,
  retryPlan,
  type BootPlan,
  type BootStepId,
} from '@sz/app/core/boot-plan';
import { createAssetFactory, type AssetFactory } from '@sz/assets';
import { createAudio, type AudioAdapter } from '@sz/audio';
import type { MapId } from '@sz/kernel';
import {
  createMapCatalog,
  desertCompound,
  industrialWarehouse,
  type MapCatalog,
  type MapDefinition,
} from '@sz/maps';
import { buildNavGraph, type NavGraph } from '@sz/nav';
import { BootError, createPhysicsHost, initPhysics, type PhysicsHost } from '@sz/physics';
import { createRenderer, type RenderCanvas, type Renderer } from '@sz/render';
import type { Booted } from './ports';

/** Runs one boot step; `onSub` reports each finished sub-step (Graphics). */
export type StepRunner = (id: BootStepId, onSub: () => void) => Promise<void>;

export interface BootFailure {
  readonly label: string;
  readonly retryable: boolean;
  readonly cause: unknown;
}

export interface BootRunnerDeps {
  readonly run: StepRunner;
  readonly onPlan: (plan: BootPlan) => void;
  readonly onReady: () => void;
  readonly onFailed: (failure: BootFailure) => void;
  /** console.warn in the game (BR-AS-04). */
  readonly warn: (message: string, label: string) => void;
}

export interface BootRunner {
  /** Runs every pending step in order. Never rejects. */
  start(): Promise<void>;
  /** Resets the failed step and continues (retry-step). */
  retry(): Promise<void>;
  plan(): BootPlan;
}

/** BR-AS-03: an error that carries `retryable: false` is final; any other shape is retryable. */
export function isRetryable(e: unknown): boolean {
  if (typeof e !== 'object' || e === null || !('retryable' in e)) return true;
  return e.retryable !== false;
}

/** PresentationBootFailure('webgl') maps to SCR-E1, not SCR-E2. */
export function isWebglFailure(e: unknown): boolean {
  return typeof e === 'object' && e !== null && 'step' in e && e.step === 'webgl';
}

export function createBootRunner(deps: BootRunnerDeps): BootRunner {
  let plan = createBootPlan();
  let running = false;

  const set = (p: BootPlan): void => {
    plan = p;
    deps.onPlan(plan);
  };

  async function runAll(): Promise<void> {
    if (running) return;
    running = true;
    for (let step = nextStep(plan); step !== undefined; step = nextStep(plan)) {
      const id = step.id;
      set(markRunning(plan, id));
      try {
        await deps.run(id, () => {
          set(markSubDone(plan, id));
        });
      } catch (e) {
        set(markFailed(plan, id));
        running = false;
        deps.warn('[strikezone] boot step failed', step.label);
        deps.onFailed({ label: step.label, retryable: isRetryable(e), cause: e });
        return;
      }
      set(markDone(plan, id));
    }
    running = false;
    if (isComplete(plan)) deps.onReady();
  }

  return {
    start: runAll,
    retry() {
      if (running) return Promise.resolve();
      plan = retryPlan(plan);
      return runAll();
    },
    plan: () => plan,
  };
}

export interface BootEnv {
  readonly canvas: RenderCanvas;
  readonly devicePixelRatio: () => number;
  /** The next animation frame, so the loading screen repaints between sub-steps. */
  readonly nextFrame: () => Promise<void>;
  /** Last-used map id from persistence; it is loaded last so the live world matches it. */
  readonly lastMapId: () => MapId;
  readonly onContextLost: () => void;
  readonly onContextRestored: () => void;
}

export interface BootSteps {
  readonly run: StepRunner;
  /** Defined once every step has finished. */
  result(): Booted | undefined;
}

/** Maps in boot order with the last-used map last (FD-AS-6). */
export function bootOrder(
  maps: ReadonlyArray<MapDefinition>,
  lastId: MapId,
): ReadonlyArray<MapDefinition> {
  const last = maps.find((m) => m.id === lastId);
  return last ? [...maps.filter((m) => m !== last), last] : maps;
}

export function createBootSteps(env: BootEnv): BootSteps {
  let host: PhysicsHost | undefined;
  let assets: AssetFactory | undefined;
  let renderer: Renderer | undefined;
  let audio: AudioAdapter | undefined;
  let catalog: MapCatalog | undefined;
  let navs: Map<MapId, NavGraph> | undefined;
  let loadedMapId: MapId | undefined;

  async function physics(): Promise<void> {
    await initPhysics();
    host ??= createPhysicsHost();
  }

  async function graphics(onSub: () => void): Promise<void> {
    assets ??= createAssetFactory({ yieldToHost: env.nextFrame });
    renderer ??= createRenderer({
      canvas: env.canvas,
      assets,
      devicePixelRatio: env.devicePixelRatio,
      onContextLost: env.onContextLost,
      onContextRestored: env.onContextRestored,
    });
    for (const step of assets.loadSteps()) {
      if (assets.status(step.id) === 'done') continue;
      await step.run();
      onSub();
    }
  }

  async function sound(): Promise<void> {
    audio ??= createAudio();
    await audio.prepareBank();
  }

  function maps(): Promise<void> {
    if (host === undefined || renderer === undefined) {
      return Promise.reject(new BootError('maps', 'physics or graphics missing', true));
    }
    const made = createMapCatalog([desertCompound, industrialWarehouse]);
    if (!made.ok) return Promise.reject(new BootError('maps', made.error, false));
    const built = new Map<MapId, NavGraph>();
    const defs = made.value.listMaps().flatMap((s) => made.value.getMap(s.id) ?? []);
    const order = bootOrder(defs, env.lastMapId());
    for (const map of order) {
      host.load(map);
      const nav = buildNavGraph(map, host.query);
      if (!nav.ok) return Promise.reject(new BootError('maps', nav.error, false));
      built.set(map.id, nav.value);
    }
    const last = order[order.length - 1];
    if (last === undefined) return Promise.reject(new BootError('maps', 'no maps', false));
    renderer.loadMap(last);
    catalog = made.value;
    navs = built;
    loadedMapId = last.id;
    return Promise.resolve();
  }

  const run: StepRunner = (id, onSub) => {
    switch (id) {
      case 'physics':
        return physics();
      case 'graphics':
        return graphics(onSub);
      case 'sound':
        return sound();
      case 'maps':
        return maps();
    }
  };

  return {
    run,
    result() {
      if (!host || !renderer || !audio || !catalog || !navs || loadedMapId === undefined) {
        return undefined;
      }
      return { host, catalog, navs, renderer, audio, loadedMapId };
    },
  };
}
