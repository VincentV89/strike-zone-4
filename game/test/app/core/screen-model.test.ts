import { DEFAULT_MATCH_SETUP } from '@sz/kernel';
import { DEFAULT_SETTINGS } from '@sz/persistence';
import { ZERO_TOTALS, type RoundSummary } from '@sz/stats';
import type { ScreenModel } from '@sz/ui';
import { describe, expect, it } from 'vitest';
import { createBootPlan, loadSteps } from '@sz/app/core/boot-plan';
import { INITIAL_STATE, type AppState } from '@sz/app/core/machine';
import {
  CONTEXT_LOST_MESSAGE,
  FATAL_MESSAGE,
  ROUND_SETUP_MESSAGE,
  toScreenModel,
  type ScreenData,
} from '@sz/app/core/screen-model';
import { makeView } from '../../support/hud-driver';

const data = (patch: Partial<ScreenData> = {}): ScreenData => ({
  steps: loadSteps(createBootPlan()),
  pct: 0,
  verdict: { webgl2: true, pointer: true, widthOk: false },
  settings: DEFAULT_SETTINGS,
  setup: DEFAULT_MATCH_SETUP,
  maps: [{ id: 'desert-compound', name: 'Desert Compound', blurb: 'x' }],
  storage: 'persistent',
  view: makeView({ phase: 'live', started: true, paused: true }),
  roundIndex: 2,
  aliveBots: 3,
  record: ZERO_TOTALS,
  advisory: undefined,
  history: [],
  formatDate: (ms) => String(ms),
  version: '9.9.9',
  killedBy: undefined,
  ...patch,
});

const at = (screen: AppState['screen'], patch: Partial<AppState> = {}): AppState => ({
  ...INITIAL_STATE,
  screen,
  ...patch,
});

const idOf = (m: ScreenModel): string => m.id;

describe('toScreenModel', () => {
  it('loading shows monotonic progress and 100 when ready', () => {
    const m = toScreenModel(INITIAL_STATE, data({ pct: 17 }));
    expect(m).toMatchObject({ id: 'loading', pct: 17, ready: false });
    const done = createBootPlan().steps.map((s) => ({ ...s, status: 'done' as const }));
    expect(toScreenModel(INITIAL_STATE, data({ steps: done }))).toMatchObject({
      pct: 100,
      ready: true,
    });
  });

  it('unsupported uses the verdict', () => {
    expect(toScreenModel(at('unsupported'), data())).toMatchObject({
      id: 'unsupported',
      canContinue: true,
    });
  });

  it('boot and round-start errors, context loss and fatal', () => {
    const boot = toScreenModel(
      at('boot-error', { error: { kind: 'boot', label: 'Sound', retryable: true } }),
      data(),
    );
    expect(boot).toMatchObject({ id: 'boot-error', retryable: true });
    const start = toScreenModel(
      at('boot-error', { error: { kind: 'round-start', label: 'Round setup', retryable: true } }),
      data(),
    );
    expect(start).toMatchObject({ message: ROUND_SETUP_MESSAGE, retryable: true });
    expect(toScreenModel(at('boot-error'), data())).toMatchObject({ message: FATAL_MESSAGE });
    expect(toScreenModel(at('context-lost'), data())).toMatchObject({
      message: CONTEXT_LOST_MESSAGE,
      retryable: false,
    });
    expect(toScreenModel(at('fatal'), data())).toMatchObject({
      message: FATAL_MESSAGE,
      retryable: false,
    });
  });

  it('main menu and every dialog', () => {
    expect(idOf(toScreenModel(at('main-menu'), data()))).toBe('main-menu');
    for (const d of ['settings', 'controls', 'about', 'history'] as const) {
      expect(idOf(toScreenModel(at('main-menu', { dialog: d }), data()))).toBe(d);
    }
    expect(
      toScreenModel(at('pause', { dialog: 'settings', settingsFrom: 'pause' }), data()),
    ).toMatchObject({
      id: 'settings',
      durationNote: 'Applies from the next round.',
    });
    expect(toScreenModel(at('main-menu', { dialog: 'about' }), data())).toMatchObject({
      version: '9.9.9',
    });
  });

  it('round screens: map loading, capture, hud, pause', () => {
    expect(toScreenModel(at('map-loading'), data())).toMatchObject({
      id: 'map-loading',
      mapName: 'Desert Compound',
    });
    expect(toScreenModel(at('capture', { captureRefused: true }), data())).toMatchObject({
      id: 'capture-prompt',
      roundLabel: 'Round 2 · Desert Compound',
    });
    expect(idOf(toScreenModel(at('hud'), data()))).toBe('hud');
    const p = toScreenModel(at('pause', { confirm: 'restart' }), data());
    expect(p).toMatchObject({ id: 'pause', variant: 'combat' });
    expect(p.id === 'pause' ? p.confirm?.action : undefined).toBe('restart');
  });

  it('an unknown map id falls back to the id as the name', () => {
    const m = toScreenModel(at('map-loading'), data({ maps: [] }));
    expect(m).toMatchObject({ mapName: 'desert-compound' });
  });

  it('end shows the summary, or the menu if none exists', () => {
    const summary = {
      outcome: 'victory',
      setup: DEFAULT_MATCH_SETUP,
      durationSec: 30,
      kills: 3,
      headshots: 1,
      accuracyPct: 50,
      damageDealt: 300,
      damageReceived: 10,
      shotsFired: 10,
      shotsHit: 5,
      deaths: 0,
      enemiesRemaining: 0,
      totals: ZERO_TOTALS,
    } as unknown as RoundSummary;
    expect(toScreenModel(at('end'), data({ view: makeView({ summary }) }))).toMatchObject({
      id: 'end',
      outcome: 'victory',
    });
    expect(idOf(toScreenModel(at('end'), data({ view: makeView({ phase: 'ended' }) })))).toBe(
      'main-menu',
    );
  });
});
