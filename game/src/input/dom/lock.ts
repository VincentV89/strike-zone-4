// Pointer-lock state machine (SD-P-5, security-design layer L-D).
import type { LockDocument, LockTarget } from './ports';

export type LockState = 'unlocked' | 'requesting' | 'locked';

export interface LockLostEvent {
  /** 'released': the game called releaseLock(). 'external': Esc, alt-tab or the browser. */
  readonly reason: 'released' | 'external';
}

export interface LockErrorEvent {
  readonly reason: 'denied' | 'unsupported';
}

export interface LockCallbacks {
  readonly gained: () => void;
  readonly lost: (e: LockLostEvent) => void;
  readonly error: (e: LockErrorEvent) => void;
}

export interface LockController {
  readonly state: () => LockState;
  /** Call only synchronously from a click or native-button activation (BR-P-75). */
  request(): void;
  release(): void;
  /** pointerlockchange handler. */
  onChange(): void;
  /** pointerlockerror handler. */
  onError(): void;
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

export function createLockController(
  doc: LockDocument,
  target: LockTarget,
  cb: LockCallbacks,
): LockController {
  let state: LockState = 'unlocked';
  let enabled = false;
  let releasing = false;
  let disposed = false;

  // One failure path for a synchronous throw, a rejected promise and pointerlockerror:
  // Chromium reports a refusal twice, so only the first report while requesting counts.
  const denied = (): void => {
    if (disposed || state !== 'requesting') return;
    state = 'unlocked';
    cb.error({ reason: 'denied' });
  };

  const exit = (): void => {
    const fn = doc.exitPointerLock;
    if (typeof fn !== 'function') return;
    try {
      fn.call(doc);
    } catch {
      releasing = false;
    }
  };

  return {
    state: () => state,
    request() {
      if (disposed || !enabled || state !== 'unlocked') return;
      const req = target.requestPointerLock;
      if (typeof req !== 'function') {
        cb.error({ reason: 'unsupported' });
        return;
      }
      state = 'requesting';
      let result: unknown;
      try {
        result = req.call(target);
      } catch {
        denied();
        return;
      }
      // Adopts a promise, a thenable or undefined; a rejection handler is always attached.
      void Promise.resolve(result).catch(denied);
    },
    release() {
      if (disposed || state !== 'locked') return;
      releasing = true;
      exit();
    },
    onChange() {
      if (disposed) return;
      if (doc.pointerLockElement === target) {
        if (state === 'locked') return;
        state = 'locked';
        releasing = false;
        cb.gained();
        return;
      }
      if (state !== 'locked') return;
      state = 'unlocked';
      const reason = releasing ? 'released' : 'external';
      releasing = false;
      cb.lost({ reason });
    },
    onError() {
      denied();
    },
    setEnabled(next) {
      enabled = next;
    },
    dispose() {
      if (disposed) return;
      const held = state === 'locked' || doc.pointerLockElement === target;
      disposed = true; // set first: the exit's pointerlockchange must not emit lock-lost
      state = 'unlocked';
      if (held) exit();
    },
  };
}
