/**
 * Rapier loader (BR-WM-50, SD-WM-10). The only module that imports Rapier at runtime, through
 * a dynamic import so Vite emits it as its own chunk. init() is called with no arguments, so
 * the inlined WASM bytes are used and nothing is fetched.
 */
import type * as RapierModule from '@dimforge/rapier3d-compat';
import { BootError } from './types';

export type Rapier = typeof RapierModule;

export type RapierLoader = () => Promise<Rapier>;

const loadRapier: RapierLoader = async () => {
  const mod = await import('@dimforge/rapier3d-compat');
  await mod.init();
  return mod;
};

export interface PhysicsInitializer {
  init(): Promise<void>;
  /** The initialised module, or undefined before init has resolved. */
  get(): Rapier | undefined;
}

/** Shared-promise initialiser; a failed attempt clears the promise so Retry tries again. */
export function createPhysicsInitializer(loader: RapierLoader): PhysicsInitializer {
  let pending: Promise<void> | null = null;
  let ready: Rapier | undefined;
  return {
    init() {
      pending ??= loader().then(
        (mod) => {
          ready = mod;
        },
        (cause: unknown) => {
          pending = null;
          throw new BootError('physics', cause, true);
        },
      );
      return pending;
    },
    get: () => ready,
  };
}

const shared = createPhysicsInitializer(loadRapier);

/** Boot step `physics`: initialise Rapier once; concurrent calls share one promise. */
export function initPhysics(): Promise<void> {
  return shared.init();
}

export function rapierOrUndefined(): Rapier | undefined {
  return shared.get();
}
