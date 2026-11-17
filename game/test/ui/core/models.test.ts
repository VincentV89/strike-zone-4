import { describe, expect, it } from 'vitest';
import { DEFAULT_MATCH_SETUP, PLAYER_ID, type MatchSetup } from '@sz/kernel';
import { desertCompound, industrialWarehouse } from '@sz/maps';
import { DEFAULT_SETTINGS, entryFromSummary } from '@sz/persistence';
import { createRoundStats, createSessionTotals, summarize, type RoundSummary } from '@sz/stats';
import {
  toBootErrorModel,
  toLoadingModel,
  toMapLoadingModel,
  toUnsupportedModel,
} from '@sz/ui/core/boot-models';
import { toEndModel } from '@sz/ui/core/end-model';
import { HISTORY_EMPTY_TEXT, toHistoryModel } from '@sz/ui/core/history-model';
import { onPauseIntent, toCapturePrompt, toPauseModel } from '@sz/ui/core/pause-model';
import { storageNote, toAboutModel } from '@sz/ui/core/screens';
import { applySettingChange, toSettingsModel } from '@sz/ui/core/settings-model';
import { applySetupChange, toSetupPanel } from '@sz/ui/core/setup-model';
import { bot, deepFreeze, makeView } from '../../support/hud-driver';

const MAPS = [desertCompound, industrialWarehouse].map((m) => ({
  id: m.id,
  name: m.name,
  blurb: m.blurb,
}));

describe('applySetupChange (req-match-setup AC1, security-design-ui-hud §5)', () => {
  const s: MatchSetup = deepFreeze({ ...DEFAULT_MATCH_SETUP });

  it.each(['1', '2', '3', '5', '8', '10', '15', '20'])('accepts bot count %s', (raw) => {
    expect(applySetupChange(s, 'botCount', raw).botCount).toBe(raw === '5' ? 5 : Number(raw));
  });

  it.each([
    ['botCount', '7'],
    ['botCount', 'NaN'],
    ['botCount', '21'],
    ['botCount', '1e1'],
    ['botCount', ' 5'],
    ['botCount', '05'],
    ['botCount', true],
    ['mapId', 'dust2'],
    ['difficulty', 'insane'],
    ['__proto__', 'x'],
    ['constructor', 'x'],
    [42, 'x'],
  ])('rejects %s = %s with the same object', (field, raw) => {
    expect(applySetupChange(s, field, raw)).toBe(s);
  });

  it('an unchanged value returns the same object', () => {
    expect(applySetupChange(s, 'botCount', '5')).toBe(s);
    const next = applySetupChange(s, 'mapId', 'industrial-warehouse');
    expect(next).toEqual({ ...s, mapId: 'industrial-warehouse' });
    expect(Object.isFrozen(next)).toBe(true);
  });

  it('the panel lists 8 bot counts, both maps, 3 difficulties and the summary row', () => {
    const p = toSetupPanel(s, DEFAULT_SETTINGS, MAPS);
    expect(p.bots.map((b) => b.value)).toEqual([1, 2, 3, 5, 8, 10, 15, 20]);
    expect(p.bots.find((b) => b.checked)?.value).toBe(5);
    expect(p.maps.map((m) => m.label)).toEqual(['Desert Compound', 'Industrial Warehouse']);
    expect(p.difficulties.find((d) => d.checked)?.label).toBe('Normal');
    expect(p.summary).toBe('Round 3:00 · Graphics Medium');
  });
});

describe('applySettingChange', () => {
  const s = DEFAULT_SETTINGS;

  it.each([
    ['fovDeg', '1e2'],
    ['fovDeg', ' 90'],
    ['fovDeg', '111'],
    ['fovDeg', ''],
    ['sensitivity', '-1'],
    ['masterVolume', 'abc'],
    ['graphics', 'ultra'],
    ['roundDurationSec', '200'],
    ['__proto__', '1'],
    ['unknown', '1'],
  ])('rejects %s = %j with the same object', (key, raw) => {
    expect(applySettingChange(s, key, raw)).toBe(s);
  });

  it('accepts slider strings and snaps them to the step', () => {
    expect(applySettingChange(s, 'fovDeg', '100').fovDeg).toBe(100);
    expect(applySettingChange(s, 'sensitivity', '2.35').sensitivity).toBe(2.4);
    expect(applySettingChange(s, 'graphics', 'high').graphics).toBe('high');
    expect(applySettingChange(s, 'roundDurationSec', '600').roundDurationSec).toBe(600);
    expect(applySettingChange(s, 'masterVolume', 0).masterVolume).toBe(0);
  });

  it('the dialog model formats values and notes next-round durations from Pause', () => {
    const m = toSettingsModel(s, 'pause');
    expect(m.sliders.map((x) => x.valueText)).toEqual(['1.0×', '90°', '80%', '70%']);
    expect(m.durationNote).toBe('Applies from the next round.');
    expect(toSettingsModel(s, 'menu').durationNote).toBe('');
    expect(m.graphics.find((g) => g.checked)?.value).toBe('medium');
    expect(m.durations.map((d) => d.label)).toEqual(['2:00', '3:00', '5:00', '10:00']);
  });
});

function summaryOf(outcome: RoundSummary['outcome'], won = 2, lost = 1): RoundSummary {
  const st = createRoundStats();
  st.kills = 3;
  st.headshots = 1;
  st.shotsFired = 68;
  st.shotsHit = 26;
  st.damageDealt = 300;
  st.damageReceived = 120;
  return summarize(st, {
    outcome,
    liveTicks: 95 * 60,
    enemiesRemaining: 2,
    setup: DEFAULT_MATCH_SETUP,
    totals: createSessionTotals(won, lost),
  });
}

describe('pause model and abandon flow (§10.1, BR-UI-40)', () => {
  const base = {
    roundIndex: 2,
    aliveBots: 3,
    record: createSessionTotals(4, 2),
    advisory: undefined,
    graphics: 'medium' as const,
    confirm: undefined,
  };

  it('combat variant: summary line and confirm view with the consequence', () => {
    const m = toPauseModel({ ...base, view: makeView({ timeLeftSec: 75.2 }), confirm: 'restart' });
    expect(m.variant).toBe('combat');
    expect(m.summaryLine).toBe('Round 2 · 1:16 left · 3 enemies remaining');
    expect(m.confirm).toEqual({
      action: 'restart',
      question: 'Restart round?',
      consequence: 'Counts as a loss. Record becomes W 4 · L 3.',
      confirmLabel: 'Restart round',
    });
    expect(
      toPauseModel({ ...base, view: makeView(), confirm: 'quit-to-menu' }).confirm?.question,
    ).toBe('Leave this round?');
  });

  it('pre-start variant never confirms', () => {
    const view = makeView({ phase: 'countdown', started: false });
    const m = toPauseModel({ ...base, view, confirm: 'restart' });
    expect(m.variant).toBe('pre-start');
    expect(m.summaryLine).toBe('Round 2 · not started');
    expect(m.confirm).toBeUndefined();
  });

  it('onPauseIntent: combat confirms first, pre-start executes at once', () => {
    expect(onPauseIntent('combat', undefined, 'restart')).toEqual({
      confirm: 'restart',
      execute: undefined,
    });
    expect(onPauseIntent('combat', 'restart', 'confirm')).toEqual({
      confirm: undefined,
      execute: 'restart',
    });
    expect(onPauseIntent('combat', 'quit-to-menu', 'cancel')).toEqual({
      confirm: undefined,
      execute: undefined,
    });
    expect(onPauseIntent('pre-start', undefined, 'quit-to-menu')).toEqual({
      confirm: undefined,
      execute: 'quit-to-menu',
    });
    expect(onPauseIntent('combat', undefined, 'resume').execute).toBe('resume');
  });

  it('advisory line shows only while graphics is still High', () => {
    const view = makeView();
    expect(
      toPauseModel({ ...base, view, advisory: { fps: 41 }, graphics: 'high' }).advisoryLine,
    ).toBe('Performance is low (41 FPS). Medium graphics may help.');
    expect(toPauseModel({ ...base, view, advisory: { fps: 41 } }).advisoryLine).toBe('');
  });

  it('capture prompt labels the round and the refusal', () => {
    expect(toCapturePrompt(1, 'desert-compound', false)).toEqual({
      id: 'capture-prompt',
      roundLabel: 'Round 1 · Desert Compound',
      refusalLine: '',
    });
    expect(toCapturePrompt(1, 'desert-compound', true).refusalLine).toContain("didn't capture");
  });
});

describe('end model (§10.2)', () => {
  it.each([
    ['victory', '★ Victory', 'All 5 enemies eliminated · 1:35'],
    ['time-expired', '⏱ Defeat', 'Time expired · 2 enemies left'],
    ['defeat', '✕ Defeat', 'You were killed'],
  ] as const)('%s', (outcome, title, subtitle) => {
    const m = toEndModel(summaryOf(outcome), undefined);
    expect(m.title).toBe(title);
    expect(m.subtitle).toBe(subtitle);
  });

  it('names the killer and every stat comes from the summary', () => {
    const m = toEndModel(summaryOf('defeat'), { killer: bot(4), headshot: true });
    expect(m.subtitle).toBe('Killed by Bot-4 (headshot)');
    expect(m.primary.map((s) => s.value)).toEqual(['3', '1', '38%', '300', '1:35']);
    expect(m.secondary).toEqual([
      { label: 'Damage taken', value: '120' },
      { label: 'Shots hit', value: '26 / 68' },
      { label: 'Deaths', value: '0' },
    ]);
    expect(m.recordLine).toBe('Record W 2 · L 1');
    expect(toEndModel(summaryOf('defeat'), { killer: PLAYER_ID, headshot: false }).subtitle).toBe(
      'Killed by You',
    );
  });
});

describe('history model (req-match-history)', () => {
  it('shows the empty state and the record', () => {
    const m = toHistoryModel([], createSessionTotals(1, 0), false, () => 'd');
    expect(m.emptyText).toBe(HISTORY_EMPTY_TEXT);
    expect(m.recordLine).toBe('Record W 1 · L 0');
  });

  it('formats rows through the injected date formatter', () => {
    const e = entryFromSummary(summaryOf('time-expired'), 7, 1234);
    const m = toHistoryModel([e], createSessionTotals(), true, (ms) => `t${String(ms)}`);
    expect(m.rows).toEqual([
      {
        key: '7',
        date: 't1234',
        map: 'Desert Compound',
        bots: '5',
        difficulty: 'Normal',
        result: 'Time expired',
        kills: '3',
        accuracy: '38%',
      },
    ]);
    expect(m.emptyText).toBe('');
    expect(m.confirmClear).toBe(true);
  });
});

describe('boot models', () => {
  it('loading percent is weighted and Click to enter waits for every step', () => {
    const steps = [
      { label: 'Physics', weight: 10, status: 'done' as const },
      { label: 'Assets', weight: 30, status: 'done' as const },
      { label: 'Audio', weight: 40, status: 'running' as const },
      { label: 'Maps', weight: 20, status: 'pending' as const },
    ];
    expect(toLoadingModel(steps)).toEqual({
      id: 'loading',
      pct: 40,
      currentLabel: 'Audio',
      ready: false,
    });
    const done = steps.map((s) => ({ ...s, status: 'done' as const }));
    expect(toLoadingModel(done)).toEqual({
      id: 'loading',
      pct: 100,
      currentLabel: 'Ready',
      ready: true,
    });
    expect(toLoadingModel([]).ready).toBe(false);
    expect(
      toMapLoadingModel('Desert Compound', [{ label: 'x', weight: Number.NaN, status: 'done' }])
        .pct,
    ).toBe(0);
  });

  it('boot error says whether Retry keeps finished steps', () => {
    expect(toBootErrorModel('Audio', true).message).toBe(
      'Audio failed to load. Retry keeps the steps that finished.',
    );
    expect(toBootErrorModel('Physics', false).retryable).toBe(false);
  });

  it('unsupported: one line per reason; Continue anyway only when width is the only failure', () => {
    expect(toUnsupportedModel({ webgl2: true, pointer: true, widthOk: false })).toEqual({
      id: 'unsupported',
      reasons: ['The window must be at least 1024 px wide.'],
      canContinue: true,
    });
    const m = toUnsupportedModel({ webgl2: false, pointer: false, widthOk: false });
    expect(m.reasons).toHaveLength(3);
    expect(m.canContinue).toBe(false);
  });

  it('about states that assets are original or procedural; storage note for session-only', () => {
    expect(toAboutModel('0.1.0').lines.join(' ')).toMatch(/original or procedurally generated/);
    expect(storageNote('session-only')).toBe('Saved for this tab only');
    expect(storageNote('persistent')).toBe('');
  });
});
