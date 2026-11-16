/**
 * WebGL context-loss state machine (LC-R-9, RD-R-3) as a pure transition table, so Vitest covers
 * it without a GPU. A generation counter discards a rebuild interrupted by a second loss.
 */
export type ContextState = 'live' | 'lost' | 'restoring' | 'disposed';

export type ContextEvent =
  | { readonly type: 'lost' }
  | { readonly type: 'restored' }
  | { readonly type: 'restore-done'; readonly generation: number }
  | { readonly type: 'dispose' };

export interface ContextMachine {
  readonly state: ContextState;
  readonly generation: number;
}

export interface ContextStep {
  readonly next: ContextMachine;
  /** Call event.preventDefault() so the browser may restore the context. */
  readonly preventDefault: boolean;
  readonly notifyLost: boolean;
  /** Start a rebuild tagged with next.generation. */
  readonly startRestore: boolean;
  readonly notifyRestored: boolean;
}

export const INITIAL_CONTEXT: ContextMachine = Object.freeze({ state: 'live', generation: 0 });

const step = (
  next: ContextMachine,
  flags: Partial<Omit<ContextStep, 'next'>> = {},
): ContextStep => ({
  next,
  preventDefault: flags.preventDefault ?? false,
  notifyLost: flags.notifyLost ?? false,
  startRestore: flags.startRestore ?? false,
  notifyRestored: flags.notifyRestored ?? false,
});

export function contextTransition(m: ContextMachine, e: ContextEvent): ContextStep {
  if (m.state === 'disposed') return step(m);
  if (e.type === 'dispose') return step({ state: 'disposed', generation: m.generation });
  switch (m.state) {
    case 'live':
      return e.type === 'lost'
        ? step(
            { state: 'lost', generation: m.generation },
            { preventDefault: true, notifyLost: true },
          )
        : step(m);
    case 'lost':
      if (e.type === 'lost') return step(m, { preventDefault: true });
      if (e.type === 'restored') {
        return step({ state: 'restoring', generation: m.generation + 1 }, { startRestore: true });
      }
      return step(m);
    case 'restoring':
      if (e.type === 'lost') {
        return step({ state: 'lost', generation: m.generation }, { preventDefault: true });
      }
      if (e.type === 'restore-done' && e.generation === m.generation) {
        return step({ state: 'live', generation: m.generation }, { notifyRestored: true });
      }
      return step(m);
  }
}

export function canRender(m: ContextMachine): boolean {
  return m.state === 'live';
}
