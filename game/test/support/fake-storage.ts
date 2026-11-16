// Counting fake Storage for persistence and HUD-pipeline tests (performance-design-ui-hud §6).
// Implements the StoragePort members, logs every call, and can throw on the Nth call of a method.
import type { StoragePort } from '@sz/persistence';

export type StorageMethod = 'getItem' | 'setItem' | 'removeItem';

export interface StorageCall {
  readonly method: StorageMethod;
  readonly key: string;
}

export interface FakeStorage extends StoragePort {
  readonly data: Map<string, string>;
  readonly calls: StorageCall[];
  count(method?: StorageMethod): number;
  /** The nth (1-based, counted from now) call of `method` throws `error`. */
  failOn(method: StorageMethod, nth?: number, error?: Error): void;
  /** Every call of `method` throws from now on. */
  failAlways(method: StorageMethod, error?: Error): void;
}

export function quotaError(): Error {
  const e = new Error('The quota has been exceeded.');
  e.name = 'QuotaExceededError';
  return e;
}

export function securityError(): Error {
  const e = new Error('The operation is insecure.');
  e.name = 'SecurityError';
  return e;
}

export function createFakeStorage(initial: Record<string, string> = {}): FakeStorage {
  const data = new Map(Object.entries(initial));
  const calls: StorageCall[] = [];
  const failures = new Map<StorageMethod, { left: number; always: boolean; error: Error }>();

  function enter(method: StorageMethod, key: string): void {
    calls.push({ method, key });
    const f = failures.get(method);
    if (!f) return;
    if (f.always) throw f.error;
    f.left -= 1;
    if (f.left === 0) {
      failures.delete(method);
      throw f.error;
    }
  }

  return {
    data,
    calls,
    count: (method) =>
      method === undefined ? calls.length : calls.filter((c) => c.method === method).length,
    failOn(method, nth = 1, error = quotaError()) {
      failures.set(method, { left: nth, always: false, error });
    },
    failAlways(method, error = securityError()) {
      failures.set(method, { left: 0, always: true, error });
    },
    getItem(key) {
      enter('getItem', key);
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      enter('setItem', key);
      data.set(key, value);
    },
    removeItem(key) {
      enter('removeItem', key);
      data.delete(key);
    },
  };
}

/** A schedule() fake: timers run only when the test calls run(). */
export function createManualSchedule(): {
  schedule: (fn: () => void, ms: number) => () => void;
  pending(): number;
  run(): void;
} {
  const timers = new Set<() => void>();
  return {
    schedule(fn) {
      timers.add(fn);
      return () => {
        timers.delete(fn);
      };
    },
    pending: () => timers.size,
    run() {
      const due = [...timers];
      timers.clear();
      for (const fn of due) fn();
    },
  };
}
