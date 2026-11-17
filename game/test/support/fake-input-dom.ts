// DOM fakes for the input binder (ADR-PM-4). Built on Node's global EventTarget and Event;
// Node 24 has no KeyboardEvent or MouseEvent, so event fields are assigned onto an Event.

type Listener = Parameters<EventTarget['addEventListener']>[1];
type AddOpts = Parameters<EventTarget['addEventListener']>[2];
type RemoveOpts = Parameters<EventTarget['removeEventListener']>[2];

const captureOf = (opts: AddOpts | RemoveOpts): boolean =>
  typeof opts === 'boolean' ? opts : opts?.capture === true;

/** EventTarget that counts live listeners per (type, capture). */
export class CountingTarget extends EventTarget {
  readonly live = new Map<string, number>();
  adds = 0;
  removes = 0;
  readonly passive = new Map<string, boolean>();

  override addEventListener(type: string, fn: Listener, opts?: AddOpts): void {
    const key = `${type}|${String(captureOf(opts))}`;
    this.live.set(key, (this.live.get(key) ?? 0) + 1);
    this.adds++;
    if (typeof opts === 'object') this.passive.set(type, opts.passive !== false);
    super.addEventListener(type, fn, opts);
  }

  override removeEventListener(type: string, fn: Listener, opts?: RemoveOpts): void {
    const key = `${type}|${String(captureOf(opts))}`;
    this.live.set(key, (this.live.get(key) ?? 0) - 1);
    this.removes++;
    super.removeEventListener(type, fn, opts);
  }

  /** Sum of live listeners over every (type, capture). */
  liveCount(): number {
    let n = 0;
    for (const v of this.live.values()) n += v;
    return n;
  }
}

export class FakeDocument extends CountingTarget {
  pointerLockElement: unknown = null;
  visibilityState = 'visible';
  exitCalls = 0;
  /** When true, exitPointerLock clears the lock and fires pointerlockchange synchronously. */
  autoExit = true;

  exitPointerLock = (): void => {
    this.exitCalls++;
    if (!this.autoExit) return;
    this.pointerLockElement = null;
    this.dispatchEvent(new Event('pointerlockchange'));
  };

  /** Simulates the browser granting or dropping the lock. */
  setLock(el: unknown): void {
    this.pointerLockElement = el;
    this.dispatchEvent(new Event('pointerlockchange'));
  }
}

export type LockMode =
  'grant' | 'pending' | 'reject' | 'reject-and-error' | 'throw' | 'error-event' | 'undefined';

export class FakeCanvas extends CountingTarget {
  requestCalls = 0;
  mode: LockMode = 'grant';
  requestPointerLock?: () => unknown;

  constructor(readonly doc: FakeDocument) {
    super();
    this.requestPointerLock = (): unknown => {
      this.requestCalls++;
      switch (this.mode) {
        case 'grant':
          this.doc.setLock(this);
          return Promise.resolve();
        case 'pending':
          return new Promise(() => undefined);
        case 'reject':
          return Promise.reject(new Error('NotAllowedError'));
        case 'reject-and-error':
          this.doc.dispatchEvent(new Event('pointerlockerror'));
          return Promise.reject(new Error('NotAllowedError'));
        case 'throw':
          throw new Error('SecurityError');
        case 'error-event':
          this.doc.dispatchEvent(new Event('pointerlockerror'));
          return undefined;
        case 'undefined':
          return undefined;
      }
    };
  }
}

export interface FakeDom {
  readonly doc: FakeDocument;
  readonly win: CountingTarget;
  readonly target: FakeCanvas;
}

export function createFakeDom(): FakeDom {
  const doc = new FakeDocument();
  return { doc, win: new CountingTarget(), target: new FakeCanvas(doc) };
}

export interface FakeEventFields {
  readonly code?: string;
  readonly repeat?: boolean;
  readonly ctrlKey?: boolean;
  readonly movementX?: number;
  readonly movementY?: number;
  readonly button?: number;
  readonly deltaY?: number;
}

/** A cancelable Event carrying the given DOM event fields. */
export function fakeEvent(type: string, fields: FakeEventFields = {}): Event {
  return Object.assign(new Event(type, { cancelable: true }), fields);
}

export const flush = (): Promise<void> => new Promise((r) => setImmediate(r));
