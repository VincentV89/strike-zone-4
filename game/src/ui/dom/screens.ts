/**
 * Screen and dialog builders (logical-components C12, frontend-components hierarchy and focus
 * rules). Each builder returns a View: its root, the element that gets initial focus, and an
 * optional in-place update so a re-render of the same screen keeps focus and slider drags.
 */
import type {
  BootErrorModel,
  LoadingModel,
  MapLoadingModel,
  UnsupportedModel,
} from '@sz/ui/core/boot-models';
import type { EndScreenModel, StatItem } from '@sz/ui/core/end-model';
import type { HistoryModel } from '@sz/ui/core/history-model';
import type { SendIntent } from '@sz/ui/core/intents';
import type { CapturePromptModel, PauseModel } from '@sz/ui/core/pause-model';
import type { AboutModel, ControlsModel, MainMenuModel, ScreenModel } from '@sz/ui/core/screens';
import { storageNote } from '@sz/ui/core/screens';
import type { SettingsModel } from '@sz/ui/core/settings-model';
import { append, button, byTestId, h, on } from './el';
import { createScope, inlineConfirm, nextId, radioGroup, slider, type Scope } from './widgets';

export interface View {
  readonly root: HTMLElement;
  /** Initial focus target (frontend-components focus rules). */
  initialFocus(): HTMLElement | null;
  /** Patches in place; returns false when the caller must rebuild. */
  update(m: ScreenModel): boolean;
  dispose(): void;
}

function view(
  scope: Scope,
  root: HTMLElement,
  focus: () => HTMLElement | null,
  update?: (m: ScreenModel) => boolean,
): View {
  return {
    root,
    initialFocus: focus,
    update: update ?? (() => false),
    dispose: () => {
      scope.dispose();
    },
  };
}

function click(scope: Scope, el: HTMLElement, fn: () => void): HTMLElement {
  scope.add(on(el, 'click', fn));
  return el;
}

function heading(tag: 'h1' | 'h2', textValue: string, testid: string): HTMLElement {
  return h(tag, { tabindex: '-1', 'data-testid': testid, id: nextId(testid) }, textValue);
}

function progress(pct: number, label: string, testid: string): HTMLElement {
  const bar = h('div', { class: 'sz-progress-fill' });
  bar.style.setProperty('transform', `scaleX(${String(pct / 100)})`);
  return append(
    h('div', {
      class: 'sz-progress',
      role: 'progressbar',
      'aria-label': label,
      'data-testid': testid,
    }),
    bar,
  );
}

function setProgress(root: HTMLElement, pct: number): void {
  root.setAttribute('aria-valuetext', `${String(pct)}%`);
  const fill = root.firstElementChild;
  if (fill instanceof HTMLElement)
    fill.style.setProperty('transform', `scaleX(${String(pct / 100)})`);
}

export function loadingView(m: LoadingModel, send: SendIntent): View {
  const scope = createScope();
  const bar = progress(m.pct, 'Loading', 'loading-progress');
  setProgress(bar, m.pct);
  const label = h('p', { class: 'sz-help', 'data-testid': 'loading-step' }, m.currentLabel);
  const enter = button('loading-enter-button', 'Click to enter', 'sz-btn sz-btn-primary sz-btn-lg');
  const sync = (x: LoadingModel) => {
    enter.setAttribute('aria-disabled', x.ready ? 'false' : 'true');
    setProgress(bar, x.pct);
    label.textContent = x.currentLabel;
  };
  sync(m);
  let ready = m.ready;
  click(scope, enter, () => {
    if (ready) send({ kind: 'enter' });
  });
  const root = append(
    h('main', { class: 'sz-screen sz-loading', 'data-testid': 'screen-loading' }),
    heading('h1', 'StrikeZone', 'loading-title'),
    bar,
    label,
    enter,
  );
  return view(
    scope,
    root,
    () => (ready ? enter : byTestId(root, 'loading-title')),
    (next) => {
      if (next.id !== 'loading') return false;
      ready = next.ready;
      sync(next);
      return true;
    },
  );
}

export function bootErrorView(m: BootErrorModel, send: SendIntent): View {
  const scope = createScope();
  const retry = button('boot-error-retry-button', 'Retry', 'sz-btn sz-btn-primary');
  retry.hidden = !m.retryable;
  click(scope, retry, () => {
    send({ kind: 'retry-step' });
  });
  const root = append(
    h('main', { class: 'sz-screen', role: 'alert', 'data-testid': 'screen-boot-error' }),
    heading('h1', 'Something went wrong', 'boot-error-title'),
    h('p', { 'data-testid': 'boot-error-message' }, m.message),
    retry,
  );
  return view(scope, root, () => (m.retryable ? retry : byTestId(root, 'boot-error-title')));
}

export function unsupportedView(m: UnsupportedModel, send: SendIntent): View {
  const scope = createScope();
  const list = h('ul', { 'data-testid': 'unsupported-reasons' });
  for (const r of m.reasons) list.appendChild(h('li', {}, r));
  const go = button('unsupported-continue-button', 'Continue anyway', 'sz-btn');
  go.hidden = !m.canContinue;
  click(scope, go, () => {
    send({ kind: 'continue-anyway' });
  });
  const root = append(
    h('main', { class: 'sz-screen', 'data-testid': 'screen-unsupported' }),
    heading('h1', 'This browser or device is not supported', 'unsupported-title'),
    list,
    go,
  );
  return view(scope, root, () => (m.canContinue ? go : byTestId(root, 'unsupported-title')));
}

export function mainMenuView(m: MainMenuModel, send: SendIntent): View {
  const scope = createScope();
  const p = m.panel;
  const change = (field: string) => (raw: string) => {
    send({ kind: 'change-setup', field, raw });
  };
  const maps = radioGroup(scope, 'Select map', 'setup-map', p.maps, change('mapId'));
  const bots = radioGroup(scope, 'CPU enemies', 'setup-bots', p.bots, change('botCount'));
  const diff = radioGroup(
    scope,
    'Difficulty',
    'setup-difficulty',
    p.difficulties,
    change('difficulty'),
    p.difficultyDescription,
  );
  const summary = h('p', { class: 'sz-summary', 'data-testid': 'setup-summary' }, p.summary);
  const start = button('main-menu-start-button', 'Start game', 'sz-btn sz-btn-primary sz-btn-lg');
  click(scope, start, () => {
    send({ kind: 'start-match' });
  });
  const note = h(
    'p',
    { class: 'sz-help', 'data-testid': 'storage-status' },
    storageNote(m.storageStatus),
  );
  const saved = h(
    'span',
    { class: 'sz-saved', 'data-testid': 'saved-indicator', 'aria-hidden': 'true' },
    '✓ Saved',
  );

  const nav = h('nav', { 'aria-label': 'Main menu', class: 'sz-nav' });
  nav.appendChild(
    click(scope, button('main-menu-play-button', 'Play'), () => {
      start.focus({ preventScroll: true });
    }),
  );
  const open = (screen: 'settings' | 'controls' | 'history' | 'about', label: string) =>
    nav.appendChild(
      click(scope, button(`main-menu-${screen}-button`, label), () => {
        send({ kind: 'open', screen });
      }),
    );
  open('settings', 'Settings');
  open('controls', 'Controls');
  open('history', 'Match history');
  open('about', 'About');

  const setupHeading = heading('h2', 'Match setup', 'setup-title');
  const root = append(
    h('div', { class: 'sz-screen sz-menu', 'data-testid': 'screen-main-menu' }),
    append(h('header', { class: 'sz-menu-header' }), h('h1', {}, 'StrikeZone')),
    nav,
    append(
      h('main', { class: 'sz-setup' }),
      append(
        h('section', { 'aria-labelledby': setupHeading.id, 'data-testid': 'setup-panel' }),
        setupHeading,
        maps.root,
        bots.root,
        diff.root,
        summary,
        start,
      ),
    ),
    append(h('footer', { class: 'sz-footer' }), note, saved),
  );
  return view(
    scope,
    root,
    () => start,
    (next) => {
      if (next.id !== 'main-menu') return false;
      maps.sync(next.panel.maps);
      bots.sync(next.panel.bots);
      diff.sync(next.panel.difficulties, next.panel.difficultyDescription);
      summary.textContent = next.panel.summary;
      note.textContent = storageNote(next.storageStatus);
      return true;
    },
  );
}

export function mapLoadingView(m: MapLoadingModel): View {
  const scope = createScope();
  const bar = progress(m.pct, `Loading ${m.mapName}`, 'map-loading-progress');
  setProgress(bar, m.pct);
  const root = append(
    h('main', { class: 'sz-screen', 'data-testid': 'screen-map-loading' }),
    heading('h1', `Loading ${m.mapName}`, 'map-loading-title'),
    bar,
  );
  return view(
    scope,
    root,
    () => byTestId(root, 'map-loading-title'),
    (next) => {
      if (next.id !== 'map-loading') return false;
      setProgress(bar, next.pct);
      return true;
    },
  );
}

export function captureView(m: CapturePromptModel, send: SendIntent): View {
  const scope = createScope();
  const go = button(
    'capture-start-button',
    'Capture mouse and start',
    'sz-btn sz-btn-primary sz-btn-lg',
  );
  // BR-UI-42: send synchronously inside the activation so app-shell can request pointer lock.
  click(scope, go, () => {
    send({ kind: 'capture-and-start' });
  });
  const refusal = h(
    'p',
    { class: 'sz-help', role: 'status', 'aria-live': 'polite', 'data-testid': 'capture-refusal' },
    m.refusalLine,
  );
  const root = append(
    h('main', { class: 'sz-screen sz-capture', 'data-testid': 'screen-capture-prompt' }),
    heading('h1', m.roundLabel, 'capture-title'),
    go,
    h('p', { class: 'sz-help' }, 'Esc releases the mouse and pauses the game.'),
    refusal,
  );
  return view(
    scope,
    root,
    () => go,
    (next) => {
      if (next.id !== 'capture-prompt') return false;
      refusal.textContent = next.refusalLine;
      return true;
    },
  );
}

function statList(items: ReadonlyArray<StatItem>, testid: string): HTMLElement {
  const dl = h('dl', { class: 'sz-stats', 'data-testid': testid });
  for (const s of items) {
    dl.appendChild(
      append(h('div', { class: 'sz-stat-item' }), h('dt', {}, s.label), h('dd', {}, s.value)),
    );
  }
  return dl;
}

export function endView(m: EndScreenModel, send: SendIntent): View {
  const scope = createScope();
  const again = button('end-play-again-button', 'Play again', 'sz-btn sz-btn-primary sz-btn-lg');
  const menu = button('end-main-menu-button', 'Main menu');
  click(scope, again, () => {
    send({ kind: 'play-again' });
  });
  click(scope, menu, () => {
    send({ kind: 'quit-to-menu' });
  });
  const root = append(
    h('main', { class: 'sz-screen sz-end', 'data-testid': 'screen-end', 'data-state': m.outcome }),
    heading('h1', m.title, 'end-title'),
    h('p', { class: 'sz-subtitle', 'data-testid': 'end-subtitle' }, m.subtitle),
    statList(m.primary, 'end-primary-stats'),
    statList(m.secondary, 'end-secondary-stats'),
    h('p', { 'data-testid': 'end-record' }, m.recordLine),
    append(h('div', { class: 'sz-actions' }), again, menu),
  );
  return view(scope, root, () => again);
}

// ---- dialog contents ----

function dialogBody(title: string, testid: string): { root: HTMLElement; title: HTMLElement } {
  const t = heading('h2', title, `${testid}-title`);
  const root = append(h('div', { class: 'sz-dialog-body', 'data-testid': testid }), t);
  return { root, title: t };
}

export function settingsView(m: SettingsModel, send: SendIntent): View {
  const scope = createScope();
  const { root } = dialogBody('Settings', 'settings-dialog');
  const set = (key: string) => (raw: string) => {
    send({ kind: 'change-setting', key, raw });
  };
  const sliders = m.sliders.map((s) => slider(scope, s, set(s.key)));
  const graphics = radioGroup(
    scope,
    'Graphics',
    'settings-graphics',
    m.graphics,
    set('graphics'),
    m.graphics.find((g) => g.checked)?.description ?? '',
  );
  const durations = radioGroup(
    scope,
    'Round duration',
    'settings-duration',
    m.durations,
    set('roundDurationSec'),
  );
  const note = h(
    'p',
    { class: 'sz-help', 'data-testid': 'settings-duration-note' },
    m.durationNote,
  );
  const saved = h(
    'span',
    { class: 'sz-saved', 'data-testid': 'saved-indicator', 'aria-hidden': 'true' },
    '✓ Saved',
  );
  const reset = button('settings-reset-button', 'Reset to defaults');
  const done = button('settings-done-button', 'Done', 'sz-btn sz-btn-primary');
  click(scope, reset, () => {
    send({ kind: 'reset-settings' });
  });
  click(scope, done, () => {
    send({ kind: 'close' });
  });
  const actions = append(h('div', { class: 'sz-actions' }), reset, done);
  const confirm = inlineConfirm(
    scope,
    'settings-reset',
    'Reset all settings to their defaults?',
    'Sensitivity, field of view, volumes, graphics and round duration go back to the first-run values.',
    'Reset',
    () => {
      send({ kind: 'confirm' });
    },
    () => {
      send({ kind: 'cancel' });
    },
  );
  confirm.hidden = !m.confirmReset;
  actions.hidden = m.confirmReset;
  for (const s of sliders) root.appendChild(s.root);
  append(root, graphics.root, durations.root, note, saved, actions, confirm);
  let confirming = m.confirmReset;
  const focus = () => {
    if (confirming) return byTestId(confirm, 'settings-reset-cancel-button');
    if (m.from === 'advisory') {
      return root.querySelector<HTMLElement>('[data-testid^="settings-graphics-option-"]:checked');
    }
    return sliders[0]?.input ?? done;
  };
  return view(scope, root, focus, (next) => {
    if (next.id !== 'settings' || next.confirmReset !== confirming) return false;
    next.sliders.forEach((s, i) => sliders[i]?.sync(s));
    graphics.sync(next.graphics, next.graphics.find((g) => g.checked)?.description ?? '');
    durations.sync(next.durations);
    note.textContent = next.durationNote;
    confirming = next.confirmReset;
    return true;
  });
}

function closeOnly(
  scope: Scope,
  root: HTMLElement,
  testid: string,
  send: SendIntent,
): HTMLButtonElement {
  const done = button(testid, 'Done', 'sz-btn sz-btn-primary');
  click(scope, done, () => {
    send({ kind: 'close' });
  });
  root.appendChild(append(h('div', { class: 'sz-actions' }), done));
  return done;
}

export function controlsView(m: ControlsModel, send: SendIntent): View {
  const scope = createScope();
  const { root } = dialogBody('Controls', 'controls-dialog');
  const body = h('tbody');
  for (const r of m.rows)
    body.appendChild(append(h('tr'), h('th', { scope: 'row' }, r.label), h('td', {}, r.keys)));
  root.appendChild(
    append(
      h('table', { class: 'sz-table', 'data-testid': 'controls-table' }),
      append(
        h('thead'),
        append(h('tr'), h('th', { scope: 'col' }, 'Action'), h('th', { scope: 'col' }, 'Key')),
      ),
      body,
    ),
  );
  const done = closeOnly(scope, root, 'controls-done-button', send);
  return view(scope, root, () => done);
}

export function aboutView(m: AboutModel, send: SendIntent): View {
  const scope = createScope();
  const { root } = dialogBody('About StrikeZone', 'about-dialog');
  for (const line of m.lines) root.appendChild(h('p', {}, line));
  root.appendChild(
    h('p', { class: 'sz-help', 'data-testid': 'about-version' }, `Version ${m.version}`),
  );
  const done = closeOnly(scope, root, 'about-done-button', send);
  return view(scope, root, () => done);
}

export function historyView(m: HistoryModel, send: SendIntent): View {
  const scope = createScope();
  const { root } = dialogBody('Match history', 'history-dialog');
  root.appendChild(h('p', { 'data-testid': 'history-record' }, m.recordLine));
  if (m.rows.length === 0) {
    root.appendChild(h('p', { class: 'sz-help', 'data-testid': 'history-empty' }, m.emptyText));
  } else {
    const head = append(h('tr'));
    for (const c of ['Date', 'Map', 'Bots', 'Difficulty', 'Result', 'Kills', 'Accuracy'])
      head.appendChild(h('th', { scope: 'col' }, c));
    const body = h('tbody');
    for (const r of m.rows) {
      body.appendChild(
        append(
          h('tr', { 'data-testid': `history-row-${r.key}` }),
          h('td', {}, r.date),
          h('td', {}, r.map),
          h('td', {}, r.bots),
          h('td', {}, r.difficulty),
          h('td', {}, r.result),
          h('td', {}, r.kills),
          h('td', {}, r.accuracy),
        ),
      );
    }
    root.appendChild(
      append(
        h('table', { class: 'sz-table', 'data-testid': 'history-table' }),
        append(h('thead'), head),
        body,
      ),
    );
  }
  if (m.confirmClear) {
    root.appendChild(
      inlineConfirm(
        scope,
        'history-clear',
        'Clear all match history?',
        'Your W·L record is kept.',
        'Clear history',
        () => {
          send({ kind: 'confirm' });
        },
        () => {
          send({ kind: 'cancel' });
        },
      ),
    );
    return view(scope, root, () => byTestId(root, 'history-clear-cancel-button'));
  }
  const clear = button('history-clear-button', 'Clear history');
  clear.hidden = m.rows.length === 0;
  click(scope, clear, () => {
    send({ kind: 'clear-history' });
  });
  const done = button('history-done-button', 'Done', 'sz-btn sz-btn-primary');
  click(scope, done, () => {
    send({ kind: 'close' });
  });
  root.appendChild(append(h('div', { class: 'sz-actions' }), clear, done));
  return view(scope, root, () => done);
}

export function pauseView(m: PauseModel, send: SendIntent): View {
  const scope = createScope();
  const { root } = dialogBody('Paused', 'pause-dialog');
  root.appendChild(h('p', { 'data-testid': 'pause-summary' }, m.summaryLine));
  if (m.confirm) {
    const c = m.confirm;
    root.appendChild(
      inlineConfirm(
        scope,
        'pause-confirm',
        c.question,
        c.consequence,
        c.confirmLabel,
        () => {
          send({ kind: 'confirm' });
        },
        () => {
          send({ kind: 'cancel' });
        },
      ),
    );
    return view(scope, root, () => byTestId(root, 'pause-confirm-cancel-button'));
  }
  const resume = button('pause-resume-button', 'Resume game', 'sz-btn sz-btn-primary sz-btn-lg');
  // BR-UI-42: the pointer-lock request happens in app-shell inside this click.
  click(scope, resume, () => {
    send({ kind: 'resume' });
  });
  const menu = append(
    h('div', { class: 'sz-pause-menu' }),
    resume,
    click(scope, button('pause-restart-button', 'Restart round'), () => {
      send({ kind: 'restart' });
    }),
    click(scope, button('pause-settings-button', 'Settings'), () => {
      send({ kind: 'open', screen: 'settings' });
    }),
    click(scope, button('pause-controls-button', 'Controls'), () => {
      send({ kind: 'open', screen: 'controls' });
    }),
    click(scope, button('pause-quit-button', 'Return to main menu'), () => {
      send({ kind: 'quit-to-menu' });
    }),
  );
  root.appendChild(menu);
  if (m.advisoryLine !== '') {
    root.appendChild(
      append(
        h('div', { class: 'sz-advisory', 'data-testid': 'pause-advisory' }),
        h('p', {}, m.advisoryLine),
        click(scope, button('pause-change-graphics-button', 'Change graphics'), () => {
          send({ kind: 'change-graphics' });
        }),
      ),
    );
  }
  return view(scope, root, () => resume);
}

export function buildView(m: ScreenModel, send: SendIntent): View | null {
  switch (m.id) {
    case 'loading':
      return loadingView(m, send);
    case 'boot-error':
      return bootErrorView(m, send);
    case 'unsupported':
      return unsupportedView(m, send);
    case 'main-menu':
      return mainMenuView(m, send);
    case 'map-loading':
      return mapLoadingView(m);
    case 'capture-prompt':
      return captureView(m, send);
    case 'end':
      return endView(m, send);
    case 'settings':
      return settingsView(m, send);
    case 'controls':
      return controlsView(m, send);
    case 'about':
      return aboutView(m, send);
    case 'history':
      return historyView(m, send);
    case 'pause':
      return pauseView(m, send);
    case 'hud':
      return null;
  }
}
