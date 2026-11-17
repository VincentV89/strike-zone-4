// Narrow structural ports for the injected DOM (SD-P-3). app-shell passes the real
// document, window and canvas, which are assignable; anything not declared here is a
// type error in src/input/**, so the binder cannot reach fetch, createElement or storage.

export type Handler = (ev: Event) => void;

export interface Listenable {
  addEventListener(type: string, fn: Handler, opts?: AddEventListenerOptions): void;
  removeEventListener(type: string, fn: Handler, opts?: EventListenerOptions): void;
}

export interface LockDocument extends Listenable {
  readonly pointerLockElement: unknown;
  readonly visibilityState: string;
  exitPointerLock?: () => void;
}

export interface LockTarget extends Listenable {
  requestPointerLock?: () => unknown;
}

export interface InputDeps {
  readonly doc: LockDocument;
  readonly win: Listenable;
  readonly target: LockTarget;
}
