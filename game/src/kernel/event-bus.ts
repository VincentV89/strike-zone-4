import type { EventBus, Unsubscribe } from './types';

export type SubscriberErrorHandler = (err: unknown, type: string) => void;

export interface EventBusOptions {
  /**
   * Called once per subscription on its first throw, with the error and the event
   * type only, never the payload (SEC-K-09). Defaults to console.error, which the
   * Playwright console check fails on by design (BR-K-24, req-no-console-errors).
   */
  readonly onSubscriberError?: SubscriberErrorHandler;
}

interface Subscription<E> {
  readonly filter: string | null; // null = every type
  readonly fn: (e: E) => void;
  active: boolean;
  reported: boolean;
}

function defaultReporter(err: unknown, type: string): void {
  console.error(`[strikezone] event subscriber for "${type}" threw`, err);
}

/**
 * Per-tick queued event bus (dec-tick-orchestration-events).
 *
 * emit() only queues (BR-K-21). drain() delivers in emit order to subscribers in
 * subscription order (BR-K-22). Emits during a drain go to the next drain and a
 * nested drain() returns [] (BR-K-23). Nothing is ever dropped (BR-K-27).
 */
export function createEventBus<E extends { readonly type: string }>(
  opts: EventBusOptions = {},
): EventBus<E> {
  const onSubscriberError = opts.onSubscriberError ?? defaultReporter;
  let queue: E[] = [];
  let subs: Subscription<E>[] = [];
  let draining = false;

  function deliver(s: Subscription<E>, e: E): void {
    try {
      s.fn(e);
    } catch (error: unknown) {
      if (!s.reported) {
        s.reported = true;
        onSubscriberError(error, e.type);
      }
    }
  }

  function drain(): ReadonlyArray<E> {
    if (draining) return [];
    const batch = queue;
    queue = [];
    draining = true;
    const snapshot = subs; // subscribe/unsubscribe replace `subs`, so this stays stable
    try {
      for (const e of batch) {
        for (const s of snapshot) {
          if (!s.active) continue;
          if (s.filter !== null && s.filter !== e.type) continue;
          deliver(s, e);
        }
      }
    } finally {
      draining = false;
    }
    return batch;
  }

  function add(filter: string | null, fn: (e: E) => void): Unsubscribe {
    const s: Subscription<E> = { filter, fn, active: true, reported: false };
    subs = [...subs, s];
    return () => {
      if (!s.active) return; // BR-K-25: double unsubscribe is a no-op
      s.active = false;
      subs = subs.filter((x) => x !== s);
    };
  }

  return {
    emit(e: E): void {
      queue.push(e);
    },
    drain,
    subscribe(type, fn) {
      return add(type, fn as (e: E) => void);
    },
    subscribeAll(fn) {
      return add(null, fn);
    },
    clear(): void {
      queue = []; // BR-K-26: subscriptions kept
    },
    get pending(): number {
      return queue.length;
    },
  };
}
