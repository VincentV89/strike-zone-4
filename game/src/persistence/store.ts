/**
 * Store facade (logical-components C1, business-logic-model-ui-hud §5, PD-UI-20 to 24, SD-UI-9).
 * Storage, now() and schedule() are injected, so this module has no globals. Any throwing
 * storage call moves the store to a session-only in-memory Map for the rest of the page; it never
 * logs, because session-only is a supported state (BR-UI-04, req-no-console-errors).
 */
import { parseMatchSetup, type MatchSetup } from '@sz/kernel';
import { createSessionTotals, type RoundSummary, type SessionTotals } from '@sz/stats';
import { decodeEnvelope, encodeEnvelope } from './envelope';
import { KEYS, type StorageKey } from './keys';
import {
  HISTORY_LIMIT,
  entryFromSummary,
  historyData,
  validateHistory,
  validateLastSetup,
  validateRecord,
  type HistoryEntry,
} from './records';
import { sanitizeSettings, settingsData, type Settings } from './settings';

export type StorageStatus = 'persistent' | 'session-only';

/** The Storage members persistence uses (a real localStorage satisfies it). */
export interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface StoreDeps {
  /** null when app-shell could not obtain localStorage (SecurityError, private mode). */
  readonly storage: StoragePort | null;
  readonly now: () => number;
  /** Trailing timer; returns a cancel function. app-shell wraps setTimeout/clearTimeout. */
  readonly schedule: (fn: () => void, ms: number) => () => void;
  readonly onStatus?: (status: StorageStatus) => void;
  /** Fired after a settings write reached persistent storage ("✓ Saved"). */
  readonly onSaved?: () => void;
}

export interface Store {
  status(): StorageStatus;
  settings(): Settings;
  lastSetup(): MatchSetup;
  history(): ReadonlyArray<HistoryEntry>;
  /** Lifetime W/L: app-shell seeds createRound({ totals: store.record() }). */
  record(): SessionTotals;
  /** Debounced 250 ms trailing (BR-UI-05). */
  saveSettings(s: Settings): void;
  saveLastSetup(s: MatchSetup): void;
  /** Idempotent per summary object. Returns true when a new entry was written. */
  recordRound(summary: RoundSummary): boolean;
  /** Removes the entries only; the record stays (FD-UI-8). */
  clearHistory(): void;
  /** Writes any pending settings now (app-shell calls it on pagehide). */
  flush(): void;
}

export const SETTINGS_DEBOUNCE_MS = 250;

export function createStore(deps: StoreDeps): Store {
  let backend: StoragePort | null = deps.storage;
  let memory = new Map<string, string>();
  let status: StorageStatus = backend ? 'persistent' : 'session-only';

  let settings: Settings = sanitizeSettings(undefined);
  let lastSetup: MatchSetup = validateLastSetup(undefined);
  let history: ReadonlyArray<HistoryEntry> = Object.freeze([]);
  let record: SessionTotals = createSessionTotals();
  let pending: Settings | undefined;
  let cancelPending: (() => void) | undefined;
  let lastRecorded: RoundSummary | undefined;

  function snapshotEncoded(): Map<string, string> {
    return new Map([
      [KEYS.settings, encodeEnvelope(settingsData(settings))],
      [KEYS.lastSetup, encodeEnvelope(lastSetupData(lastSetup))],
      [KEYS.history, encodeEnvelope(historyData(history))],
      [KEYS.record, encodeEnvelope(recordData(record))],
    ]);
  }

  function enterMemoryMode(): void {
    if (!backend) return;
    backend = null;
    memory = snapshotEncoded(); // a new Map; persistence never calls clear() (SD-UI-4)
    status = 'session-only';
    deps.onStatus?.(status);
  }

  function readRaw(key: StorageKey): string | null {
    if (!backend) return memory.get(key) ?? null;
    try {
      return backend.getItem(key);
    } catch {
      enterMemoryMode();
      return null;
    }
  }

  /** Returns true when the value reached persistent storage. */
  function write(key: StorageKey, value: string): boolean {
    if (backend) {
      try {
        backend.setItem(key, value);
        return true;
      } catch {
        enterMemoryMode();
      }
    }
    memory.set(key, value);
    return false;
  }

  function probe(): void {
    if (!backend) return;
    try {
      backend.setItem(KEYS.probe, '1');
      backend.removeItem(KEYS.probe);
    } catch {
      enterMemoryMode();
    }
  }

  function loadAll(): void {
    // PD-UI-20: exactly 4 getItem calls, in a fixed order; results are cached.
    settings = sanitizeSettings(decodeEnvelope(readRaw(KEYS.settings)));
    lastSetup = validateLastSetup(decodeEnvelope(readRaw(KEYS.lastSetup)));
    history = validateHistory(decodeEnvelope(readRaw(KEYS.history)));
    record = validateRecord(decodeEnvelope(readRaw(KEYS.record)));
  }

  function writePendingSettings(): void {
    cancelPending = undefined;
    const value = pending;
    pending = undefined;
    if (value === undefined) return;
    if (write(KEYS.settings, encodeEnvelope(settingsData(value)))) deps.onSaved?.();
  }

  probe();
  loadAll();

  return {
    status: () => status,
    settings: () => settings,
    lastSetup: () => lastSetup,
    history: () => history,
    record: () => record,
    saveSettings(s) {
      const clean = sanitizeSettings(settingsData(s));
      settings = clean;
      pending = clean;
      cancelPending?.();
      cancelPending = deps.schedule(writePendingSettings, SETTINGS_DEBOUNCE_MS);
    },
    saveLastSetup(s) {
      const r = parseMatchSetup(s);
      if (!r.ok) return;
      lastSetup = validateLastSetup(r.value);
      write(KEYS.lastSetup, encodeEnvelope(lastSetupData(lastSetup)));
    },
    recordRound(summary) {
      if (summary === lastRecorded) return false;
      lastRecorded = summary;
      const seq = (history[0]?.seq ?? 0) + 1;
      const entry = entryFromSummary(summary, seq, deps.now());
      history = Object.freeze([entry, ...history].slice(0, HISTORY_LIMIT));
      record = createSessionTotals(summary.totals.roundsWon, summary.totals.roundsLost);
      write(KEYS.history, encodeEnvelope(historyData(history)));
      write(KEYS.record, encodeEnvelope(recordData(record)));
      return true;
    },
    clearHistory() {
      history = Object.freeze([]);
      write(KEYS.history, encodeEnvelope(historyData(history)));
    },
    flush() {
      if (pending === undefined) return;
      cancelPending?.();
      writePendingSettings();
    },
  };
}

function lastSetupData(s: MatchSetup): MatchSetup {
  return { mapId: s.mapId, botCount: s.botCount, difficulty: s.difficulty };
}

function recordData(r: SessionTotals): SessionTotals {
  return { roundsWon: r.roundsWon, roundsLost: r.roundsLost };
}
