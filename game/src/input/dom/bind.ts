// DOM binder (business-logic-model §5.2, logical component LC-I-5).
import { err, ok, type Result } from '@sz/kernel';
import type { PlayerInputIntent } from '@sz/player';
import {
  DEFAULT_BINDINGS,
  validateBindings,
  type BindingError,
  type KeyBindings,
} from '@sz/input/core/bindings';
import { createInputState } from '@sz/input/core/state';
import { createLockController, type LockErrorEvent, type LockLostEvent } from './lock';
import type { Handler, InputDeps, Listenable } from './ports';

export interface InputEventMap {
  readonly 'lock-gained': null;
  readonly 'lock-lost': LockLostEvent;
  readonly 'lock-error': LockErrorEvent;
  /** true while the scoreboard key is held. */
  readonly scoreboard: boolean;
}

export type InputEventType = keyof InputEventMap;

export interface InputAdapter {
  /** Consumes deltas and edges since the previous poll. */
  poll(): PlayerInputIntent;
  /** Must be called synchronously from a click or native-button activation (BR-P-75). */
  requestLock(): void;
  /** Pause, menus and round end release the lock; the loss arrives as {released}. */
  releaseLock(): void;
  isLocked(): boolean;
  on<K extends InputEventType>(type: K, fn: (payload: InputEventMap[K]) => void): () => void;
  /** false clears all input and ignores presses; it does not release the lock. */
  setEnabled(enabled: boolean): void;
  /** Removes every listener, releases the lock; idempotent (BR-P-81). */
  dispose(): void;
}

interface Registered {
  readonly on: Listenable;
  readonly type: string;
  readonly fn: Handler;
}

/** Fields read from DOM events; everything is checked before use. */
interface EventFields {
  readonly code?: unknown;
  readonly repeat?: unknown;
  readonly ctrlKey?: unknown;
  readonly movementX?: unknown;
  readonly movementY?: unknown;
  readonly button?: unknown;
  readonly deltaY?: unknown;
}

const fields = (ev: Event): EventFields => ev as Event & EventFields;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' ? v : Number.NaN);

/** Codes whose browser default is suppressed while locked (BR-P-79). */
function preventSet(bindings: KeyBindings): ReadonlySet<string> {
  const codes = new Set(['Tab', 'Space', 'F1']);
  for (const code of bindings.keys()) if (code.startsWith('Digit')) codes.add(code);
  return codes;
}

/**
 * Wires keyboard, mouse and pointer lock to the pure reducer. DOM handles are injected
 * so the binder runs against Node EventTarget fakes in tests. Returns err only for an
 * invalid binding table; app-shell then falls back to DEFAULT_BINDINGS.
 */
export function createInput(
  deps: InputDeps,
  bindingPairs: ReadonlyArray<readonly [unknown, unknown]> = DEFAULT_BINDINGS,
): Result<InputAdapter, BindingError> {
  const validated = validateBindings(bindingPairs);
  if (!validated.ok) return err(validated.error);
  const bindings = validated.value;
  const { doc, win, target } = deps;
  const prevent = preventSet(bindings);
  const subscribers = new Map<InputEventType, Set<(p: never) => void>>();
  const registry: Registered[] = [];
  let enabled = false;
  let disposed = false;

  function emit<K extends InputEventType>(type: K, payload: InputEventMap[K]): void {
    for (const fn of [...(subscribers.get(type) ?? [])]) {
      (fn as (p: InputEventMap[K]) => void)(payload);
    }
  }

  const state = createInputState(bindings, (shown) => {
    emit('scoreboard', shown);
  });
  const sync = (): void => {
    state.setActive(enabled && lock.state() === 'locked');
  };
  const lock = createLockController(doc, target, {
    gained: () => {
      state.dropNextMove();
      sync();
      emit('lock-gained', null);
    },
    lost: (e) => {
      state.clear();
      sync();
      emit('lock-lost', e);
    },
    error: (e) => {
      emit('lock-error', e);
    },
  });
  const locked = (): boolean => lock.state() === 'locked';

  function listen(on: Listenable, type: string, fn: Handler, passive?: false): void {
    if (passive === false) on.addEventListener(type, fn, { passive: false });
    else on.addEventListener(type, fn);
    registry.push({ on, type, fn });
  }

  listen(doc, 'keydown', (ev) => {
    const f = fields(ev);
    const code = str(f.code);
    const ctrl = f.ctrlKey === true;
    if (locked() && (prevent.has(code) || (ctrl && (code === 'KeyS' || code === 'KeyD')))) {
      ev.preventDefault();
    }
    state.keyDown(code, f.repeat === true);
  });
  listen(doc, 'keyup', (ev) => {
    state.keyUp(str(fields(ev).code));
  });
  listen(doc, 'mousemove', (ev) => {
    const f = fields(ev);
    state.mouseMove(num(f.movementX), num(f.movementY));
  });
  listen(target, 'mousedown', (ev) => {
    state.mouseDown(num(fields(ev).button));
  });
  listen(target, 'mouseup', (ev) => {
    state.mouseUp(num(fields(ev).button));
  });
  listen(
    target,
    'wheel',
    (ev) => {
      if (locked()) ev.preventDefault();
      state.wheel(num(fields(ev).deltaY));
    },
    false,
  );
  listen(target, 'contextmenu', (ev) => {
    if (locked()) ev.preventDefault();
  });
  // Canvas-click path of story-mouse-look AC1; same handler as "Capture mouse and start".
  listen(target, 'click', () => {
    if (enabled && lock.state() === 'unlocked') lock.request();
  });
  listen(doc, 'pointerlockchange', () => {
    lock.onChange();
  });
  listen(doc, 'pointerlockerror', () => {
    lock.onError();
  });
  listen(win, 'blur', () => {
    state.clear();
  });
  listen(doc, 'visibilitychange', () => {
    if (doc.visibilityState === 'hidden') state.clear();
  });

  const adapter: InputAdapter = {
    poll: () => state.poll(),
    requestLock() {
      lock.request();
    },
    releaseLock() {
      lock.release();
    },
    isLocked: locked,
    on(type, fn) {
      if (disposed) return () => undefined;
      let set = subscribers.get(type);
      if (set === undefined) {
        set = new Set();
        subscribers.set(type, set);
      }
      const entry = fn as (p: never) => void;
      set.add(entry);
      return () => {
        subscribers.get(type)?.delete(entry);
      };
    },
    setEnabled(next) {
      enabled = next && !disposed;
      lock.setEnabled(enabled);
      if (!enabled) state.clear();
      sync();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      enabled = false;
      lock.setEnabled(false);
      lock.dispose();
      for (const r of registry) r.on.removeEventListener(r.type, r.fn);
      registry.length = 0;
      state.clear();
      sync();
      subscribers.clear();
    },
  };
  return ok(adapter);
}
