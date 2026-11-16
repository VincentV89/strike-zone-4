import { describe, expect, it } from 'vitest';
import { DEFAULT_MATCH_SETUP } from '@sz/kernel';
import {
  DEFAULT_SETTINGS,
  KEYS,
  createStore,
  encodeEnvelope,
  withSetting,
  type StorageStatus,
  type StoreDeps,
} from '@sz/persistence';
import { createRoundStats, createSessionTotals, summarize, type RoundSummary } from '@sz/stats';
import {
  createFakeStorage,
  createManualSchedule,
  quotaError,
  type FakeStorage,
} from '../support/fake-storage';

function summary(won: number, lost: number, kills = 2): RoundSummary {
  const s = createRoundStats();
  s.kills = kills;
  s.shotsFired = 10;
  s.shotsHit = 4;
  return summarize(s, {
    outcome: 'victory',
    liveTicks: 3600,
    enemiesRemaining: 0,
    setup: DEFAULT_MATCH_SETUP,
    totals: createSessionTotals(won, lost),
  });
}

function setup(storage: FakeStorage | null, extra: Partial<StoreDeps> = {}) {
  const timers = createManualSchedule();
  const statuses: StorageStatus[] = [];
  let saved = 0;
  const store = createStore({
    storage,
    now: () => 1_000,
    schedule: timers.schedule,
    onStatus: (s) => statuses.push(s),
    onSaved: () => {
      saved++;
    },
    ...extra,
  });
  return { store, timers, statuses, saved: () => saved };
}

describe('createStore load (PD-UI-20)', () => {
  it('probes once and reads exactly 4 keys', () => {
    const storage = createFakeStorage();
    const { store } = setup(storage);
    expect(storage.count('getItem')).toBe(4);
    expect(storage.calls.slice(0, 2)).toEqual([
      { method: 'setItem', key: KEYS.probe },
      { method: 'removeItem', key: KEYS.probe },
    ]);
    expect(store.status()).toBe('persistent');
    expect(store.settings()).toEqual(DEFAULT_SETTINGS);
    expect(store.lastSetup()).toEqual(DEFAULT_MATCH_SETUP);
    expect(store.history()).toEqual([]);
    expect(store.record()).toEqual({ roundsWon: 0, roundsLost: 0 });
    store.settings();
    store.history();
    expect(storage.count('getItem')).toBe(4);
  });

  it('loads stored values and repairs a tampered key on its own', () => {
    const storage = createFakeStorage({
      [KEYS.settings]: encodeEnvelope({ ...DEFAULT_SETTINGS, fovDeg: 100, graphics: 'x' }),
      [KEYS.lastSetup]: '{not json',
      [KEYS.record]: encodeEnvelope({ roundsWon: 4, roundsLost: 1 }),
    });
    const { store } = setup(storage);
    expect(store.settings().fovDeg).toBe(100);
    expect(store.settings().graphics).toBe('medium');
    expect(store.lastSetup()).toEqual(DEFAULT_MATCH_SETUP);
    expect(store.record()).toEqual({ roundsWon: 4, roundsLost: 1 });
  });

  it('null storage gives a session-only store that still works', () => {
    const { store } = setup(null);
    expect(store.status()).toBe('session-only');
    store.saveLastSetup({ mapId: 'industrial-warehouse', botCount: 3, difficulty: 'easy' });
    expect(store.lastSetup().mapId).toBe('industrial-warehouse');
  });

  it('a failing probe switches to memory mode without touching the other keys', () => {
    const storage = createFakeStorage();
    storage.failAlways('setItem');
    const { store, statuses } = setup(storage);
    expect(store.status()).toBe('session-only');
    expect(statuses).toEqual(['session-only']);
    expect(storage.count('getItem')).toBe(0);
  });

  it('a throwing getItem switches to memory mode and falls back to defaults', () => {
    const storage = createFakeStorage();
    storage.failOn('getItem', 2);
    const { store } = setup(storage);
    expect(store.status()).toBe('session-only');
    expect(store.lastSetup()).toEqual(DEFAULT_MATCH_SETUP);
    expect(storage.count('getItem')).toBe(2);
  });
});

describe('settings writes (PD-UI-21, BR-UI-05)', () => {
  it('debounces to one trailing write and fires onSaved', () => {
    const storage = createFakeStorage();
    const { store, timers, saved } = setup(storage);
    const before = storage.count('setItem');
    let s = DEFAULT_SETTINGS;
    for (const fov of [91, 92, 93]) {
      s = withSetting(s, 'fovDeg', fov);
      store.saveSettings(s);
    }
    expect(store.settings().fovDeg).toBe(93);
    expect(timers.pending()).toBe(1);
    expect(storage.count('setItem')).toBe(before);
    timers.run();
    expect(storage.count('setItem')).toBe(before + 1);
    expect(saved()).toBe(1);
    expect(storage.data.get(KEYS.settings)).toContain('"fovDeg":93');
  });

  it('flush writes immediately and cancels the timer', () => {
    const storage = createFakeStorage();
    const { store, timers } = setup(storage);
    store.saveSettings(withSetting(DEFAULT_SETTINGS, 'graphics', 'low'));
    store.flush();
    expect(timers.pending()).toBe(0);
    expect(storage.data.get(KEYS.settings)).toContain('"graphics":"low"');
    const n = storage.count('setItem');
    store.flush();
    expect(storage.count('setItem')).toBe(n);
  });

  it('a quota error mid-session keeps the value in memory and reports session-only once', () => {
    const storage = createFakeStorage();
    const { store, timers, statuses, saved } = setup(storage);
    storage.failOn('setItem', 1, quotaError());
    store.saveSettings(withSetting(DEFAULT_SETTINGS, 'fovDeg', 100));
    timers.run();
    expect(store.status()).toBe('session-only');
    expect(statuses).toEqual(['session-only']);
    expect(saved()).toBe(0);
    expect(store.settings().fovDeg).toBe(100);
    const n = storage.count();
    store.saveLastSetup({ mapId: 'industrial-warehouse', botCount: 1, difficulty: 'easy' });
    expect(storage.count()).toBe(n);
    expect(store.lastSetup().botCount).toBe(1);
  });

  it('a value that bypassed validation is repaired before it is stored', () => {
    const storage = createFakeStorage();
    const { store } = setup(storage);
    store.saveSettings({ ...DEFAULT_SETTINGS, fovDeg: 1000 });
    store.flush();
    expect(store.settings().fovDeg).toBe(90);
  });
});

describe('history and record writes (PD-UI-22, FD-UI-1, FD-UI-8)', () => {
  it('recordRound prepends an entry, saves the record and ignores a repeat', () => {
    const storage = createFakeStorage();
    const { store } = setup(storage);
    const first = summary(1, 0);
    expect(store.recordRound(first)).toBe(true);
    const n = storage.count('setItem');
    expect(store.recordRound(first)).toBe(false);
    expect(storage.count('setItem')).toBe(n);
    expect(store.recordRound(summary(2, 0, 4))).toBe(true);
    expect(store.history().map((e) => e.seq)).toEqual([2, 1]);
    expect(store.history()[0]?.kills).toBe(4);
    expect(store.history()[0]?.at).toBe(1_000);
    expect(store.record()).toEqual({ roundsWon: 2, roundsLost: 0 });
    const reloaded = setup(storage).store;
    expect(reloaded.history()).toEqual(store.history());
    expect(reloaded.record()).toEqual({ roundsWon: 2, roundsLost: 0 });
  });

  it('a counted round writes exactly the history and record keys', () => {
    const storage = createFakeStorage();
    const { store } = setup(storage);
    const before = storage.calls.length;
    store.recordRound(summary(0, 1));
    expect(storage.calls.slice(before)).toEqual([
      { method: 'setItem', key: KEYS.history },
      { method: 'setItem', key: KEYS.record },
    ]);
  });

  it('keeps 20 entries under 8,192 characters', () => {
    const storage = createFakeStorage();
    const { store } = setup(storage);
    for (let i = 0; i < 25; i++) store.recordRound(summary(i, 0));
    expect(store.history()).toHaveLength(20);
    expect(store.history()[0]?.seq).toBe(25);
    expect((storage.data.get(KEYS.history) ?? '').length).toBeLessThan(8_192);
  });

  it('clearHistory keeps the record', () => {
    const storage = createFakeStorage();
    const { store } = setup(storage);
    store.recordRound(summary(3, 1));
    store.clearHistory();
    expect(store.history()).toEqual([]);
    expect(store.record()).toEqual({ roundsWon: 3, roundsLost: 1 });
    expect(setup(storage).store.history()).toEqual([]);
  });

  it('saveLastSetup ignores an invalid setup', () => {
    const storage = createFakeStorage();
    const { store } = setup(storage);
    const n = storage.count('setItem');
    store.saveLastSetup({ mapId: 'x', botCount: 7, difficulty: 'easy' } as never);
    expect(storage.count('setItem')).toBe(n);
  });

  it('never touches a key outside strikezone:* (SEC-UI-16)', () => {
    const storage = createFakeStorage({ other: 'keep' });
    const { store, timers } = setup(storage);
    store.saveSettings(withSetting(DEFAULT_SETTINGS, 'fovDeg', 70));
    timers.run();
    store.recordRound(summary(1, 0));
    store.clearHistory();
    for (const c of storage.calls) expect(c.key.startsWith('strikezone:')).toBe(true);
    expect(storage.data.get('other')).toBe('keep');
  });
});
