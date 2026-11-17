/**
 * safeLocalStorage (SD-AS-4, SEC-AS-15): the only localStorage member access in app-shell. A
 * SecurityError (privacy mode, blocked cookies) or a missing store gives null, and persistence
 * then runs in memory with "Saved for this tab only".
 */
import type { StoragePort } from '@sz/persistence';

export interface StorageHost {
  readonly localStorage?: StoragePort | null;
}

export function safeLocalStorage(win: StorageHost): StoragePort | null {
  try {
    const s = win.localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}
