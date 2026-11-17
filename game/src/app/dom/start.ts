/**
 * Composition root (layer L4, business-logic-model "Boot workflow", SD-AS-6, SD-AS-9). The only
 * module that reads browser globals for the game: it builds the DOM hosts, wires every unit,
 * runs boot, starts the one rAF loop and installs the e2e hook when `?e2e` is present.
 */
import { checkCapabilities } from '@sz/app/core/capabilities';
import { parseUrlFlags } from '@sz/app/core/url';
import { installTestHook } from '@sz/diagnostics';
import { createInput } from '@sz/input';
import { createEventBus, createFixedClock, type DomainEvent } from '@sz/kernel';
import { createStore } from '@sz/persistence';
import { createUi, type Ui } from '@sz/ui';
import { createApp, type App } from './app';
import { createBootRunner, createBootSteps, isWebglFailure, type BootRunner } from './boot';
import { probeEnvironment } from './env';
import { createLoop } from './loop';
import { createReporter } from './report';
import { createSeedSource } from './seed';
import { safeLocalStorage } from './storage';
import './shell.css';

export const APP_VERSION = '0.1.0';

function mountHosts(doc: Document): { canvas: HTMLCanvasElement; uiHost: HTMLDivElement } {
  const root = doc.getElementById('app') ?? doc.body;
  root.textContent = '';
  const canvas = doc.createElement('canvas');
  canvas.id = 'game-canvas';
  canvas.className = 'sz-game-canvas';
  canvas.dataset['testid'] = 'game-canvas';
  const uiHost = doc.createElement('div');
  uiHost.id = 'ui-host';
  uiHost.className = 'sz-ui-host';
  uiHost.dataset['testid'] = 'ui-host';
  root.append(canvas, uiHost);
  return { canvas, uiHost };
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function start(win: Window): void {
  const doc = win.document;
  const { canvas, uiHost } = mountHosts(doc);
  const flags = parseUrlFlags(win.location.search);
  const reporter = createReporter();
  const motionQuery =
    typeof win.matchMedia === 'function'
      ? win.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
  const reducedMotion = (): boolean => motionQuery?.matches === true;

  // Late-bound: the store and ui callbacks are created before the objects they reach.
  const late: { ui?: Ui; app?: App; boot?: BootRunner } = {};
  let tabHeld = false;

  const store = createStore({
    storage: safeLocalStorage(win),
    now: () => Date.now(),
    schedule: (fn, ms) => {
      const h = win.setTimeout(fn, ms);
      return () => {
        win.clearTimeout(h);
      };
    },
    onStatus: (s) => late.ui?.setStorageStatus(s),
    onSaved: () => late.ui?.flashSaved(),
  });
  const bus = createEventBus<DomainEvent>({
    onSubscriberError: (e, type) => {
      reporter('subscriber', `${type}: ${String(e)}`);
    },
  });
  const clock = createFixedClock({ stepHz: 60, maxSubsteps: 5 });
  const made = createInput({ doc, win, target: canvas });
  if (!made.ok) throw new Error(`input bindings invalid: ${made.error.code}`);
  const input = made.value;
  const ui = createUi(uiHost, (intent) => late.app?.send(intent), { reducedMotion });
  late.ui = ui;

  const loop = createLoop({
    raf: (cb) => win.requestAnimationFrame(cb),
    caf: (h) => {
      win.cancelAnimationFrame(h);
    },
    frame: (t) => late.app?.frame(t),
    onFatal: (e) => late.app?.fatal(e),
  });

  const theApp = createApp({
    ui,
    input,
    store,
    bus,
    clock,
    report: reporter,
    nextSeed: createSeedSource(win.crypto),
    reducedMotion,
    formatDate: (ms) => dateFormat.format(ms),
    version: APP_VERSION,
    tabHeld: () => tabHeld,
    startBoot: () => void late.boot?.start(),
    retryBoot: () => void late.boot?.retry(),
    stopLoop: () => {
      loop.stop();
    },
  });
  late.app = theApp;

  const steps = createBootSteps({
    canvas,
    devicePixelRatio: () => win.devicePixelRatio,
    nextFrame: () =>
      new Promise<void>((resolve) => {
        win.requestAnimationFrame(() => {
          resolve();
        });
      }),
    lastMapId: () => store.lastSetup().mapId,
    onContextLost: () => {
      theApp.signal({ kind: 'context-lost' });
    },
    onContextRestored: () => {
      theApp.signal({ kind: 'context-restored' });
    },
  });
  const boot = createBootRunner({
    run: steps.run,
    onPlan: (plan) => {
      theApp.setBootPlan(plan);
    },
    onReady: () => {
      const booted = steps.result();
      if (booted === undefined) throw new Error('boot finished without results');
      theApp.attach(booted);
      theApp.signal({ kind: 'boot-ready' });
    },
    onFailed: (f) => {
      if (isWebglFailure(f.cause)) {
        theApp.setVerdict({ webgl2: false, pointer: true, widthOk: true });
        theApp.signal({ kind: 'unsupported', canContinue: false });
        return;
      }
      theApp.signal({ kind: 'boot-failed', label: f.label, retryable: f.retryable });
    },
    warn: (message, label) => {
      console.warn(message, label);
    },
  });
  late.boot = boot;

  input.on('lock-gained', () => {
    theApp.signal({ kind: 'lock-gained' });
  });
  input.on('lock-lost', (e) => {
    theApp.signal({ kind: 'lock-lost', reason: e.reason });
  });
  input.on('lock-error', () => {
    theApp.signal({ kind: 'lock-error' });
  });
  input.on('scoreboard', (held) => {
    tabHeld = held;
  });
  canvas.addEventListener('click', () => {
    theApp.canvasClick();
  });
  // req-pause-menu AC2: leaving the window (alt-tab, DevTools, another app) pauses a live round
  // even when the browser has not dropped pointer lock yet, or never held it. The machine treats
  // this exactly like an external lock loss, so a later real lock-lost on Pause is ignored.
  win.addEventListener('blur', () => {
    theApp.signal({ kind: 'lock-lost', reason: 'external' });
  });

  // SEC-AS-31: stray errors and rejections end the session honestly; nothing is suppressed.
  win.addEventListener('error', (e: ErrorEvent) => {
    theApp.fatal(e.error ?? e.message);
  });
  win.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    theApp.fatal(e.reason);
  });
  win.addEventListener('pagehide', () => {
    store.flush();
  });

  if (flags.e2e) {
    installTestHook(win, {
      snapshot: () => theApp.round()?.snapshot(),
      roundView: () => theApp.round()?.state(),
      startMatch: (setup, seed) => theApp.e2eStart(setup, seed),
      inject: (intent, ticks) => {
        theApp.inject(intent, ticks);
      },
      errors: () => reporter.errors(),
      frameStats: () =>
        theApp.frameStats() ?? Object.freeze({ samples: 0, medianFps: 0, worstMs: 0, p95Ms: 0 }),
      ignoredIntents: () => theApp.ignoredIntents(),
    });
  }

  const verdict = checkCapabilities(probeEnvironment(win));
  theApp.setVerdict(verdict);
  theApp.setBootPlan(boot.plan());
  loop.start();
  if (verdict.blocked) {
    theApp.signal({ kind: 'unsupported', canContinue: verdict.canContinue });
    return;
  }
  void boot.start();
}
