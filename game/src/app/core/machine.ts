/**
 * ScreenMachine (FD-AS-5, business-logic-model "Screen state machine"). A pure reducer
 * `(state, signal, ctx) → { state, commands, ignored }`. The DOM glue runs the commands
 * synchronously inside the same dispatch, so pointer-lock requests and audio unlock stay in the
 * user-activation stack. A signal with no row is ignored silently and counted (SD-AS-8).
 */
import type { RoundOutcome } from '@sz/kernel';
import type { RoundView } from '@sz/round';
import {
  onPauseIntent,
  pauseVariant,
  type AbandonAction,
  type DialogScreen,
  type SettingsOrigin,
  type UiIntent,
} from '@sz/ui';

export type AppScreen =
  | 'loading'
  | 'unsupported'
  | 'boot-error'
  | 'main-menu'
  | 'map-loading'
  | 'capture'
  | 'hud'
  | 'pause'
  | 'end'
  | 'context-lost'
  | 'fatal';

export interface AppError {
  readonly kind: 'boot' | 'round-start';
  readonly label: string;
  readonly retryable: boolean;
}

export interface AppState {
  readonly screen: AppScreen;
  /** The one open dialog over main-menu or pause (BR-AS-11). */
  readonly dialog: DialogScreen | undefined;
  readonly settingsFrom: SettingsOrigin;
  /** Pause abandon confirmation in progress. */
  readonly confirm: AbandonAction | undefined;
  readonly confirmReset: boolean;
  readonly confirmClear: boolean;
  /** SCR-06 B′: the browser refused pointer lock on the capture prompt. */
  readonly captureRefused: boolean;
  /** Pause: Resume was clicked but the lock was refused. */
  readonly resumeRefused: boolean;
  readonly bootReady: boolean;
  readonly canContinue: boolean;
  readonly error: AppError | undefined;
  /** End-of-round hold running (HUD stays, end screen pending). */
  readonly holding: boolean;
  /** Screen to restore after a WebGL context loss (FD-AS-2). */
  readonly remembered: AppScreen | undefined;
  readonly contextLost: boolean;
}

export const INITIAL_STATE: AppState = Object.freeze({
  screen: 'loading',
  dialog: undefined,
  settingsFrom: 'menu',
  confirm: undefined,
  confirmReset: false,
  confirmClear: false,
  captureRefused: false,
  resumeRefused: false,
  bootReady: false,
  canContinue: false,
  error: undefined,
  holding: false,
  remembered: undefined,
  contextLost: false,
});

export type SystemSignal =
  | { readonly kind: 'boot-ready' }
  | { readonly kind: 'boot-failed'; readonly label: string; readonly retryable: boolean }
  | { readonly kind: 'unsupported'; readonly canContinue: boolean }
  | { readonly kind: 'round-started' }
  | { readonly kind: 'round-start-failed' }
  | { readonly kind: 'lock-gained' }
  | { readonly kind: 'lock-lost'; readonly reason: 'released' | 'external' }
  | { readonly kind: 'lock-error' }
  | { readonly kind: 'round-ended'; readonly outcome: RoundOutcome }
  | { readonly kind: 'hold-elapsed' }
  | { readonly kind: 'context-lost' }
  | { readonly kind: 'context-restored' }
  | { readonly kind: 'e2e-started' }
  | { readonly kind: 'fatal' };

export type Signal = UiIntent | SystemSignal;

export type Command =
  | { readonly kind: 'render' }
  | { readonly kind: 'play-click' }
  | { readonly kind: 'apply-setup'; readonly field: string; readonly raw: string }
  | { readonly kind: 'apply-setting'; readonly key: string; readonly raw: string }
  | { readonly kind: 'reset-settings' }
  | { readonly kind: 'clear-history' }
  | { readonly kind: 'start-match' }
  | { readonly kind: 'request-lock' }
  | { readonly kind: 'release-lock' }
  | { readonly kind: 'begin-countdown' }
  | { readonly kind: 'set-input'; readonly enabled: boolean }
  | { readonly kind: 'pause'; readonly paused: boolean }
  | { readonly kind: 'restart' }
  | { readonly kind: 'quit' }
  | { readonly kind: 'play-again' }
  | { readonly kind: 'record-round' }
  | { readonly kind: 'start-hold'; readonly outcome: RoundOutcome }
  | { readonly kind: 'retry-boot' }
  | { readonly kind: 'continue-boot' }
  | { readonly kind: 'announce'; readonly text: string };

export interface MachineContext {
  readonly view: Pick<RoundView, 'phase' | 'started' | 'paused'>;
}

export interface Step {
  readonly state: AppState;
  readonly commands: ReadonlyArray<Command>;
  readonly ignored: boolean;
}

export const RESUME_REFUSED_TEXT = 'Click Resume to capture the mouse.';

const RENDER: Command = Object.freeze({ kind: 'render' });
const NO_COMMANDS: ReadonlyArray<Command> = Object.freeze([]);
const NO_PATCH: Partial<AppState> = Object.freeze({});

/** State change plus commands, then a render. */
function go(state: AppState, patch: Partial<AppState>, ...commands: Command[]): Step {
  return {
    state: Object.freeze({ ...state, ...patch }),
    commands: Object.freeze([...commands, RENDER]),
    ignored: false,
  };
}

/** Commands only (no render unless listed). */
function act(state: AppState, patch: Partial<AppState>, ...commands: Command[]): Step {
  return {
    state: patch === NO_PATCH ? state : Object.freeze({ ...state, ...patch }),
    commands: commands.length === 0 ? NO_COMMANDS : Object.freeze(commands),
    ignored: false,
  };
}

type Handler = (s: AppState, sig: Signal, ctx: MachineContext) => Step | undefined;

const CLEAR_DIALOG: Partial<AppState> = Object.freeze({
  dialog: undefined,
  confirmReset: false,
  confirmClear: false,
});

/** Phases in which a round runs or waits for the countdown, so a lost lock pauses it. */
const pausablePhase = (ctx: MachineContext): boolean =>
  ctx.view.phase === 'ready' || ctx.view.phase === 'countdown' || ctx.view.phase === 'live';

/** Settings, controls, about and history over main-menu or pause. */
const dialogHandler: Handler = (s, sig) => {
  switch (sig.kind) {
    case 'close':
      return go(s, CLEAR_DIALOG);
    case 'change-setting':
      return s.dialog === 'settings'
        ? act(s, NO_PATCH, { kind: 'apply-setting', key: sig.key, raw: sig.raw }, RENDER)
        : undefined;
    case 'reset-settings':
      return s.dialog === 'settings' ? go(s, { confirmReset: true }) : undefined;
    case 'clear-history':
      return s.dialog === 'history' ? go(s, { confirmClear: true }) : undefined;
    case 'confirm':
      if (s.dialog === 'settings' && s.confirmReset) {
        return go(s, { confirmReset: false }, { kind: 'reset-settings' });
      }
      if (s.dialog === 'history' && s.confirmClear) {
        return go(s, { confirmClear: false }, { kind: 'clear-history' });
      }
      return undefined;
    case 'cancel':
      return s.confirmReset || s.confirmClear
        ? go(s, { confirmReset: false, confirmClear: false })
        : undefined;
    default:
      return undefined;
  }
};

const loading: Handler = (s, sig) => {
  switch (sig.kind) {
    case 'boot-ready':
      return go(s, { bootReady: true });
    case 'boot-failed':
      return go(s, {
        screen: 'boot-error',
        error: { kind: 'boot', label: sig.label, retryable: sig.retryable },
      });
    case 'enter':
      return s.bootReady ? go(s, { screen: 'main-menu' }, { kind: 'play-click' }) : undefined;
    default:
      return undefined;
  }
};

const unsupported: Handler = (s, sig) =>
  sig.kind === 'continue-anyway' && s.canContinue
    ? go(s, { screen: 'loading', canContinue: false }, { kind: 'continue-boot' })
    : undefined;

const bootError: Handler = (s, sig) => {
  if (sig.kind !== 'retry-step' || s.error?.retryable !== true) return undefined;
  return s.error.kind === 'boot'
    ? go(s, { screen: 'loading', error: undefined }, { kind: 'retry-boot' })
    : go(s, { screen: 'map-loading', error: undefined }, { kind: 'start-match' });
};

const mainMenu: Handler = (s, sig) => {
  switch (sig.kind) {
    case 'change-setup':
      return act(s, NO_PATCH, { kind: 'apply-setup', field: sig.field, raw: sig.raw }, RENDER);
    case 'open':
      return go(s, { ...CLEAR_DIALOG, dialog: sig.screen, settingsFrom: 'menu' });
    case 'start-match':
      return go(s, { screen: 'map-loading' }, { kind: 'start-match' });
    default:
      return undefined;
  }
};

const mapLoading: Handler = (s, sig) => {
  switch (sig.kind) {
    case 'round-started':
      return go(s, { screen: 'capture', captureRefused: false, holding: false });
    case 'round-start-failed':
      return go(s, {
        screen: 'boot-error',
        error: { kind: 'round-start', label: 'Round setup', retryable: true },
      });
    default:
      return undefined;
  }
};

const capture: Handler = (s, sig, ctx) => {
  switch (sig.kind) {
    case 'capture-and-start':
      return act(s, NO_PATCH, { kind: 'request-lock' });
    case 'lock-gained':
      return ctx.view.phase === 'ready'
        ? go(
            s,
            { screen: 'hud', captureRefused: false },
            { kind: 'begin-countdown' },
            { kind: 'set-input', enabled: true },
          )
        : undefined;
    case 'lock-error':
      return go(s, { captureRefused: true });
    default:
      return undefined;
  }
};

const hud: Handler = (s, sig, ctx) => {
  switch (sig.kind) {
    case 'lock-lost':
      // BR-AS-20/21: our own release, the end hold and an ended round never open Pause.
      if (sig.reason !== 'external' || s.holding || !pausablePhase(ctx)) return undefined;
      return go(
        s,
        { screen: 'pause', confirm: undefined, resumeRefused: false },
        { kind: 'pause', paused: true },
      );
    case 'round-ended':
      return s.holding
        ? undefined
        : act(s, { holding: true }, { kind: 'start-hold', outcome: sig.outcome });
    case 'hold-elapsed':
      return s.holding
        ? go(
            s,
            { screen: 'end', holding: false },
            { kind: 'set-input', enabled: false },
            { kind: 'release-lock' },
            { kind: 'record-round' },
          )
        : undefined;
    default:
      return undefined;
  }
};

function pauseAbandon(s: AppState, sig: Signal, ctx: MachineContext): Step | undefined {
  if (
    sig.kind !== 'restart' &&
    sig.kind !== 'quit-to-menu' &&
    sig.kind !== 'confirm' &&
    sig.kind !== 'cancel'
  ) {
    return undefined;
  }
  const step = onPauseIntent(pauseVariant(ctx.view), s.confirm, sig.kind);
  if (step.execute === 'restart') {
    return go(s, { screen: 'map-loading', confirm: undefined }, { kind: 'restart' });
  }
  if (step.execute === 'quit-to-menu') {
    return go(s, { screen: 'main-menu', confirm: undefined }, { kind: 'quit' });
  }
  if (step.execute === undefined && step.confirm === s.confirm && sig.kind !== 'cancel') {
    return undefined;
  }
  return go(s, { confirm: step.confirm });
}

const pause: Handler = (s, sig, ctx) => {
  switch (sig.kind) {
    case 'resume':
      return act(s, { confirm: undefined, resumeRefused: false }, { kind: 'request-lock' });
    case 'lock-gained':
      // BR-AS-22: begin-countdown is a no-op unless the cancelled countdown left the round Ready.
      return go(
        s,
        { screen: 'hud', confirm: undefined, resumeRefused: false },
        { kind: 'pause', paused: false },
        { kind: 'begin-countdown' },
        { kind: 'set-input', enabled: true },
      );
    case 'lock-error':
      return pauseVariant(ctx.view) === 'combat'
        ? go(s, { resumeRefused: true }, { kind: 'announce', text: RESUME_REFUSED_TEXT })
        : go(s, { screen: 'capture', captureRefused: true }, { kind: 'pause', paused: false });
    case 'open':
      return sig.screen === 'settings' || sig.screen === 'controls'
        ? go(s, { ...CLEAR_DIALOG, dialog: sig.screen, settingsFrom: 'pause' })
        : undefined;
    case 'change-graphics':
      return go(s, { ...CLEAR_DIALOG, dialog: 'settings', settingsFrom: 'advisory' });
    default:
      return pauseAbandon(s, sig, ctx);
  }
};

const end: Handler = (s, sig) => {
  switch (sig.kind) {
    case 'play-again':
      return go(s, { screen: 'map-loading' }, { kind: 'play-again' });
    case 'quit-to-menu':
      return go(s, { screen: 'main-menu' }, { kind: 'quit' });
    default:
      return undefined;
  }
};

/** Context-lost screen: wait for the restore; an end hold that elapses meanwhile is recorded. */
const contextLost: Handler = (s, sig) => {
  switch (sig.kind) {
    case 'context-restored':
      return go(s, {
        screen: s.remembered ?? 'main-menu',
        remembered: undefined,
        contextLost: false,
      });
    case 'hold-elapsed':
      return s.holding
        ? act(
            s,
            { holding: false, remembered: 'end' },
            { kind: 'set-input', enabled: false },
            { kind: 'record-round' },
          )
        : undefined;
    case 'round-ended':
      return s.holding
        ? undefined
        : act(s, { holding: true }, { kind: 'start-hold', outcome: sig.outcome });
    default:
      return undefined;
  }
};

const HANDLERS: ReadonlyMap<AppScreen, Handler> = new Map<AppScreen, Handler>([
  ['loading', loading],
  ['unsupported', unsupported],
  ['boot-error', bootError],
  ['main-menu', mainMenu],
  ['map-loading', mapLoading],
  ['capture', capture],
  ['hud', hud],
  ['pause', pause],
  ['end', end],
  ['context-lost', contextLost],
]);

const IGNORED = (s: AppState): Step => ({ state: s, commands: NO_COMMANDS, ignored: true });

/** FD-AS-2: freeze a running round as Pause would (without showing it) and remember the screen. */
function loseContext(s: AppState, ctx: MachineContext): Step {
  const freeze = s.screen === 'hud' && !s.holding && pausablePhase(ctx);
  const remembered: AppScreen = freeze ? 'pause' : s.screen;
  const cmds: Command[] = freeze ? [{ kind: 'pause', paused: true }] : [];
  return go(
    s,
    { screen: 'context-lost', remembered, contextLost: true, confirm: undefined },
    ...cmds,
    { kind: 'release-lock' },
  );
}

/** Signals that apply on every live screen, before the per-screen table. */
function globalStep(s: AppState, sig: Signal, ctx: MachineContext): Step | undefined {
  switch (sig.kind) {
    case 'fatal':
      return go(s, { ...CLEAR_DIALOG, screen: 'fatal', holding: false });
    case 'unsupported':
      return go(s, { screen: 'unsupported', canContinue: sig.canContinue });
    case 'context-lost':
      return s.screen === 'context-lost' ? undefined : loseContext(s, ctx);
    case 'e2e-started':
      return s.screen === 'context-lost'
        ? undefined
        : go(s, { ...CLEAR_DIALOG, screen: 'hud', holding: false, confirm: undefined });
    default:
      return undefined;
  }
}

export function dispatch(state: AppState, signal: Signal, ctx: MachineContext): Step {
  if (state.screen === 'fatal') return IGNORED(state); // BR-AS-12: terminal
  const global = globalStep(state, signal, ctx);
  if (global !== undefined) return global;
  const dialogOpen =
    state.dialog !== undefined && (state.screen === 'main-menu' || state.screen === 'pause');
  const handler = dialogOpen ? dialogHandler : HANDLERS.get(state.screen);
  return handler?.(state, signal, ctx) ?? IGNORED(state);
}
