import { describe, expect, it } from 'vitest';
import {
  INITIAL_STATE,
  RESUME_REFUSED_TEXT,
  dispatch,
  type AppScreen,
  type AppState,
  type Command,
  type MachineContext,
  type Signal,
} from '@sz/app/core/machine';

const ctxOf = (
  phase: MachineContext['view']['phase'] = 'loading',
  started = false,
  paused = false,
): MachineContext => ({ view: { phase, started, paused } });

const IDLE = ctxOf();
const READY = ctxOf('ready');
const COUNTDOWN = ctxOf('countdown');
const LIVE = ctxOf('live', true);
const ENDED = ctxOf('ended', true);

const at = (screen: AppScreen, patch: Partial<AppState> = {}): AppState =>
  Object.freeze({ ...INITIAL_STATE, screen, ...patch });

const kinds = (cmds: ReadonlyArray<Command>): string[] => cmds.map((c) => c.kind);

function run(s: AppState, sig: Signal, ctx: MachineContext = IDLE) {
  return dispatch(s, sig, ctx);
}

describe('boot screens', () => {
  it('loading → ready → enter opens the main menu with a click cue', () => {
    let s = run(INITIAL_STATE, { kind: 'enter' });
    expect(s.ignored).toBe(true); // BR-AS-05: not before every step is done
    s = run(INITIAL_STATE, { kind: 'boot-ready' });
    expect(s.state.bootReady).toBe(true);
    const e = run(s.state, { kind: 'enter' });
    expect(e.state.screen).toBe('main-menu');
    expect(kinds(e.commands)).toEqual(['play-click', 'render']);
  });

  it('a failed step shows SCR-E2 and Retry reruns boot', () => {
    const f = run(INITIAL_STATE, { kind: 'boot-failed', label: 'Graphics', retryable: true });
    expect(f.state).toMatchObject({
      screen: 'boot-error',
      error: { kind: 'boot', label: 'Graphics' },
    });
    const r = run(f.state, { kind: 'retry-step' });
    expect(r.state.screen).toBe('loading');
    expect(kinds(r.commands)).toEqual(['retry-boot', 'render']);
  });

  it('a non-retryable failure ignores Retry', () => {
    const f = run(INITIAL_STATE, { kind: 'boot-failed', label: 'Maps', retryable: false });
    expect(run(f.state, { kind: 'retry-step' }).ignored).toBe(true);
  });

  it('unsupported: Continue anyway only when allowed', () => {
    const blocked = run(INITIAL_STATE, { kind: 'unsupported', canContinue: false });
    expect(blocked.state.screen).toBe('unsupported');
    expect(run(blocked.state, { kind: 'continue-anyway' }).ignored).toBe(true);
    const narrow = run(INITIAL_STATE, { kind: 'unsupported', canContinue: true });
    const c = run(narrow.state, { kind: 'continue-anyway' });
    expect(c.state.screen).toBe('loading');
    expect(kinds(c.commands)).toEqual(['continue-boot', 'render']);
  });
});

describe('main menu and dialogs', () => {
  const menu = at('main-menu');

  it('setup changes apply and re-render in place', () => {
    const s = run(menu, { kind: 'change-setup', field: 'botCount', raw: '5' });
    expect(s.state).toBe(menu);
    expect(s.commands).toEqual([
      { kind: 'apply-setup', field: 'botCount', raw: '5' },
      { kind: 'render' },
    ]);
  });

  it('Start goes to map loading and defers the start', () => {
    const s = run(menu, { kind: 'start-match' });
    expect(s.state.screen).toBe('map-loading');
    expect(kinds(s.commands)).toEqual(['start-match', 'render']);
  });

  it.each(['settings', 'controls', 'about', 'history'] as const)('opens and closes %s', (d) => {
    const o = run(menu, { kind: 'open', screen: d });
    expect(o.state).toMatchObject({ dialog: d, settingsFrom: 'menu' });
    const c = run(o.state, { kind: 'close' });
    expect(c.state.dialog).toBeUndefined();
    expect(c.state.screen).toBe('main-menu');
  });

  it('settings: change, reset with confirmation, cancel', () => {
    const s = at('main-menu', { dialog: 'settings' });
    expect(kinds(run(s, { kind: 'change-setting', key: 'fovDeg', raw: '100' }).commands)).toEqual([
      'apply-setting',
      'render',
    ]);
    const asked = run(s, { kind: 'reset-settings' });
    expect(asked.state.confirmReset).toBe(true);
    expect(kinds(run(asked.state, { kind: 'confirm' }).commands)).toEqual([
      'reset-settings',
      'render',
    ]);
    expect(run(asked.state, { kind: 'cancel' }).state.confirmReset).toBe(false);
    expect(run(s, { kind: 'confirm' }).ignored).toBe(true);
    expect(run(s, { kind: 'cancel' }).ignored).toBe(true);
    expect(run(s, { kind: 'clear-history' }).ignored).toBe(true);
  });

  it('history: clear with confirmation', () => {
    const h = at('main-menu', { dialog: 'history' });
    expect(run(h, { kind: 'change-setting', key: 'fovDeg', raw: '1' }).ignored).toBe(true);
    expect(run(h, { kind: 'reset-settings' }).ignored).toBe(true);
    const asked = run(h, { kind: 'clear-history' });
    expect(asked.state.confirmClear).toBe(true);
    const done = run(asked.state, { kind: 'confirm' });
    expect(kinds(done.commands)).toEqual(['clear-history', 'render']);
    expect(done.state.confirmClear).toBe(false);
  });

  it('a dialog blocks menu intents (BR-AS-11)', () => {
    expect(run(at('main-menu', { dialog: 'about' }), { kind: 'start-match' }).ignored).toBe(true);
  });
});

describe('match start and capture (story-round-countdown-flow)', () => {
  it('round-started shows the capture prompt; a failure shows a retryable SCR-E2', () => {
    const ok = run(at('map-loading'), { kind: 'round-started' });
    expect(ok.state).toMatchObject({ screen: 'capture', captureRefused: false });
    const bad = run(at('map-loading'), { kind: 'round-start-failed' });
    expect(bad.state).toMatchObject({ screen: 'boot-error', error: { kind: 'round-start' } });
    const retry = run(bad.state, { kind: 'retry-step' });
    expect(retry.state.screen).toBe('map-loading');
    expect(kinds(retry.commands)).toEqual(['start-match', 'render']);
  });

  it('capture requests the lock inside the activation; the gain starts the countdown', () => {
    const c = at('capture');
    expect(run(c, { kind: 'capture-and-start' }, READY).commands).toEqual([
      { kind: 'request-lock' },
    ]);
    const g = run(c, { kind: 'lock-gained' }, READY);
    expect(g.state.screen).toBe('hud');
    expect(g.commands).toEqual([
      { kind: 'begin-countdown' },
      { kind: 'set-input', enabled: true },
      { kind: 'render' },
    ]);
    expect(run(c, { kind: 'lock-gained' }, IDLE).ignored).toBe(true);
  });

  it('a refused lock shows SCR-06 B′', () => {
    expect(run(at('capture'), { kind: 'lock-error' }, READY).state.captureRefused).toBe(true);
  });
});

describe('pause (story-pause-game)', () => {
  const hud = at('hud');

  it('an external lock loss pauses a live or counting-down round', () => {
    for (const ctx of [LIVE, COUNTDOWN, READY]) {
      const p = run(hud, { kind: 'lock-lost', reason: 'external' }, ctx);
      expect(p.state.screen).toBe('pause');
      expect(p.commands).toEqual([{ kind: 'pause', paused: true }, { kind: 'render' }]);
    }
  });

  it('BR-AS-20/21: our own release, the end hold and an ended round never pause', () => {
    expect(run(hud, { kind: 'lock-lost', reason: 'released' }, LIVE).ignored).toBe(true);
    expect(
      run(at('hud', { holding: true }), { kind: 'lock-lost', reason: 'external' }, ENDED).ignored,
    ).toBe(true);
    expect(run(hud, { kind: 'lock-lost', reason: 'external' }, ENDED).ignored).toBe(true);
    expect(run(at('end'), { kind: 'lock-lost', reason: 'external' }, ENDED).ignored).toBe(true);
    expect(run(at('main-menu'), { kind: 'lock-lost', reason: 'external' }).ignored).toBe(true);
  });

  it('Resume locks directly; the gain unpauses and restarts a cancelled countdown (BR-AS-22)', () => {
    const p = at('pause');
    expect(run(p, { kind: 'resume' }, READY).commands).toEqual([{ kind: 'request-lock' }]);
    const g = run(p, { kind: 'lock-gained' }, ctxOf('ready', false, true));
    expect(g.state.screen).toBe('hud');
    expect(kinds(g.commands)).toEqual(['pause', 'begin-countdown', 'set-input', 'render']);
    expect(g.commands[0]).toEqual({ kind: 'pause', paused: false });
  });

  it('a refused resume: combat stays paused with a hint, pre-start falls back to capture', () => {
    const combat = run(at('pause'), { kind: 'lock-error' }, ctxOf('live', true, true));
    expect(combat.state).toMatchObject({ screen: 'pause', resumeRefused: true });
    expect(combat.commands[0]).toEqual({ kind: 'announce', text: RESUME_REFUSED_TEXT });
    const pre = run(at('pause'), { kind: 'lock-error' }, ctxOf('ready', false, true));
    expect(pre.state).toMatchObject({ screen: 'capture', captureRefused: true });
    expect(pre.commands[0]).toEqual({ kind: 'pause', paused: false });
  });

  it('opens settings or controls over Pause, and the advisory goes to settings', () => {
    expect(run(at('pause'), { kind: 'open', screen: 'settings' }).state).toMatchObject({
      dialog: 'settings',
      settingsFrom: 'pause',
    });
    expect(run(at('pause'), { kind: 'open', screen: 'history' }).ignored).toBe(true);
    const adv = run(at('pause'), { kind: 'change-graphics' });
    expect(adv.state).toMatchObject({ dialog: 'settings', settingsFrom: 'advisory' });
    expect(run(adv.state, { kind: 'close' }).state).toMatchObject({
      screen: 'pause',
      dialog: undefined,
    });
  });
});

describe('abandon (story-abandon-round)', () => {
  const combat = ctxOf('live', true, true);
  const preStart = ctxOf('ready', false, true);

  it('combat: restart and quit ask first; confirm executes, cancel closes', () => {
    const ask = run(at('pause'), { kind: 'restart' }, combat);
    expect(ask.state.confirm).toBe('restart');
    expect(kinds(ask.commands)).toEqual(['render']);
    const yes = run(ask.state, { kind: 'confirm' }, combat);
    expect(yes.state.screen).toBe('map-loading');
    expect(kinds(yes.commands)).toEqual(['restart', 'render']);
    const no = run(ask.state, { kind: 'cancel' }, combat);
    expect(no.state).toMatchObject({ screen: 'pause', confirm: undefined });
    const quit = run(
      run(at('pause'), { kind: 'quit-to-menu' }, combat).state,
      { kind: 'confirm' },
      combat,
    );
    expect(quit.state.screen).toBe('main-menu');
    expect(kinds(quit.commands)).toEqual(['quit', 'render']);
  });

  it('pre-start: restart and quit run at once', () => {
    expect(kinds(run(at('pause'), { kind: 'restart' }, preStart).commands)).toEqual([
      'restart',
      'render',
    ]);
    expect(run(at('pause'), { kind: 'quit-to-menu' }, preStart).state.screen).toBe('main-menu');
  });

  it('confirm with nothing pending is ignored', () => {
    expect(run(at('pause'), { kind: 'confirm' }, combat).ignored).toBe(true);
  });
});

describe('round end (story-play-again-reset)', () => {
  it('RoundEnded starts the hold; the elapsed hold shows the end screen and records', () => {
    const e = run(at('hud'), { kind: 'round-ended', outcome: 'defeat' }, ENDED);
    expect(e.state.holding).toBe(true);
    expect(e.commands).toEqual([{ kind: 'start-hold', outcome: 'defeat' }]);
    expect(run(e.state, { kind: 'round-ended', outcome: 'defeat' }, ENDED).ignored).toBe(true);
    const done = run(e.state, { kind: 'hold-elapsed' }, ENDED);
    expect(done.state).toMatchObject({ screen: 'end', holding: false });
    expect(kinds(done.commands)).toEqual(['set-input', 'release-lock', 'record-round', 'render']);
    expect(run(at('hud'), { kind: 'hold-elapsed' }, ENDED).ignored).toBe(true);
  });

  it('Play again restarts; Main menu quits', () => {
    expect(kinds(run(at('end'), { kind: 'play-again' }, ENDED).commands)).toEqual([
      'play-again',
      'render',
    ]);
    expect(run(at('end'), { kind: 'quit-to-menu' }, ENDED).state.screen).toBe('main-menu');
  });
});

describe('context loss (FD-AS-2)', () => {
  it('a running round freezes as Pause would and returns to Pause on restore', () => {
    const lost = run(at('hud'), { kind: 'context-lost' }, LIVE);
    expect(lost.state).toMatchObject({
      screen: 'context-lost',
      remembered: 'pause',
      contextLost: true,
    });
    expect(kinds(lost.commands)).toEqual(['pause', 'release-lock', 'render']);
    expect(run(lost.state, { kind: 'context-lost' }, LIVE).ignored).toBe(true);
    const back = run(lost.state, { kind: 'context-restored' }, LIVE);
    expect(back.state).toMatchObject({
      screen: 'pause',
      contextLost: false,
      remembered: undefined,
    });
  });

  it('outside a round it remembers the screen', () => {
    const lost = run(at('main-menu'), { kind: 'context-lost' });
    expect(kinds(lost.commands)).toEqual(['release-lock', 'render']);
    expect(run(lost.state, { kind: 'context-restored' }).state.screen).toBe('main-menu');
    expect(run(at('context-lost'), { kind: 'context-restored' }).state.screen).toBe('main-menu');
  });

  it('an end hold that runs out during the loss is recorded and ends on the end screen', () => {
    const lost = run(at('hud', { holding: true }), { kind: 'context-lost' }, ENDED);
    expect(lost.state.remembered).toBe('hud');
    const held = run(lost.state, { kind: 'hold-elapsed' }, ENDED);
    expect(kinds(held.commands)).toEqual(['set-input', 'record-round']);
    expect(run(held.state, { kind: 'context-restored' }).state.screen).toBe('end');
    expect(run(at('context-lost'), { kind: 'hold-elapsed' }).ignored).toBe(true);
    const ended = run(at('context-lost'), { kind: 'round-ended', outcome: 'victory' }, ENDED);
    expect(ended.state.holding).toBe(true);
    expect(run(ended.state, { kind: 'round-ended', outcome: 'victory' }, ENDED).ignored).toBe(true);
  });
});

describe('fatal and e2e', () => {
  it('fatal is terminal (BR-AS-12)', () => {
    const f = run(at('hud', { dialog: 'settings' }), { kind: 'fatal' }, LIVE);
    expect(f.state).toMatchObject({ screen: 'fatal', dialog: undefined });
    for (const sig of [
      { kind: 'enter' },
      { kind: 'context-restored' },
      { kind: 'fatal' },
      { kind: 'e2e-started' },
    ] as const) {
      expect(run(f.state, sig).ignored).toBe(true);
    }
  });

  it('e2e-started shows the HUD from any live screen but not during a context loss', () => {
    expect(run(at('main-menu', { dialog: 'about' }), { kind: 'e2e-started' }).state).toMatchObject({
      screen: 'hud',
      dialog: undefined,
    });
    expect(run(at('context-lost'), { kind: 'e2e-started' }).ignored).toBe(true);
  });
});

describe('SD-AS-8: every signal without a row is ignored, never thrown', () => {
  const screens: AppScreen[] = [
    'loading',
    'unsupported',
    'boot-error',
    'main-menu',
    'map-loading',
    'capture',
    'hud',
    'pause',
    'end',
  ];
  const stray: Signal[] = [
    { kind: 'clear-history' },
    { kind: 'reset-settings' },
    { kind: 'change-setting', key: 'x', raw: 'y' },
    { kind: 'boot-ready' },
    { kind: 'context-restored' },
  ];

  it.each(screens)('%s', (screen) => {
    for (const sig of stray) {
      const s = run(at(screen), sig, LIVE);
      if (screen === 'loading' && sig.kind === 'boot-ready') continue;
      expect(s.ignored, `${screen} + ${sig.kind}`).toBe(true);
      expect(s.commands).toEqual([]);
    }
  });

  it('play-again on the HUD and resume on the menu are ignored', () => {
    expect(run(at('hud'), { kind: 'play-again' }, LIVE).ignored).toBe(true);
    expect(run(at('main-menu'), { kind: 'resume' }).ignored).toBe(true);
    expect(run(at('map-loading'), { kind: 'enter' }).ignored).toBe(true);
    expect(run(at('capture'), { kind: 'quit-to-menu' }, READY).ignored).toBe(true);
  });
});
